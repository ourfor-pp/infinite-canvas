import importlib.util
import json
from pathlib import Path

import httpx
import pytest

from media_executor import llm
from media_executor import coexistence
from media_executor.capabilities.catalog import prepare, describe


def request(**changes):
    return {"id": "llm-test", "model": llm.MODEL, "mode": "text", "operation": "generate",
            "prompt": "把左边杯子改成绿色，其余不变。", "params": {}, "references": [], **changes}


def test_catalog_and_preflight_accept_text_and_image_only(tmp_path):
    health = {"models": {llm.MODEL: llm.describe()}, "configuredRuntimes": {"llm": True}}
    capability = next(x for x in describe(health)["capabilities"] if x["id"] == llm.MODEL)
    assert capability["output"] == "text" and capability["available"]
    (tmp_path / "image").write_bytes(b"image")
    assert prepare(request(references=[{"fileId": "image", "kind": "image"}]), health, tmp_path)["contextLength"] == 8192
    with pytest.raises(ValueError, match="at most one image"):
        prepare(request(references=[{"fileId": "image", "kind": "audio"}]), health, tmp_path)
    with pytest.raises(ValueError, match="unavailable"):
        prepare(request(), {}, tmp_path)


@pytest.mark.parametrize("changes", [
    {"params": {"maxTokens": True}}, {"params": {"maxTokens": 2049}},
    {"params": {"temperature": float("nan")}}, {"params": {"systemPrompt": 4}},
    {"params": {"messages": []}}, {"params": {"responseFormat": "xml"}},
    {"mode": "speech"}, {"prompt": " "}, {"continuation": {"fileId": "old"}},
    {"references": [{"kind": "image"}, {"kind": "image"}]},
])
def test_invalid_request_is_rejected_before_gpu(changes):
    with pytest.raises(ValueError):
        llm.validate(request(**changes))


@pytest.fixture
def worker():
    path = Path(__file__).resolve().parents[1] / "runtimes/qwen_llm/app.py"
    spec = importlib.util.spec_from_file_location("llm_worker_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_worker_preserves_prompt_and_exposes_truncation(worker, tmp_path, monkeypatch):
    received = []
    def respond(req):
        received.append(json.loads(req.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"answer":"ok"}'}, "finish_reason": "length"}], "usage": {"completion_tokens": 12}})
    client = httpx.Client(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(worker, "Engine", lambda: type("Engine", (), {"client": client})())
    value = worker.Request(**request(params={"systemPrompt": "保留全部约束", "responseFormat": "json_object", "maxTokens": 12}), outputDir=str(tmp_path))
    result = worker.runtime.run(value, worker.process)
    assert result["finishReason"] == "length"
    assert received[0]["messages"] == [{"role": "system", "content": "保留全部约束"}, {"role": "user", "content": [{"type": "text", "text": value.prompt}]}]
    assert received[0]["response_format"] == {"type": "json_object"}
    assert (tmp_path / "response.txt").read_text() == result["text"]
    assert worker.runtime.run(value, worker.process) == result
    assert len(received) == 1  # Durable replay never repeats inference.


def test_unload_closes_llama_child_without_torch(worker):
    closed = []
    worker.runtime.models[llm.MODEL] = type("Engine", (), {"close": lambda _: closed.append(True)})()
    assert worker.runtime.free()["loaded"] == [llm.MODEL]
    assert worker.runtime.free(unload=True)["loaded"] == []
    assert closed == [True]


def test_memory_envelope_rejects_changed_runtime_and_unqualified_shapes(tmp_path, monkeypatch):
    for name in ("LLM", "COMFY"):
        monkeypatch.setenv(f"MEDIA_EXECUTOR_{name}_REVISION", name)
    record = {"version": 1, "revisions": {"llm": "LLM", "comfy": "COMFY"}, "budgets": {"llm": 6 * 1024**3, "image-1024": 20 * 1024**3}}
    (tmp_path / "qwen-coexistence.json").write_text(json.dumps(record))
    assert coexistence.budget(tmp_path, request(), {}) == 6 * 1024**3
    image = request(model="qwen-image-2.1-local", mode="text-to-image")
    plan = {"steps": 40, "width": 1024, "height": 1024}
    assert coexistence.budget(tmp_path, image, plan) == 20 * 1024**3
    assert coexistence.budget(tmp_path, {**image, "prompt": "中" * 342}, plan) is None
    assert coexistence.budget(tmp_path, {**image, "references": [{"kind": "image"}]}, plan) is None
    assert coexistence.budget(tmp_path, image, {**plan, "width": 1536}) is None
    monkeypatch.setenv("MEDIA_EXECUTOR_LLM_REVISION", "new-runtime")
    assert coexistence.budget(tmp_path, request(), {}) is None

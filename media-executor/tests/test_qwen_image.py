import copy
import json

import pytest
from fastapi.testclient import TestClient

from media_executor.capabilities import qwen_image
from media_executor.capabilities.catalog import prepare, describe
from test_capability_jobs import setup


def request():
    return {"id": "image-test", "model": qwen_image.MODEL, "mode": "text-to-image", "operation": "generate", "prompt": "透明背景的蓝色茶杯", "params": {"seed": 42}, "references": []}


def runtime():
    return {"comfyFeatures": {"qwenImage21": True}}


def test_presence_requires_all_nodes_and_weights():
    info = {name: {} for name in qwen_image.NODES}
    for loader, field, name in qwen_image.WEIGHTS:
        info[loader] = {"input": {"required": {field: [[name]]}}}
    assert qwen_image.available(info)
    del info["TextEncodeQwenImage21"]
    assert not qwen_image.available(info)
    assert next(x for x in describe({})["capabilities"] if x["id"] == qwen_image.MODEL)["available"] is False


@pytest.mark.parametrize("patch", [
    {"mode": "speech"}, {"operation": "extend"}, {"prompt": " "},
    {"params": {"steps": True}}, {"params": {"width": 1025}},
    {"params": {"width": 4096, "height": 4096}}, {"params": {"cfg": 4}},
    {"mode": "image-edit"}, {"params": {"seed": -1}},
])
def test_invalid_requests_fail_before_submission(tmp_path, patch):
    with pytest.raises(ValueError):
        prepare({**request(), **patch}, runtime(), tmp_path)


def test_edit_reference_order_alpha_and_size(monkeypatch, tmp_path):
    value = request()
    value.update(mode="image-edit", references=[{"fileId": f"{i}.png", "kind": "image"} for i in range(10)])
    for ref in value["references"]:
        (tmp_path / ref["fileId"]).write_bytes(b"fixture")
    monkeypatch.setattr(qwen_image.subprocess, "check_output", lambda *a, **kw: json.dumps({"streams": [{"width": 1536, "height": 1024}]}))
    plan = prepare(value, runtime(), tmp_path)
    assert (plan["width"], plan["height"]) == (1248, 832)
    graph = qwen_image.graph(value, plan, {ref["fileId"]: ref["fileId"] for ref in value["references"]})
    assert graph["4"]["inputs"]["images.image_10"] == ["rgba_10", 0]
    assert graph["rgba_1"]["inputs"]["alpha"] == ["load_1", 1]
    assert graph["6"]["inputs"]["latent_image"] == ["4", 2]
    assert graph["4"]["inputs"]["prompt"] == value["prompt"]
    value["references"].append(copy.deepcopy(value["references"][0]))
    with pytest.raises(ValueError, match="10 image references"):
        prepare(value, runtime(), tmp_path)


def test_image_api_uses_durable_comfy_queue(monkeypatch, tmp_path):
    module = setup(monkeypatch, tmp_path)
    monkeypatch.setattr(module, "health", runtime)
    headers = {"Authorization": "Bearer secret", "X-Media-Protocol": "2"}
    with TestClient(module.app) as client:
        result = client.post("/v1/jobs/validate", json=request(), headers=headers)
        assert result.status_code == 200
        plan = result.json()["plan"]
        assert plan["steps"] == 40 and plan["seed"] == 42
        assert qwen_image.graph(request(), plan, {})["6"]["inputs"]["latent_image"] == ["5", 0]
        assert client.post("/v1/jobs", json=request(), headers=headers).status_code == 202
        assert client.post("/v1/jobs", json=request(), headers=headers).status_code == 202
    with module.connect() as db:
        assert db.execute("SELECT count(*) FROM comfy_executions").fetchone()[0] == 1

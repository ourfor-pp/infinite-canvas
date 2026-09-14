import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from media_executor.runtime import Runtime


class Request(BaseModel):
    outputDir: str
    prompt: str = "hello"


def test_runtime_journal_deduplicates_and_rejects_changed_request(tmp_path):
    runtime = Runtime()
    request = Request(outputDir=str(tmp_path))
    calls = []
    def generate(value):
        calls.append(value.prompt)
        return {"files": []}
    assert runtime.run(request, generate) == runtime.run(request, generate)
    assert calls == ["hello"]
    with pytest.raises(HTTPException):
        runtime.run(request.model_copy(update={"prompt": "changed"}), generate)


def test_interrupted_execution_never_blindly_resubmits(tmp_path):
    runtime = Runtime()
    request = Request(outputDir=str(tmp_path))
    with pytest.raises(HTTPException):
        runtime.run(request, lambda _: (_ for _ in ()).throw(ValueError("CUDA out of memory")))
    assert runtime.status()["busy"] is False
    assert json.loads((tmp_path / ".runtime-job.json").read_text())["status"] == "failed"
    with pytest.raises(HTTPException):
        runtime.run(request, lambda _: pytest.fail("must not retry"))


def test_busy_runtime_rejects_eviction_and_second_job(tmp_path):
    runtime = Runtime()
    def generate(_):
        with ThreadPoolExecutor() as pool:
            with pytest.raises(HTTPException):
                pool.submit(runtime.free, True).result()
            with pytest.raises(HTTPException):
                pool.submit(runtime.run, Request(outputDir=str(tmp_path / "other")), lambda _: {}).result()
        return {}
    runtime.run(Request(outputDir=str(tmp_path)), generate)

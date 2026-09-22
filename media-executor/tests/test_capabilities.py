import copy
import hashlib
import json
from pathlib import Path

import pytest

from media_executor.capabilities import h3, music
from media_executor.capabilities.catalog import describe, prepare

IDENTITY = {"modelRevision": "base:pipeline:core", "videoVaeRevision": "video-vae", "audioVaeRevision": "audio-vae"}


def runtime():
    return {"comfyFeatures": {"h3Ref2va": True, "h3Fl2va": True, "temporalGuides": True, "music3": True}, "h3Runtime": IDENTITY, "h3PddRuntime": {**IDENTITY, "modelRevision": "base:pipeline:core:pdd-ref8:digest"}}


@pytest.mark.parametrize("fixture", json.loads((Path(__file__).parent / "fixtures/comfy-capability-baseline.json").read_text()), ids=lambda c: c["name"])
def test_migrated_graph_matches_existing_production_graph(fixture):
    original = fixture["params"]
    guides = {x["fileId"]: x for x in original.get("temporalGuides", [])}
    refs = [{"fileId": x["fileId"], "kind": x["kind"], "role": x.get("role", "reference"), **guides.get(x["fileId"], {})} for x in fixture["files"]]
    request = {"id": "fixture", "model": fixture["model"], "prompt": fixture["prompt"], "mode": "music" if fixture["name"] == "music3" else "ref2va" if "ref2va" in fixture["name"] else "fl2va", "operation": "extend" if "extend" in fixture["name"] else "generate", "references": refs, "params": {**original, "seed": 42, "recipe": original.get("h3Recipe", "base")}}
    if fixture["name"] == "music3":
        actual = music.graph(request, music.prepare(request))
    else:
        plan = h3.prepare(request, runtime(), original.get("__h3PreviousState", {}).get("context"))
        plan["context"] = original.get("__h3StateContext")
        actual = h3.graph(request, plan, {x["fileId"]: x["name"] for x in fixture["files"]}, "state.safetensors")
    expected = copy.deepcopy(fixture["graph"])
    for graph in (expected, actual):
        for key in ("70", "80"):
            if key in graph:
                field = "context" if key == "70" else "expected_context"
                graph[key]["inputs"][field] = json.loads(graph[key]["inputs"][field])
    assert actual == expected


def test_native_state_has_no_director_dependency(tmp_path):
    context = {"schemaVersion": 1, "fps": 24, **IDENTITY, "sourceId": "neutral-job", "width": 32, "height": 32, "frames": 5}
    data = (Path(__file__).parent / "fixtures/h3-empty-state.safetensors").read_bytes()
    path = tmp_path / "state.safetensors"
    path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    assert h3.state_context(path, digest) == context
    with pytest.raises(ValueError, match="hash mismatch"):
        h3.state_context(path, "0" * 64)


def test_mode_and_input_boundaries(tmp_path):
    (tmp_path / "image.png").write_bytes(b"input")
    request = {"id": "request", "model": "minimax-h3-ref2va-local", "mode": "ref2va", "operation": "generate", "prompt": "A room.", "params": {"seconds": 8}, "references": [{"fileId": "image.png", "kind": "image"}]}
    plan = prepare(request, runtime(), tmp_path)
    assert plan["recipe"] == "pdd-ref8"
    assert plan["outputFrames"] == 192
    assert plan["context"]["sourceId"] == "request"
    (tmp_path / "voice.wav").write_bytes(b"input")
    request["references"].append({"fileId": "voice.wav", "kind": "audio"})
    assert prepare(request, runtime(), tmp_path)["recipe"] == "base"
    request.update(model="minimax-h3-fl2va-local", mode="fl2va")
    with pytest.raises(ValueError, match="image inputs only"):
        prepare(request, runtime(), tmp_path)
    request["params"]["__directorSegment"] = {"projectId": "must-not-be-required"}
    with pytest.raises(ValueError, match="private application"):
        prepare(request, runtime(), tmp_path)


def test_continuation_keeps_recipe_and_actual_window():
    previous = {"schemaVersion": 1, "fps": 24, **IDENTITY, "sourceId": "previous", "width": 864, "height": 480, "frames": 192}
    request = {"id": "next", "model": "minimax-h3-ref2va-local", "mode": "ref2va", "operation": "extend", "prompt": "Continue.", "params": {"seconds": 8}, "references": [{"fileId": "image", "kind": "image"}]}
    plan = h3.prepare(request, runtime(), previous)
    assert (plan["recipe"], plan["outputFrames"], plan["context"]["frames"], plan["overlapFrames"]) == ("base", 187, 379, 22)
    request["params"]["recipe"] = "pdd-ref8"
    with pytest.raises(ValueError, match="retain the source recipe"):
        h3.prepare(request, runtime(), previous)


def test_catalog_distinguishes_presence_and_acceptance():
    items = describe(runtime())["capabilities"]
    assert all(item["qualityAccepted"] is False for item in items)
    fl = next(x for x in items if x["id"].endswith("fl2va-local"))
    assert fl["operations"] == ["generate"] and fl["referenceLimits"]["audio"] == 0


def test_turbo_requires_preview_opt_in_and_available_nodes():
    request = {"id": "turbo", "model": "minimax-h3-fl2va-local", "mode": "fl2va", "operation": "generate", "prompt": "A door opens.", "params": {"seed": 42, "allowTurbo": True}, "references": [{"fileId": "first", "kind": "image", "role": "first-frame"}]}
    info = runtime()
    assert h3.prepare(request, info)["turbo"] is False
    info["comfyFeatures"]["turboPreview"] = True
    plan = h3.prepare(request, info)
    graph = h3.graph(request, plan, {"first": "first.png"})
    assert graph["7"]["class_type"] == "MiniMaxH3TurboSampler"
    assert graph["16"]["inputs"]["lora_name"] == "minimax_h3_turbo_v4_step600_ema.safetensors"
    assert graph["8"]["inputs"]["steps"] == 8
    request["params"]["qualityPreset"] = "final"
    assert h3.prepare(request, info)["turbo"] is False


def test_text_only_reference_mode_and_reference_limits():
    request = {"id": "text", "model": "minimax-h3-ref2va-local", "mode": "ref2va", "operation": "generate", "prompt": "A door opens.", "params": {}, "references": []}
    assert h3.prepare(request, runtime())["mode"] == "ref2va"
    request["references"] = [{"fileId": "audio", "kind": "audio"}]
    with pytest.raises(ValueError, match="references"):
        h3.prepare(request, runtime())
    request["references"] = [{"fileId": str(i), "kind": "image"} for i in range(10)]
    with pytest.raises(ValueError, match="budget"):
        h3.prepare(request, runtime())


def test_fl2va_multimodal_temporal_guides_preserve_audio_opt_out():
    request = {"id": "guide", "model": "minimax-h3-fl2va-local", "mode": "fl2va", "operation": "generate", "prompt": "A quiet room.", "params": {"seed": 42}, "references": [{"fileId": "clip", "kind": "video", "frameIndex": 0, "includeAudio": False}]}
    plan = h3.prepare(request, runtime())
    graph = h3.graph(request, plan, {"clip": "clip.mp4"})
    assert graph["102"]["inputs"]["image"] == ["101", 0]
    assert "audio" not in graph["102"]["inputs"]
    request["references"].append({"fileId": "first", "kind": "image", "role": "first-frame"})
    with pytest.raises(ValueError, match="endpoint images or temporal guides"):
        h3.prepare(request, runtime())


def test_all_service_capabilities_share_one_skill():
    info = runtime()
    info["models"] = {"qwen3-tts-1.7b-base-local": {"engine": "qwen", "modes": ["speech"], "operations": ["clone"], "inputs": ["text", "audio"]}}
    info["runtimes"] = {"qwen": True}
    capabilities = describe(info)["capabilities"]
    assert len(capabilities) == 5
    assert {item["skill"] for item in capabilities} == {"media-generation"}

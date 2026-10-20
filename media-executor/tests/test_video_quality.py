import subprocess
from fractions import Fraction

import pytest

from media_executor.capabilities import video_quality as quality
from media_executor.capabilities.catalog import describe, prepare


@pytest.fixture
def video(tmp_path):
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=1", "-c:v", "libx264", "-threads", "1", str(tmp_path / "source.mp4")], check=True)
    return tmp_path


def request(**patch):
    return {"id": "quality-test", "model": "flashvsr-turbo-local", "mode": "enhance", "operation": "enhance", "prompt": "",
            "params": {"resolution": "4k", "fps": 48}, "references": [{"fileId": "source.mp4", "kind": "video"}], **patch}


def test_quality_is_two_models_with_integrated_interpolation(video):
    runtime = {"comfyFeatures": {model: True for model in quality.MODELS}}
    items = [x for x in describe(runtime)["capabilities"] if x["id"] in quality.MODELS]
    assert len(items) == 2 and all(x["available"] and x["operations"] == ["enhance"] for x in items)
    for model in quality.MODELS:
        plan = prepare(request(model=model), runtime, video)
        assert (plan["width"], plan["height"], plan["outputFrames"], plan["fps"]) == (3840, 2160, 48, "48")
        assert plan["outputSeconds"] == 1 and plan["preserveAudio"]
        graph = quality.graph(request(model=model), plan, {"source.mp4": "uploaded.mp4"})
        assert graph["enhance"]["inputs"]["source_frames"] == 24
    with pytest.raises(ValueError, match="unavailable"):
        prepare(request(), {}, video)


@pytest.mark.parametrize("params,frames,fps", [({"resolution": "1080p", "fps": "source"}, 24, "24"), ({"resolution": "1080p", "fps": 60}, 60, "60")])
def test_source_duration_survives_frame_rate_changes(video, params, frames, fps):
    plan = quality.prepare(request(params=params), video)
    assert plan["outputFrames"] == frames and plan["fps"] == fps and plan["outputSeconds"] == 1


@pytest.mark.parametrize("patch", [
    {"prompt": "change the face"}, {"operation": "generate"}, {"mode": "ref2va"},
    {"references": []}, {"references": [{"fileId": "source.mp4", "kind": "image"}]},
    {"references": [{"fileId": "source.mp4", "kind": "video", "role": "continuation"}]},
    {"params": {"resolution": "768p"}}, {"params": {"fps": True}}, {"params": {"fps": "48"}},
    {"params": {"fps": 120}}, {"params": {"seconds": 5}}, {"params": {"recipe": "base"}},
])
def test_unsupported_input_is_not_silently_ignored(video, patch):
    with pytest.raises(ValueError):
        quality.prepare(request(**patch), video)


def test_portrait_proportions_and_already_higher_fps(monkeypatch, tmp_path):
    monkeypatch.setattr(quality, "source_info", lambda _: {"width": 544, "height": 960, "fps": "60", "frames": 60})
    plan = quality.prepare(request(params={"resolution": "4k", "fps": 48}), tmp_path)
    assert plan["height"] == 3840 and abs(plan["width"] / plan["height"] - 544 / 960) < 1 / 3840
    assert plan["outputFrames"] == 60 and Fraction(plan["fps"]) == 60


def test_rejects_long_and_variable_rate_inputs(monkeypatch, tmp_path):
    import json
    for frames, avg, nominal in [(361, "24", "24"), (24, "23", "24")]:
        monkeypatch.setattr(subprocess, "check_output", lambda *a, **kw: json.dumps({"streams": [{"width": 320, "height": 180, "nb_read_frames": str(frames), "avg_frame_rate": avg, "r_frame_rate": nominal}]}))
        with pytest.raises(ValueError):
            quality.source_info(tmp_path / "input.mp4")


def test_nominal_fps_does_not_hide_variable_frame_timestamps(monkeypatch, tmp_path):
    import json
    probe = {"streams": [{"width": 320, "height": 180, "nb_read_frames": "24", "avg_frame_rate": "24", "r_frame_rate": "24"}],
             "frames": [{"best_effort_timestamp_time": str(i / 24 + (.01 if i == 12 else 0))} for i in range(24)]}
    monkeypatch.setattr(subprocess, "check_output", lambda *a, **kw: json.dumps(probe))
    with pytest.raises(ValueError, match="variable frame timing"):
        quality.source_info(tmp_path / "input.mp4")

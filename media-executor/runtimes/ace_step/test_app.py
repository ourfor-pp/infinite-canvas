from app import Request, build_payload


def test_text_music_disables_known_xl_artifact_combination():
    payload = build_payload(Request(operation="generate", prompt="激昂情歌", params={}, outputDir="/tmp/out"))
    assert payload["task_type"] == "text2music"
    assert payload["inference_steps"] == 50
    assert payload["shift"] == 1
    assert payload["lyrics"] == "[Instrumental]"
    assert payload["dcw_enabled"] is False
    assert payload["audio_cover_strength"] == 0


def test_cover_keeps_reference_strength():
    payload = build_payload(Request(operation="cover", prompt="摇滚改编", params={"strength": .4}, references=[{"path": "/tmp/ref.wav"}], outputDir="/tmp/out"))
    assert payload["task_type"] == "cover"
    assert payload["audio_cover_strength"] == .4
    assert payload["src_audio_path"] == "/tmp/ref.wav"

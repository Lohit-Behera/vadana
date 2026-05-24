from live_voice.errors import error_event


def test_error_event_defaults_to_unknown_code() -> None:
    ev = error_event("something broke")
    assert ev["type"] == "error"
    assert ev["message"] == "something broke"
    assert ev["code"] == "unknown"


def test_error_event_accepts_stable_codes() -> None:
    for code in ("lm_unreachable", "stt_failed", "tts_failed", "mic_unavailable"):
        ev = error_event("detail", code=code)
        assert ev["code"] == code

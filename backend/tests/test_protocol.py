from live_voice.protocol import PROTOCOL_VERSION, server_event


def test_ready_event_includes_version() -> None:
    ev = server_event("ready", port=8765, protocol_version=PROTOCOL_VERSION)
    assert ev["type"] == "ready"
    assert ev["port"] == 8765
    assert ev["protocol_version"] == 1


def test_error_event_shape() -> None:
    from live_voice.errors import error_event

    ev = error_event("fail", code="lm_unreachable")
    assert ev["type"] == "error"
    assert ev["code"] == "lm_unreachable"

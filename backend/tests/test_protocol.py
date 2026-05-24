from live_voice.protocol import PROTOCOL_VERSION, server_event


def test_ready_event() -> None:
    ev = server_event("ready", port=8765, protocol_version=PROTOCOL_VERSION)
    assert ev["type"] == "ready"
    assert ev["port"] == 8765
    assert ev["protocol_version"] == 3


def test_context_usage_event() -> None:
    ev = server_event(
        "context_usage",
        prompt_tokens=100,
        completion_tokens=20,
        total_tokens=120,
        max_context_tokens=128000,
        percent=0.09,
    )
    assert ev["type"] == "context_usage"
    assert ev["total_tokens"] == 120

"""Tests for per-chat system prompt composition."""

from live_voice.session import VoiceSession


class _FakeWs:
    pass


def test_compose_system_prompt_extends_not_replaces():
    session = VoiceSession(_FakeWs())
    session.config["system_prompt"] = "Global rules."
    session.config["chat_system_prompt"] = "This chat: interview practice."
    out = session._compose_system_prompt("Reference block.")
    assert out.startswith("Global rules.")
    assert "This chat: interview practice." in out
    assert out.endswith("Reference block.")
    assert out.index("Global") < out.index("This chat")
    assert out.index("This chat") < out.index("Reference")


def test_compose_chat_addon_only():
    session = VoiceSession(_FakeWs())
    session.config["system_prompt"] = ""
    session.config["chat_system_prompt"] = "Chat only."
    assert session._compose_system_prompt("") == "Chat only."


def test_compose_includes_reply_language_when_not_english():
    session = VoiceSession(_FakeWs())
    session.config["system_prompt"] = "Global."
    session.config["supertonic_lang"] = "hi"
    out = session._compose_system_prompt("")
    assert "Global." in out
    assert "hi" in out
    assert "primarily" in out

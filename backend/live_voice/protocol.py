"""JSON message types shared with the React client."""

from __future__ import annotations

from typing import Any, Literal

PROTOCOL_VERSION = 4

ClientMsgType = Literal[
    "config",
    "start",
    "stop",
    "interrupt",
    "ptt_down",
    "ptt_up",
    "user_text",
    "user_message",
    "knowledge_reindex",
]

ServerMsgType = Literal[
    "state",
    "stt_partial",
    "stt_final",
    "llm_token",
    "llm_reasoning_token",
    "assistant_text",
    "audio_level",
    "error",
    "notice",
    "interrupt_ack",
    "ready",
    "context_usage",
]


def server_event(msg_type: ServerMsgType, **fields: Any) -> dict[str, Any]:
    return {"type": msg_type, **fields}

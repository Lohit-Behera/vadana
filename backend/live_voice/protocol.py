"""JSON message types shared with the React client."""

from __future__ import annotations

from typing import Any, Literal

PROTOCOL_VERSION = 1

ClientMsgType = Literal[
    "config",
    "start",
    "stop",
    "interrupt",
    "ptt_down",
    "ptt_up",
    "user_text",
]

ServerMsgType = Literal[
    "state",
    "stt_partial",
    "stt_final",
    "llm_token",
    "assistant_text",
    "error",
    "notice",
    "interrupt_ack",
    "ready",
]


def server_event(msg_type: ServerMsgType, **fields: Any) -> dict[str, Any]:
    return {"type": msg_type, **fields}

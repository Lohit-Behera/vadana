from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from live_voice.llm_client import (
    LlmParams,
    StreamChunk,
    reasoning_fallback_reply,
    resolve_llm_params,
    stream_chat_completions,
    trim_messages_to_budget,
)


def test_resolve_lm_studio() -> None:
    p = resolve_llm_params("lm_studio", "gemma", "http://127.0.0.1:1234", "")
    assert p.model == "lm_studio/gemma"
    assert p.api_base == "http://127.0.0.1:1234/v1"
    assert p.api_key == "lm-studio"


def test_resolve_lm_studio_slashy_model_id() -> None:
    """LM Studio often exposes ids like google/gemma-4-e4b — must use lm_studio/ prefix."""
    p = resolve_llm_params("lm_studio", "google/gemma-4-e4b", "http://127.0.0.1:1234", "")
    assert p.model == "lm_studio/google/gemma-4-e4b"


def test_resolve_openai() -> None:
    p = resolve_llm_params("openai", "gpt-4o-mini", "", "sk-test")
    assert p.model == "openai/gpt-4o-mini"
    assert p.api_key == "sk-test"


def test_resolve_ollama() -> None:
    p = resolve_llm_params("ollama", "llama3", "http://127.0.0.1:11434", "")
    assert p.model == "ollama/llama3"
    assert p.api_base == "http://127.0.0.1:11434"


@pytest.mark.asyncio
async def test_stream_yields_tokens_and_usage() -> None:
    chunk1 = MagicMock()
    chunk1.choices = [MagicMock(delta=MagicMock(content="Hi", message=None))]
    chunk1.usage = None

    chunk2 = MagicMock()
    chunk2.choices = []
    chunk2.usage = MagicMock(prompt_tokens=10, completion_tokens=2, total_tokens=12)

    async def fake_acompletion(**_kwargs):
        async def _gen():
            yield chunk1
            yield chunk2

        return _gen()

    cancel = MagicMock()
    cancel.is_set = MagicMock(return_value=False)

    with patch("live_voice.llm_client.litellm.acompletion", new=AsyncMock(side_effect=fake_acompletion)):
        parts = [
            c
            async for c in stream_chat_completions(
                "lm_studio",
                "test-model",
                "http://127.0.0.1:1234",
                "",
                [{"role": "user", "content": "hi"}],
                cancel,
            )
        ]

    assert parts[0] == StreamChunk(text="Hi")
    assert parts[-1].usage == {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}


@pytest.mark.asyncio
async def test_stream_stops_when_cancelled() -> None:
    chunk1 = MagicMock()
    chunk1.choices = [MagicMock(delta=MagicMock(content="a", message=None))]
    chunk1.usage = None

    chunk2 = MagicMock()
    chunk2.choices = [MagicMock(delta=MagicMock(content="b", message=None))]
    chunk2.usage = None

    async def fake_acompletion(**_kwargs):
        async def _gen():
            yield chunk1
            yield chunk2

        return _gen()

    cancel = MagicMock()
    calls = {"n": 0}

    def is_set() -> bool:
        calls["n"] += 1
        return calls["n"] > 1

    cancel.is_set = is_set

    with patch("live_voice.llm_client.litellm.acompletion", new=AsyncMock(side_effect=fake_acompletion)):
        parts = [
            c
            async for c in stream_chat_completions(
                "lm_studio",
                "m",
                "http://127.0.0.1:1234",
                "",
                [],
                cancel,
            )
        ]

    assert parts == [StreamChunk(text="a")]


def test_reasoning_fallback_reply() -> None:
    assert reasoning_fallback_reply("line one\n\nfinal answer") == "final answer"
    assert reasoning_fallback_reply("   ") is None


@pytest.mark.asyncio
async def test_stream_yields_reasoning_tokens() -> None:
    chunk1 = MagicMock()
    chunk1.choices = [
        MagicMock(delta=MagicMock(content=None, message=None, reasoning_content="think "))
    ]
    chunk1.usage = None

    chunk2 = MagicMock()
    chunk2.choices = [MagicMock(delta=MagicMock(content="Hi", message=None, reasoning_content=None))]
    chunk2.usage = None

    async def fake_acompletion(**_kwargs):
        async def _gen():
            yield chunk1
            yield chunk2

        return _gen()

    cancel = MagicMock()
    cancel.is_set = MagicMock(return_value=False)

    with patch("live_voice.llm_client.litellm.acompletion", new=AsyncMock(side_effect=fake_acompletion)):
        parts = [
            c
            async for c in stream_chat_completions(
                "lm_studio",
                "test-model",
                "http://127.0.0.1:1234",
                "",
                [{"role": "user", "content": "hi"}],
                cancel,
            )
        ]

    assert parts[0] == StreamChunk(reasoning="think ")
    assert parts[1] == StreamChunk(text="Hi")


@pytest.mark.asyncio
async def test_stream_reasoning_only() -> None:
    chunk1 = MagicMock()
    chunk1.choices = [
        MagicMock(
            delta=MagicMock(content=None, message=None, reasoning_content="Only reasoning here")
        )
    ]
    chunk1.usage = None

    async def fake_acompletion(**_kwargs):
        async def _gen():
            yield chunk1

        return _gen()

    cancel = MagicMock()
    cancel.is_set = MagicMock(return_value=False)

    with patch("live_voice.llm_client.litellm.acompletion", new=AsyncMock(side_effect=fake_acompletion)):
        parts = [
            c
            async for c in stream_chat_completions(
                "lm_studio",
                "m",
                "http://127.0.0.1:1234",
                "",
                [],
                cancel,
            )
        ]

    assert parts == [StreamChunk(reasoning="Only reasoning here")]
    assert reasoning_fallback_reply("Only reasoning here") == "Only reasoning here"


def test_trim_messages_passthrough_on_short_history() -> None:
    msgs = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "hi"},
    ]
    out = trim_messages_to_budget(msgs, 128_000, "openai/gpt-4o-mini")
    assert out == msgs

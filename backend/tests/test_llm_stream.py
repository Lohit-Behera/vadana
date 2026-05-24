from unittest.mock import AsyncMock, MagicMock

import pytest

from live_voice.llm_client import stream_chat_completions


@pytest.mark.asyncio
async def test_stream_yields_delta_content() -> None:
    lines = [
        b'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
        b"data: [DONE]\n",
    ]

    async def aiter_bytes():
        for line in lines:
            yield line

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.aiter_bytes = aiter_bytes
    resp.aclose = AsyncMock()

    client = MagicMock()
    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=resp)
    stream_cm.__aexit__ = AsyncMock(return_value=None)
    client.stream = MagicMock(return_value=stream_cm)

    cancel = MagicMock()
    cancel.is_set = MagicMock(return_value=False)

    tokens = [
        t
        async for t in stream_chat_completions(
            client,
            "http://127.0.0.1:1234",
            "test-model",
            [{"role": "user", "content": "hi"}],
            cancel,
        )
    ]
    assert tokens == ["Hi"]
    payload = client.stream.call_args.kwargs["json"]
    assert payload["model"] == "test-model"
    assert payload["stream"] is True


@pytest.mark.asyncio
async def test_stream_yields_message_style_delta() -> None:
    lines = [
        b'data: {"choices":[{"delta":{"message":{"content":"Hello"}}}]}\n',
        b"data: [DONE]\n",
    ]

    async def aiter_bytes():
        for line in lines:
            yield line

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.aiter_bytes = aiter_bytes
    resp.aclose = AsyncMock()

    client = MagicMock()
    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=resp)
    stream_cm.__aexit__ = AsyncMock(return_value=None)
    client.stream = MagicMock(return_value=stream_cm)

    cancel = MagicMock()
    cancel.is_set = MagicMock(return_value=False)

    tokens = [
        t
        async for t in stream_chat_completions(
            client,
            "http://127.0.0.1:1234/",
            "test-model",
            [],
            cancel,
        )
    ]
    assert tokens == ["Hello"]


@pytest.mark.asyncio
async def test_stream_skips_malformed_sse_json() -> None:
    lines = [
        b"data: {not-json}\n",
        b'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
        b"data: [DONE]\n",
    ]

    async def aiter_bytes():
        for line in lines:
            yield line

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.aiter_bytes = aiter_bytes
    resp.aclose = AsyncMock()

    client = MagicMock()
    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=resp)
    stream_cm.__aexit__ = AsyncMock(return_value=None)
    client.stream = MagicMock(return_value=stream_cm)

    cancel = MagicMock()
    cancel.is_set = MagicMock(return_value=False)

    tokens = [
        t
        async for t in stream_chat_completions(
            client,
            "http://127.0.0.1:1234",
            "m",
            [],
            cancel,
        )
    ]
    assert tokens == ["ok"]


@pytest.mark.asyncio
async def test_stream_stops_when_cancelled() -> None:
    lines = [
        b'data: {"choices":[{"delta":{"content":"a"}}]}\n',
        b'data: {"choices":[{"delta":{"content":"b"}}]}\n',
    ]

    async def aiter_bytes():
        for line in lines:
            yield line

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.aiter_bytes = aiter_bytes
    resp.aclose = AsyncMock()

    client = MagicMock()
    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=resp)
    stream_cm.__aexit__ = AsyncMock(return_value=None)
    client.stream = MagicMock(return_value=stream_cm)

    cancel = MagicMock()
    calls = {"n": 0}

    def is_set() -> bool:
        calls["n"] += 1
        return calls["n"] > 1

    cancel.is_set = is_set

    tokens = [
        t
        async for t in stream_chat_completions(
            client,
            "http://127.0.0.1:1234",
            "m",
            [],
            cancel,
        )
    ]
    assert tokens == ["a"]
    resp.aclose.assert_awaited()

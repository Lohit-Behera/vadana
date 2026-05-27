"""LiteLLM streaming chat with multi-provider support."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import litellm

logger = logging.getLogger(__name__)

# Avoid verbose LiteLLM logs in the sidecar.
litellm.suppress_debug_info = True


@dataclass(frozen=True)
class LlmParams:
    model: str
    api_base: str | None
    api_key: str | None


@dataclass
class StreamChunk:
    """Token text, reasoning delta, or final usage from a streaming completion."""

    text: str | None = None
    reasoning: str | None = None
    usage: dict[str, int] | None = None


def reasoning_fallback_reply(reasoning_accum: str) -> str | None:
    """Use last non-empty reasoning line when the model never streams final content."""
    if not reasoning_accum.strip():
        return None
    for line in reversed(reasoning_accum.splitlines()):
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def _normalize_api_base(url: str | None) -> str | None:
    if not url:
        return None
    base = url.rstrip("/")
    if base.endswith("/v1"):
        return base
    return f"{base}/v1"


def _lm_studio_model(raw_model: str) -> str:
    """Prefix LM Studio model ids for LiteLLM's native ``lm_studio/`` provider.

    Ids like ``google/gemma-4-e4b`` become ``lm_studio/google/gemma-4-e4b`` so LiteLLM
    does not treat ``google`` as the Google/Gemini provider.
    See https://docs.litellm.ai/docs/providers/lm_studio
    """
    if raw_model.startswith("lm_studio/"):
        return raw_model
    return f"lm_studio/{raw_model}"


def resolve_llm_params(
    provider: str,
    model: str,
    lm_base_url: str,
    api_key: str,
) -> LlmParams:
    """Map Vadana provider + model id to LiteLLM model string and connection params."""
    prov = (provider or "lm_studio").strip().lower()
    raw_model = (model or "local-model").strip()
    key = (api_key or "").strip() or None

    if prov == "lm_studio":
        return LlmParams(
            model=_lm_studio_model(raw_model),
            api_base=_normalize_api_base(lm_base_url),
            api_key=key or "lm-studio",
        )
    if prov == "openai":
        litellm_model = raw_model if raw_model.startswith("openai/") else f"openai/{raw_model}"
        return LlmParams(model=litellm_model, api_base=None, api_key=key)
    if prov == "anthropic":
        litellm_model = raw_model if raw_model.startswith("anthropic/") else f"anthropic/{raw_model}"
        return LlmParams(model=litellm_model, api_base=None, api_key=key)
    if prov == "ollama":
        litellm_model = raw_model if raw_model.startswith("ollama/") else f"ollama/{raw_model}"
        base = _normalize_api_base(lm_base_url) if lm_base_url else "http://127.0.0.1:11434"
        if base and base.endswith("/v1"):
            base = base[:-3]
        return LlmParams(model=litellm_model, api_base=base, api_key=key)
    if prov == "groq":
        litellm_model = raw_model if raw_model.startswith("groq/") else f"groq/{raw_model}"
        return LlmParams(model=litellm_model, api_base=None, api_key=key)
    if prov == "openrouter":
        litellm_model = (
            raw_model if raw_model.startswith("openrouter/") else f"openrouter/{raw_model}"
        )
        base = _normalize_api_base(lm_base_url) if lm_base_url else "https://openrouter.ai/api/v1"
        return LlmParams(model=litellm_model, api_base=base, api_key=key)

    # Unknown provider with a local base URL: default to native LM Studio routing.
    return LlmParams(
        model=_lm_studio_model(raw_model),
        api_base=_normalize_api_base(lm_base_url),
        api_key=key or "lm-studio",
    )


def _usage_dict(usage: Any) -> dict[str, int] | None:
    if usage is None:
        return None
    if isinstance(usage, dict):
        pt = int(usage.get("prompt_tokens") or 0)
        ct = int(usage.get("completion_tokens") or 0)
        tt = int(usage.get("total_tokens") or pt + ct)
    else:
        pt = int(getattr(usage, "prompt_tokens", 0) or 0)
        ct = int(getattr(usage, "completion_tokens", 0) or 0)
        tt = int(getattr(usage, "total_tokens", 0) or pt + ct)
    if pt == 0 and ct == 0 and tt == 0:
        return None
    return {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt}


def _delta_field(chunk: Any, field: str) -> str | None:
    choices = getattr(chunk, "choices", None) or []
    if not choices:
        return None
    c0 = choices[0]
    delta = getattr(c0, "delta", None)
    if delta is not None:
        piece = getattr(delta, field, None)
        if isinstance(piece, str) and piece:
            return piece
        msg = getattr(delta, "message", None)
        if msg is not None:
            m = getattr(msg, field, None)
            if isinstance(m, str) and m:
                return m
    return None


def _delta_text(chunk: Any) -> str | None:
    return _delta_field(chunk, "content")


def _delta_reasoning(chunk: Any) -> str | None:
    return _delta_field(chunk, "reasoning_content")


def trim_messages_to_budget(
    messages: list[dict[str, Any]],
    max_tokens: int,
    model: str,
) -> list[dict[str, Any]]:
    """Drop oldest non-system messages until estimated tokens fit budget."""
    if max_tokens <= 0 or len(messages) <= 2:
        return messages
    try:
        trimmed = litellm.trim_messages(messages, model=model, max_tokens=max_tokens)
        if isinstance(trimmed, list) and trimmed:
            if len(trimmed) < len(messages):
                logger.info(
                    "Trimmed chat history %d -> %d messages (max_tokens=%d)",
                    len(messages),
                    len(trimmed),
                    max_tokens,
                )
            return trimmed  # type: ignore[return-value]
    except Exception as exc:  # noqa: BLE001
        logger.warning("litellm.trim_messages failed: %s", exc)
    return messages


async def stream_chat_completions(
    provider: str,
    model: str,
    lm_base_url: str,
    api_key: str,
    messages: list[dict[str, Any]],
    cancel_event: Any,
    max_tokens: int = 128_000,
) -> AsyncIterator[StreamChunk]:
    """Stream LLM tokens; final chunk may carry usage only.

    Future RAG: pass tools=[{"type": "file_search", "vector_store_ids": [...]}]
    after configuring litellm.vector_store_registry (see LiteLLM knowledge base docs).
    """
    params = resolve_llm_params(provider, model, lm_base_url, api_key)
    trimmed = trim_messages_to_budget(messages, max_tokens, params.model)  # type: ignore[arg-type]

    kwargs: dict[str, Any] = {
        "model": params.model,
        "messages": trimmed,
        "stream": True,
        "temperature": 0.7,
        "stream_options": {"include_usage": True},
    }
    if params.api_base:
        kwargs["api_base"] = params.api_base
    if params.api_key:
        kwargs["api_key"] = params.api_key

    logger.info(
        "LiteLLM stream model=%r api_base=%r messages=%d",
        params.model,
        params.api_base,
        len(trimmed),
    )

    response = await litellm.acompletion(**kwargs)
    usage_out: dict[str, int] | None = None

    async for chunk in response:
        if cancel_event.is_set():
            break
        text = _delta_text(chunk)
        if text:
            yield StreamChunk(text=text)
        reasoning = _delta_reasoning(chunk)
        if reasoning:
            yield StreamChunk(reasoning=reasoning)
        u = _usage_dict(getattr(chunk, "usage", None))
        if u:
            usage_out = u

    if usage_out:
        yield StreamChunk(usage=usage_out)

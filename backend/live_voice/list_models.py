"""Fetch available LLM model ids from provider APIs (OpenAI-compatible, Ollama, Anthropic catalog)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

ANTHROPIC_MODELS = [
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
]

DEFAULT_BASE: dict[str, str] = {
    "lm_studio": "http://127.0.0.1:1234",
    "ollama": "http://127.0.0.1:11434",
    "openai": "https://api.openai.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}


def _normalize_openai_base(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return base
    return base if base.endswith("/v1") else f"{base}/v1"


def _ollama_root(base_url: str) -> str:
    base = (base_url or DEFAULT_BASE["ollama"]).strip().rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3].rstrip("/")
    return base or DEFAULT_BASE["ollama"]


def _openai_compatible_models(
    *,
    url: str,
    provider: str,
    api_key: str | None,
    timeout: float = 12.0,
) -> list[dict[str, str]]:
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    with httpx.Client(timeout=timeout) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    entries = data.get("data") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return []
    out: list[dict[str, str]] = []
    for item in entries:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            out.append({"id": item["id"], "provider": provider})
    out.sort(key=lambda x: x["id"])
    return out


def _ollama_models(base_url: str, timeout: float = 12.0) -> list[dict[str, str]]:
    root = _ollama_root(base_url)
    url = f"{root.rstrip('/')}/api/tags"
    with httpx.Client(timeout=timeout) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list):
        return []
    out: list[dict[str, str]] = []
    for item in models:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            out.append({"id": item["name"], "provider": "ollama"})
    out.sort(key=lambda x: x["id"])
    return out


def list_models_for_provider(
    provider: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
) -> list[dict[str, str]]:
    """Return normalized model entries: ``{"id": "...", "provider": "..."}``."""
    prov = (provider or "lm_studio").strip().lower()
    if prov == "anthropic":
        return [{"id": mid, "provider": "anthropic"} for mid in ANTHROPIC_MODELS]

    if prov == "ollama":
        root = base_url or DEFAULT_BASE["ollama"]
        return _ollama_models(root)

    if prov == "openai":
        base = _normalize_openai_base(base_url or DEFAULT_BASE["openai"])
        return _openai_compatible_models(
            url=f"{base}/models",
            provider="openai",
            api_key=api_key,
        )

    if prov == "groq":
        base = _normalize_openai_base(base_url or DEFAULT_BASE["groq"])
        return _openai_compatible_models(
            url=f"{base}/models",
            provider="groq",
            api_key=api_key,
        )

    if prov == "openrouter":
        base = _normalize_openai_base(base_url or DEFAULT_BASE["openrouter"])
        return _openai_compatible_models(
            url=f"{base}/models",
            provider="openrouter",
            api_key=api_key,
        )

    if prov in ("lm_studio", "lmstudio"):
        base = _normalize_openai_base(base_url or DEFAULT_BASE["lm_studio"])
        return _openai_compatible_models(
            url=f"{base}/models",
            provider="lm_studio",
            api_key=api_key or "lm-studio",
        )

    raise ValueError(f"Unsupported provider: {prov}")


def list_models_cli() -> None:
    """CLI: ``uv run python -m live_voice.list_models lm_studio http://127.0.0.1:1234``."""
    import json
    import sys

    prov = sys.argv[1] if len(sys.argv) > 1 else "lm_studio"
    base = sys.argv[2] if len(sys.argv) > 2 else None
    key = sys.argv[3] if len(sys.argv) > 3 else None
    models = list_models_for_provider(prov, base_url=base, api_key=key)
    print(json.dumps(models, indent=2))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    list_models_cli()

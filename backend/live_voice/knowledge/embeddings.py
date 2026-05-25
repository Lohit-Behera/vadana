"""Embedding model factory — FastEmbed (ONNX) default, HuggingFace optional."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from typing import Any

from live_voice.hf_env import configure_hf_hub

configure_hf_hub()

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


def _direct_fastembed_embedding(model_name: str):
    """Load FastEmbed without importing fastembed.image (avoids fragile hf_hub lazy imports)."""
    from fastembed.text.text_embedding import TextEmbedding
    from llama_index.core.base.embeddings.base import BaseEmbedding
    from llama_index.core.bridge.pydantic import ConfigDict, PrivateAttr

    class _DirectFastEmbed(BaseEmbedding):
        model_config = ConfigDict(arbitrary_types_allowed=True)

        _model: TextEmbedding = PrivateAttr()

        def __init__(self, **kwargs: Any) -> None:
            super().__init__(model_name=model_name, **kwargs)
            self._model = TextEmbedding(model_name=model_name)

        @classmethod
        def class_name(cls) -> str:
            return "DirectFastEmbedEmbedding"

        def _get_text_embedding(self, text: str) -> list[float]:
            return self._get_text_embeddings([text])[0]

        async def _aget_text_embedding(self, text: str) -> list[float]:
            return await asyncio.to_thread(self._get_text_embedding, text)

        def _get_text_embeddings(self, texts: list[str]) -> list[list[float]]:
            return [e.tolist() for e in self._model.embed(texts)]

        async def _aget_text_embeddings(self, texts: list[str]) -> list[list[float]]:
            return await asyncio.to_thread(self._get_text_embeddings, texts)

        def _get_query_embedding(self, query: str) -> list[float]:
            return self._get_text_embedding(query)

        async def _aget_query_embedding(self, query: str) -> list[float]:
            return await asyncio.to_thread(self._get_query_embedding, query)

    return _DirectFastEmbed()


def create_embed_model(
    provider: str = "local",
    *,
    on_progress: Callable[[str], None] | None = None,
):
    """Return a LlamaIndex embedding model."""
    if provider and provider not in ("local", "lm_studio", "ollama"):
        logger.info(
            "Knowledge embeddings: cloud provider %r not implemented; using local",
            provider,
        )
    model_name = os.environ.get("LIVE_VOICE_KNOWLEDGE_EMBED_MODEL", DEFAULT_MODEL)
    backend = os.environ.get("LIVE_VOICE_KNOWLEDGE_EMBED_BACKEND", "fastembed").strip().lower()

    if backend == "huggingface":
        if on_progress:
            on_progress(f"Loading HuggingFace embeddings ({model_name})…")
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        return HuggingFaceEmbedding(model_name=model_name)

    if on_progress:
        on_progress(f"Loading FastEmbed model ({model_name})…")

    try:
        return _direct_fastembed_embedding(model_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Direct FastEmbed load failed (%s); trying LlamaIndex wrapper", exc)

    try:
        from llama_index.embeddings.fastembed import FastEmbedEmbedding

        return FastEmbedEmbedding(model_name=model_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("FastEmbedEmbedding failed (%s); trying HuggingFace fallback", exc)
        if on_progress:
            on_progress(f"Loading HuggingFace fallback ({model_name})…")
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        return HuggingFaceEmbedding(model_name=model_name)

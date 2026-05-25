"""LlamaIndex knowledge base for reference context injection."""

from live_voice.knowledge.context import build_reference_context
from live_voice.knowledge.manager import KnowledgeManager

__all__ = ["KnowledgeManager", "build_reference_context"]

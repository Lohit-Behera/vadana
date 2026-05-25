"""Build reference-knowledge system message text for the LLM."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from live_voice.knowledge.loaders import load_file_text

logger = logging.getLogger(__name__)

SMALL_CHAR_THRESHOLD = 8_000
MAX_REFERENCE_CHARS = 24_000
RAG_TOP_K = 4

REF_HEADER = (
    "Reference knowledge about the user (from their uploaded documents). "
    "You have this information — use it. For questions like who they are or their resume, "
    "answer from this text; do not say you lack access to their files. "
    "Do not read this block aloud verbatim.\n\n"
)


def _globally_enabled(entry: dict[str, Any]) -> bool:
    return bool(entry.get("enabled")) and bool(entry.get("folder_enabled"))


def resolve_active_file_ids(
    mode: str,
    selection: dict[str, Any],
    catalog: list[dict[str, Any]],
) -> list[str]:
    if mode == "off" or not catalog:
        return []
    if mode == "all_enabled":
        return [str(e["id"]) for e in catalog if e.get("id")]
    enabled_entries = [e for e in catalog if _globally_enabled(e)]
    if mode == "selected":
        folder_ids = {
            str(x) for x in (selection.get("folder_ids") or selection.get("folderIds") or [])
        }
        file_ids = {str(x) for x in (selection.get("file_ids") or selection.get("fileIds") or [])}
        if not folder_ids and not file_ids:
            return []
        out: list[str] = []
        for e in catalog:
            fid = str(e.get("id", ""))
            if fid in file_ids or str(e.get("folder_id", "")) in folder_ids:
                out.append(fid)
        return out
    return []


def _catalog_by_id(catalog: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(e["id"]): e for e in catalog if e.get("id")}


def _read_full_text(
    knowledge_dir: Path,
    entry: dict[str, Any],
    *,
    text_cache: dict[str, str] | None = None,
    prefer_fast: bool = False,
) -> str:
    fid = str(entry.get("id", ""))
    if text_cache is not None and fid and fid in text_cache:
        return text_cache[fid]
    rel = str(entry.get("rel_path", "")).replace("\\", "/")
    path = knowledge_dir / rel
    if not path.is_file():
        logger.warning("Knowledge file missing: %s", path)
        return ""
    try:
        text = load_file_text(path, prefer_fast=prefer_fast)
        if text_cache is not None and fid and text.strip():
            text_cache[fid] = text
        return text
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load %s: %s", path, exc)
        return ""


def build_reference_context(
    query: str,
    *,
    mode: str,
    selection: dict[str, Any],
    catalog: list[dict[str, Any]],
    knowledge_dir: Path,
    manager: Any | None = None,
    text_cache: dict[str, str] | None = None,
    prefer_fast: bool = False,
) -> str:
    """Return reference block for a separate system message, or empty string."""
    file_ids = resolve_active_file_ids(mode, selection, catalog)
    if not file_ids:
        logger.info("Knowledge: no active file ids (mode=%s)", mode)
        return ""

    by_id = _catalog_by_id(catalog)
    parts: list[str] = []
    total_chars = 0
    rag_ids: list[str] = []

    for fid in file_ids:
        entry = by_id.get(fid)
        if not entry:
            continue
        char_count = int(entry.get("char_count") or 0)
        if char_count <= 0:
            text = _read_full_text(
                knowledge_dir,
                entry,
                text_cache=text_cache,
                prefer_fast=prefer_fast,
            )
            char_count = len(text)
        else:
            text = ""

        if char_count < SMALL_CHAR_THRESHOLD:
            if not text:
                text = _read_full_text(
                    knowledge_dir,
                    entry,
                    text_cache=text_cache,
                    prefer_fast=prefer_fast,
                )
            if not text.strip():
                continue
            block = f"### {entry.get('filename', fid)}\n{text.strip()}\n"
            if total_chars + len(block) > MAX_REFERENCE_CHARS:
                break
            parts.append(block)
            total_chars += len(block)
        else:
            rag_ids.append(fid)

    if rag_ids and manager is not None and manager.is_ready:
        chunks = manager.retrieve(query, file_ids=rag_ids, top_k=RAG_TOP_K)
        for chunk in chunks:
            name = chunk.get("filename") or chunk.get("file_id", "")
            body = (chunk.get("text") or "").strip()
            if not body:
                continue
            block = f"### {name}\n{body}\n"
            if total_chars + len(block) > MAX_REFERENCE_CHARS:
                break
            parts.append(block)
            total_chars += len(block)
    elif rag_ids and (manager is None or not manager.is_ready):
        for fid in rag_ids:
            entry = by_id.get(fid)
            if not entry:
                continue
            text = _read_full_text(
                knowledge_dir,
                entry,
                text_cache=text_cache,
                prefer_fast=prefer_fast,
            )
            if not text.strip():
                continue
            excerpt = text[:4000] + ("…" if len(text) > 4000 else "")
            block = f"### {entry.get('filename', fid)} (excerpt)\n{excerpt}\n"
            if total_chars + len(block) > MAX_REFERENCE_CHARS:
                break
            parts.append(block)
            total_chars += len(block)

    if not parts:
        logger.warning(
            "Knowledge: mode=%s had %d file id(s) but no extractable text",
            mode,
            len(file_ids),
        )
        return ""
    logger.info(
        "Knowledge: built reference from %d section(s), %d chars",
        len(parts),
        sum(len(p) for p in parts),
    )
    return REF_HEADER + "\n".join(parts)

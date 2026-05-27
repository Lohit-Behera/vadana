"""Global LlamaIndex vector index for knowledge documents."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from live_voice.knowledge.context import SMALL_CHAR_THRESHOLD
from live_voice.knowledge.embeddings import create_embed_model
from live_voice.knowledge.fingerprint import (
    all_enabled_already_indexed,
    entry_already_indexed,
    library_fingerprint,
)
from live_voice.knowledge.loaders import load_file_text, reset_docling_converter

logger = logging.getLogger(__name__)


class KnowledgeManager:
    def __init__(self) -> None:
        self._index = None
        self._embed = None
        self._last_error: str | None = None
        self._doc_count = 0
        self._rebuilding = False
        self._last_library_fingerprint: str = self._read_persisted_fingerprint()

    @property
    def is_ready(self) -> bool:
        return self._index is not None

    @property
    def last_error(self) -> str | None:
        return self._last_error

    @property
    def doc_count(self) -> int:
        return self._doc_count

    @property
    def rebuilding(self) -> bool:
        return self._rebuilding

    def _knowledge_dir(self) -> Path:
        raw = os.environ.get("LIVE_VOICE_KNOWLEDGE_DIR", "").strip()
        return Path(raw) if raw else Path()

    def _index_dir(self) -> Path:
        raw = os.environ.get("LIVE_VOICE_KNOWLEDGE_INDEX_DIR", "").strip()
        return Path(raw) if raw else Path()

    def _fingerprint_path(self) -> Path:
        return self._index_dir() / ".library_fingerprint"

    def _read_persisted_fingerprint(self) -> str:
        path = self._fingerprint_path()
        if not path.is_file():
            return ""
        return path.read_text(encoding="utf-8").strip()

    def _persist_fingerprint(self, fp: str) -> None:
        if not fp:
            return
        index_dir = self._index_dir()
        index_dir.mkdir(parents=True, exist_ok=True)
        self._fingerprint_path().write_text(fp, encoding="utf-8")
        self._last_library_fingerprint = fp

    def _ensure_embed(self, on_progress: Callable[[str], None] | None = None) -> None:
        if self._embed is None:
            self._embed = create_embed_model(on_progress=on_progress)

    def _load_persisted(self) -> bool:
        index_dir = self._index_dir()
        if not index_dir.is_dir():
            return False
        try:
            from llama_index.core import StorageContext, load_index_from_storage

            self._ensure_embed()
            storage = StorageContext.from_defaults(persist_dir=str(index_dir))
            self._index = load_index_from_storage(storage, embed_model=self._embed)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.info("No persisted knowledge index yet: %s", exc)
            return False

    async def _notify(
        self,
        send_notice: Any | None,
        msg: str,
        *,
        phase: str | None = None,
        percent: int | None = None,
    ) -> None:
        if not send_notice:
            return
        try:
            await send_notice(msg, phase=phase, percent=percent)
        except TypeError:
            await send_notice(msg)

    async def rebuild(
        self,
        catalog: list[dict[str, Any]],
        *,
        send_notice: Any | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        """Rebuild global index from enabled catalog entries."""
        if self._rebuilding:
            return {"ok": False, "error": "reindex_already_running"}
        self._rebuilding = True
        self._last_error = None
        try:
            fp = library_fingerprint(catalog)
            if not self._last_library_fingerprint:
                self._last_library_fingerprint = self._read_persisted_fingerprint()
            if not force and all_enabled_already_indexed(catalog):
                enabled = [
                    e for e in catalog if e.get("enabled") and e.get("folder_enabled")
                ]
                self._persist_fingerprint(fp)
                logger.info(
                    "Knowledge index up to date (%d document(s)), skipped rebuild",
                    len(enabled),
                )
                return {
                    "ok": True,
                    "doc_count": len(enabled),
                    "node_count": 0,
                    "skipped": True,
                    "char_updates": [],
                }

            await self._notify(
                send_notice,
                "Starting knowledge index rebuild…",
                phase="start",
                percent=0,
            )

            root = self._knowledge_dir()
            if not root.is_dir():
                raise RuntimeError("Knowledge directory not configured")

            enabled = [
                e
                for e in catalog
                if e.get("enabled") and e.get("folder_enabled")
            ]
            char_updates: list[tuple[str, int]] = []
            documents: list[Any] = []

            total = len(enabled)
            await self._notify(
                send_notice,
                f"Loading {total} enabled document(s)…",
                phase="load",
                percent=5 if total else 10,
            )

            Document: Any = None
            if total > 0:
                from llama_index.core import Document as Doc

                Document = Doc

            loop = asyncio.get_running_loop()

            def make_parse_progress(filename: str) -> Callable[[str], None]:
                def report(msg: str) -> None:
                    asyncio.run_coroutine_threadsafe(
                        self._notify(
                            send_notice,
                            msg,
                            phase="parse",
                            percent=8,
                        ),
                        loop,
                    )

                return report

            for i, entry in enumerate(enabled):
                rel = str(entry.get("rel_path", "")).replace("\\", "/")
                path = root / rel
                name = str(entry.get("filename", path.name))
                if not path.is_file():
                    await self._notify(
                        send_notice,
                        f"Skipped missing file: {name}",
                        phase="load",
                    )
                    continue
                prior_chars = int(entry.get("char_count") or 0)
                if (
                    Document is not None
                    and entry_already_indexed(entry)
                    and prior_chars > 0
                ):
                    if prior_chars < SMALL_CHAR_THRESHOLD:
                        documents.append(
                            Document(
                                text=" ",  # placeholder; full text loaded at chat time
                                metadata={
                                    "file_id": str(entry.get("id", "")),
                                    "folder_id": str(entry.get("folder_id", "")),
                                    "filename": name,
                                    "indexed": True,
                                },
                            ),
                        )
                        await self._notify(
                            send_notice,
                            f"Using indexed copy of {name} ({prior_chars:,} chars)",
                            phase="load",
                            percent=5 + int(20 * i / max(total, 1)),
                        )
                        continue
                try:
                    await self._notify(
                        send_notice,
                        f"Parsing {name}…",
                        phase="parse",
                        percent=5 + int(20 * i / max(total, 1)),
                    )
                    text = await asyncio.to_thread(
                        load_file_text,
                        path,
                        on_progress=make_parse_progress(name),
                        prefer_fast=True,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Skip %s: %s", path, exc)
                    await self._notify(
                        send_notice,
                        f"Could not read {name}: {exc}",
                        phase="load",
                    )
                    continue
                if not text.strip():
                    continue
                fid = str(entry.get("id", ""))
                char_updates.append((fid, len(text)))
                documents.append(
                    Document(
                        text=text,
                        metadata={
                            "file_id": fid,
                            "folder_id": str(entry.get("folder_id", "")),
                            "filename": name,
                        },
                    ),
                )
                pct = 5 + int(25 * (i + 1) / max(total, 1))
                await self._notify(
                    send_notice,
                    f"Loaded {name} ({len(text):,} chars)",
                    phase="load",
                    percent=min(pct, 30),
                )

            index_dir = self._index_dir()
            index_dir.mkdir(parents=True, exist_ok=True)

            if not documents:
                self._index = None
                self._doc_count = 0
                for f in index_dir.iterdir():
                    if f.is_file():
                        f.unlink(missing_ok=True)
                await self._notify(
                    send_notice,
                    "No enabled documents — turn on the folder and file toggle(s), then rebuild.",
                    phase="done",
                    percent=100,
                )
                return {"ok": True, "doc_count": 0, "char_updates": char_updates}

            all_small = all(len(d.text or "") < SMALL_CHAR_THRESHOLD for d in documents)
            if all_small:
                self._index = None
                self._doc_count = len(documents)
                for f in index_dir.iterdir():
                    if f.is_file():
                        f.unlink(missing_ok=True)
                await self._notify(
                    send_notice,
                    f"Ready — {self._doc_count} document(s) parsed for full-text injection "
                    "(under size limit; vector index not required).",
                    phase="done",
                    percent=100,
                )
                self._persist_fingerprint(fp)
                return {
                    "ok": True,
                    "doc_count": self._doc_count,
                    "node_count": 0,
                    "char_updates": char_updates,
                }

            from llama_index.core import VectorStoreIndex
            from llama_index.core.node_parser import SentenceSplitter

            await self._notify(
                send_notice,
                "Loading embedding model (FastEmbed ONNX; first run may download weights)…",
                phase="download",
                percent=35,
            )

            def embed_progress(msg: str) -> None:
                asyncio.run_coroutine_threadsafe(
                    self._notify(send_notice, msg, phase="download", percent=45),
                    loop,
                )

            await asyncio.to_thread(self._ensure_embed, embed_progress)
            await self._notify(
                send_notice,
                "Embedding model ready",
                phase="download",
                percent=55,
            )

            await self._notify(
                send_notice,
                f"Chunking {len(documents)} document(s)…",
                phase="chunk",
                percent=60,
            )
            splitter = SentenceSplitter(chunk_size=512, chunk_overlap=64)
            nodes = splitter.get_nodes_from_documents(documents)
            await self._notify(
                send_notice,
                f"Embedding {len(nodes)} chunk(s) into vector index…",
                phase="embed",
                percent=75,
            )
            self._index = VectorStoreIndex(nodes, embed_model=self._embed)
            await self._notify(
                send_notice,
                "Saving index to disk…",
                phase="persist",
                percent=90,
            )
            self._index.storage_context.persist(persist_dir=str(index_dir))
            self._doc_count = len(documents)

            await self._notify(
                send_notice,
                f"Done — {self._doc_count} document(s), {len(nodes)} chunk(s) indexed.",
                phase="done",
                percent=100,
            )
            self._persist_fingerprint(fp)
            return {
                "ok": True,
                "doc_count": self._doc_count,
                "node_count": len(nodes),
                "char_updates": char_updates,
            }
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
            logger.exception("Knowledge rebuild failed")
            await self._notify(
                send_notice,
                f"Rebuild failed: {exc}",
                phase="error",
            )
            return {"ok": False, "error": str(exc)}
        finally:
            reset_docling_converter()
            self._rebuilding = False

    def ensure_loaded(self) -> None:
        if self._index is None:
            self._load_persisted()

    def retrieve(
        self,
        query: str,
        *,
        file_ids: list[str],
        top_k: int = 4,
    ) -> list[dict[str, str]]:
        self.ensure_loaded()
        if self._index is None or not query.strip():
            return []
        try:
            from llama_index.core.vector_stores import MetadataFilter, MetadataFilters

            filters = MetadataFilters(
                filters=[MetadataFilter(key="file_id", value=fid) for fid in file_ids],
                condition="or",
            )
            retriever = self._index.as_retriever(
                similarity_top_k=top_k,
                filters=filters,
            )
            nodes = retriever.retrieve(query)
            out: list[dict[str, str]] = []
            for n in nodes:
                meta = n.metadata or {}
                out.append(
                    {
                        "file_id": str(meta.get("file_id", "")),
                        "filename": str(meta.get("filename", "")),
                        "text": n.get_content(),
                    },
                )
            return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("Knowledge retrieve failed: %s", exc)
            return []

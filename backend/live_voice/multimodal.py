"""Build LiteLLM multimodal message content from staged attachment files."""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
from pathlib import Path
from typing import Any

import litellm

logger = logging.getLogger(__name__)

MAX_IMAGES = 4
MAX_PDFS = 1
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024

AttachmentDict = dict[str, str]

_WIN_LONG_PREFIX = "\\\\?\\"


def _strip_win_long_prefix(path: Path) -> Path:
    """Normalize ``\\\\?\\`` extended paths so they compare with normal Windows paths."""
    import os

    s = str(path)
    if os.name == "nt" and s.startswith(_WIN_LONG_PREFIX):
        return Path(s[len(_WIN_LONG_PREFIX) :])
    return path


class MultimodalError(Exception):
    """User-facing multimodal validation error."""

    def __init__(self, message: str, code: str = "model_no_multimodal") -> None:
        super().__init__(message)
        self.code = code


def attachments_root(config_dir: str | None = None) -> Path | None:
    """Resolve attachments directory from session config and/or process env."""
    import os

    raw = (config_dir or "").strip() or os.environ.get("LIVE_VOICE_ATTACHMENTS_DIR", "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.exists():
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("Could not create attachments dir %s: %s", path, exc)
            return None
    return _strip_win_long_prefix(path.resolve())


def _path_under_root(candidate: Path, root: Path) -> bool:
    """True if candidate is root or a file/dir under root (Windows-safe)."""
    import os

    root_resolved = _strip_win_long_prefix(root.resolve())
    cand_resolved = _strip_win_long_prefix(candidate.resolve())
    try:
        cand_resolved.relative_to(root_resolved)
        return True
    except ValueError:
        pass
    if os.name == "nt":
        root_s = os.path.normcase(str(root_resolved))
        cand_s = os.path.normcase(str(cand_resolved))
        sep = os.sep
        return cand_s == root_s or cand_s.startswith(root_s + sep)
    return False


def _resolve_by_id(att_id: str, root: Path) -> Path | None:
    """Find staged file as ``{id}.*`` under attachments root (preferred on Windows)."""
    if not att_id.strip():
        return None
    matches = sorted(root.glob(f"{att_id.strip()}.*"))
    for p in matches:
        if p.is_file():
            return p
    return None


def resolve_safe_path(path_str: str, root: Path, *, att_id: str = "") -> Path:
    """Resolve path and ensure it stays under attachments root."""
    root_resolved = _strip_win_long_prefix(root.resolve())

    by_id = _resolve_by_id(att_id, root_resolved)
    if by_id is not None:
        return by_id

    if not path_str.strip():
        raise MultimodalError("Missing attachment path", code="invalid_attachment")
    candidate = _strip_win_long_prefix(Path(path_str).expanduser())
    if not candidate.is_absolute():
        candidate = _strip_win_long_prefix((root_resolved / candidate).resolve())
    else:
        candidate = _strip_win_long_prefix(candidate.resolve())
    if not _path_under_root(candidate, root_resolved):
        logger.warning(
            "Attachment path outside root: candidate=%s root=%s",
            candidate,
            root_resolved,
        )
        raise MultimodalError("Invalid attachment path", code="invalid_attachment")
    if not candidate.is_file():
        logger.warning("Attachment file missing: %s (root=%s)", candidate, root_resolved)
        raise MultimodalError(
            "Attachment file not found on disk. Try attaching again.",
            code="invalid_attachment",
        )
    return candidate


def _read_data_uri(path: Path, mime: str) -> str:
    data = path.read_bytes()
    if mime.startswith("image/") and len(data) > MAX_IMAGE_BYTES:
        raise MultimodalError(f"Image exceeds {MAX_IMAGE_BYTES // (1024 * 1024)} MB limit")
    if mime == "application/pdf" and len(data) > MAX_PDF_BYTES:
        raise MultimodalError(f"PDF exceeds {MAX_PDF_BYTES // (1024 * 1024)} MB limit")
    b64 = base64.standard_b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _mime_for(path: Path, kind: str, declared: str) -> str:
    if declared and declared != "application/octet-stream":
        return declared
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed:
        return guessed
    if kind == "pdf":
        return "application/pdf"
    return "image/jpeg"


# LiteLLM's model registry often marks local ids as non-vision; LM Studio/Ollama decide per load.
_LOCAL_OPENAI_COMPAT = frozenset({"lm_studio", "ollama"})


def _litellm_provider(model: str) -> str:
    if "/" in model:
        return model.split("/", 1)[0].lower()
    return ""


def _registry_supports_vision(model: str) -> bool | None:
    """True/False from LiteLLM registry; None = skip pre-check (local server)."""
    if _litellm_provider(model) in _LOCAL_OPENAI_COMPAT:
        return None
    try:
        return bool(litellm.supports_vision(model=model))
    except Exception:  # noqa: BLE001
        return False


def _registry_supports_pdf(model: str) -> bool | None:
    if _litellm_provider(model) in _LOCAL_OPENAI_COMPAT:
        return None
    try:
        from litellm.utils import supports_pdf_input

        return bool(supports_pdf_input(model=model))
    except Exception:  # noqa: BLE001
        return False


def check_multimodal_support(model: str, attachments: list[AttachmentDict]) -> None:
    """Raise MultimodalError if model cannot handle attachment kinds.

    LM Studio and Ollama are not pre-checked: LiteLLM's registry does not know arbitrary
    local model ids (vision-capable loads still report supports_vision=False).
    """
    if not attachments:
        return
    has_image = any(a.get("kind") == "image" for a in attachments)
    has_pdf = any(a.get("kind") == "pdf" for a in attachments)
    if has_image:
        ok = _registry_supports_vision(model)
        if ok is False:
            raise MultimodalError(
                "This model does not support images. Choose a vision-capable model in Settings.",
            )
        if ok is None:
            logger.info("Skipping vision registry check for local model %r", model)
    if has_pdf:
        ok = _registry_supports_pdf(model)
        if ok is False:
            raise MultimodalError(
                "This model does not support PDF input. Choose a compatible model in Settings.",
            )
        if ok is None:
            logger.info("Skipping PDF registry check for local model %r", model)


def build_user_content(
    text: str,
    attachments: list[AttachmentDict],
    *,
    root: Path | None = None,
) -> str | list[dict[str, Any]]:
    """Return LiteLLM user message content (plain string or multimodal parts list)."""
    if not attachments:
        return text.strip()

    root_path = root or attachments_root()
    if root_path is None:
        raise MultimodalError(
            "Attachments folder is not configured. Stop and Start the voice session, then try again.",
            code="invalid_attachment",
        )

    images = [a for a in attachments if a.get("kind") == "image"]
    pdfs = [a for a in attachments if a.get("kind") == "pdf"]
    if len(images) > MAX_IMAGES:
        raise MultimodalError(f"At most {MAX_IMAGES} images per message")
    if len(pdfs) > MAX_PDFS:
        raise MultimodalError(f"At most {MAX_PDFS} PDF per message")

    parts: list[dict[str, Any]] = []
    caption = text.strip()
    if caption:
        parts.append({"type": "text", "text": caption})

    for att in images:
        path = resolve_safe_path(
            str(att.get("path") or ""),
            root_path,
            att_id=str(att.get("id") or ""),
        )
        mime = _mime_for(path, "image", str(att.get("mime") or ""))
        parts.append(
            {
                "type": "image_url",
                "image_url": {"url": _read_data_uri(path, mime)},
            },
        )

    for att in pdfs:
        path = resolve_safe_path(
            str(att.get("path") or ""),
            root_path,
            att_id=str(att.get("id") or ""),
        )
        mime = _mime_for(path, "pdf", str(att.get("mime") or "application/pdf"))
        parts.append(
            {
                "type": "file",
                "file": {
                    "file_data": _read_data_uri(path, mime),
                    "format": "application/pdf",
                },
            },
        )

    if not parts:
        return text.strip()
    return parts


def serialize_user_turn(text: str, attachments: list[AttachmentDict]) -> str:
    """Persist multimodal user turns in SQLite content column."""
    if not attachments:
        return text.strip()
    return json.dumps(
        {
            "format": "json_v1",
            "text": text.strip(),
            "attachments": [
                {
                    "id": a.get("id", ""),
                    "kind": a.get("kind", ""),
                    "mime": a.get("mime", ""),
                    "filename": a.get("filename", ""),
                    "path": a.get("path", ""),
                }
                for a in attachments
            ],
        },
        ensure_ascii=False,
    )


def parse_stored_content(raw: str) -> tuple[str, list[AttachmentDict]]:
    """Parse plain text or json_v1 stored user content."""
    stripped = raw.strip()
    if not stripped.startswith("{"):
        return stripped, []
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped, []
    if not isinstance(obj, dict) or obj.get("format") != "json_v1":
        return stripped, []
    text = str(obj.get("text") or "")
    atts = obj.get("attachments")
    if not isinstance(atts, list):
        return text, []
    out: list[AttachmentDict] = []
    for item in atts:
        if isinstance(item, dict):
            out.append({k: str(v) for k, v in item.items()})
    return text, out


def content_for_history(
    raw: str,
    *,
    root: Path | None = None,
) -> str | list[dict[str, Any]]:
    """Rebuild LiteLLM user content from DB-stored string."""
    text, attachments = parse_stored_content(raw)
    if not attachments:
        return text
    return build_user_content(text, attachments, root=root)


def user_display_text(text: str, attachments: list[AttachmentDict]) -> str:
    """Human-readable transcript line for a multimodal user turn."""
    caption = text.strip()
    labels: list[str] = []
    for att in attachments:
        kind = att.get("kind", "file")
        name = att.get("filename") or att.get("id") or kind
        labels.append(f"[{kind}: {name}]")
    if labels and caption:
        return f"{caption}\n{' '.join(labels)}"
    if labels:
        return " ".join(labels)
    return caption

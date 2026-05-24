import os
import tempfile
from pathlib import Path

import pytest

from live_voice.multimodal import (
    MultimodalError,
    _strip_win_long_prefix,
    attachments_root,
    build_user_content,
    check_multimodal_support,
    content_for_history,
    parse_stored_content,
    resolve_safe_path,
    serialize_user_turn,
    user_display_text,
)


def test_user_display_text() -> None:
    text = user_display_text(
        "see this",
        [{"kind": "image", "filename": "a.png", "id": "1", "mime": "image/png", "path": ""}],
    )
    assert "see this" in text
    assert "a.png" in text


def test_serialize_and_parse_roundtrip() -> None:
    raw = serialize_user_turn(
        "hi",
        [{"id": "x", "kind": "image", "mime": "image/png", "filename": "f.png", "path": "/p"}],
    )
    text, atts = parse_stored_content(raw)
    assert text == "hi"
    assert len(atts) == 1
    assert atts[0]["filename"] == "f.png"


def test_resolve_safe_path_rejects_escape() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        outside = Path(tmp).parent / "outside.txt"
        with pytest.raises(MultimodalError):
            resolve_safe_path(str(outside), root)


def test_resolve_safe_path_finds_staged_file() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        img = root / "abc.png"
        img.write_bytes(b"\x89PNG\r\n")
        resolved = resolve_safe_path(str(img), root)
        assert resolved == img.resolve()


@pytest.mark.skipif(os.name != "nt", reason="Windows extended paths")
def test_windows_extended_path_under_root() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        img = root / "id1.png"
        img.write_bytes(b"\x89PNG\r\n")
        extended = Path(f"\\\\?\\{img.resolve()}")
        resolved = resolve_safe_path(str(extended), root, att_id="")
        assert resolved == img.resolve()


def test_resolve_by_attachment_id() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        img = root / "abc-uuid.png"
        img.write_bytes(b"\x89PNG\r\n")
        resolved = resolve_safe_path("", root, att_id="abc-uuid")
        assert resolved == img.resolve()


def test_attachments_root_from_config() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = attachments_root(tmp)
        assert root is not None
        assert root == Path(tmp).resolve()


def test_build_user_content_image() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        img = root / "test.png"
        img.write_bytes(b"\x89PNG\r\n\x1a\n")
        parts = build_user_content(
            "caption",
            [{"kind": "image", "mime": "image/png", "path": str(img), "id": "1", "filename": "test.png"}],
            root=root,
        )
        assert isinstance(parts, list)
        assert parts[0]["type"] == "text"
        assert parts[1]["type"] == "image_url"


def test_content_for_history_plain() -> None:
    assert content_for_history("hello") == "hello"


def test_lm_studio_skips_vision_registry_check() -> None:
    """LM Studio vision models are not listed in LiteLLM's supports_vision registry."""
    check_multimodal_support(
        "lm_studio/qwen3.5-2b-claude-4.6-opus-reasoning-distilled",
        [{"kind": "image", "path": "/unused", "mime": "image/png", "id": "1", "filename": "a.png"}],
    )


def test_ollama_skips_vision_registry_check() -> None:
    check_multimodal_support(
        "ollama/llava",
        [{"kind": "image", "path": "/unused", "mime": "image/png", "id": "1", "filename": "a.png"}],
    )

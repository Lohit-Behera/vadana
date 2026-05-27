from __future__ import annotations

from pathlib import Path

from live_voice.models_paths import (
    default_models_root,
    resolve_models_root,
    supertonic_model_dir,
    whisper_download_root,
)


def test_default_models_root_under_home(tmp_path, monkeypatch):
    monkeypatch.setattr("live_voice.models_paths.Path.home", lambda: tmp_path)
    assert default_models_root() == (tmp_path / "vadana" / "models").resolve()


def test_resolve_models_root_custom(tmp_path):
    custom = tmp_path / "D_models"
    root = resolve_models_root(str(custom))
    assert root == custom.resolve()
    assert root.is_dir()


def test_subdirs(tmp_path):
    root = resolve_models_root(str(tmp_path / "m"))
    assert whisper_download_root(root) == root / "whisper"
    st_dir = supertonic_model_dir(root, "supertonic-3")
    assert st_dir.parent == root / "supertonic"
    assert st_dir.name == "supertonic3"

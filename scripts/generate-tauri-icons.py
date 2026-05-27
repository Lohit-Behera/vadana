#!/usr/bin/env python3
"""
Generate the full Tauri icon set from a source image.

Usage (from repository root):
  python scripts/generate-tauri-icons.py --input src-tauri/icons/StoreLogo.png
"""

from __future__ import annotations

import argparse
import tempfile
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image  # type: ignore[reportMissingImports]
except ImportError:  # pragma: no cover - runtime dependency check
    Image = None


EXPECTED_OUTPUTS = [
    "128x128.png",
    "128x128@2x.png",
    "32x32.png",
    "Square107x107Logo.png",
    "Square142x142Logo.png",
    "Square150x150Logo.png",
    "Square284x284Logo.png",
    "Square30x30Logo.png",
    "Square310x310Logo.png",
    "Square44x44Logo.png",
    "Square71x71Logo.png",
    "Square89x89Logo.png",
    "StoreLogo.png",
    "icon.icns",
    "icon.ico",
    "icon.png",
]

NSIS_OUTPUTS = [
    "nsis/header.bmp",
    "nsis/sidebar.bmp",
]

# NSIS Modern UI recommended sizes (see Tauri NsisConfig docs).
NSIS_HEADER_SIZE = (150, 57)
NSIS_SIDEBAR_SIZE = (164, 314)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate all src-tauri/icons files using the Tauri CLI icon generator."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to source image (PNG recommended, 512x512 or larger).",
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Repository root (defaults to current working directory).",
    )
    return parser.parse_args()


def _brand_gradient(size: tuple[int, int]) -> "Image.Image":
    """Light mint → forest green, top to bottom."""
    assert Image is not None
    width, height = size
    top = (162, 217, 166)
    bottom = (48, 99, 74)
    gradient = Image.new("RGB", size)
    pixels = gradient.load()
    assert pixels is not None
    for y in range(height):
        t = y / max(height - 1, 1)
        color = tuple(
            int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)
        )
        for x in range(width):
            pixels[x, y] = color
    return gradient


def _paste_logo(
    canvas: "Image.Image",
    logo_rgba: "Image.Image",
    box: tuple[int, int, int, int],
) -> None:
    assert Image is not None
    left, top, right, bottom = box
    max_w = right - left
    max_h = bottom - top
    logo = logo_rgba.copy()
    logo.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    x = left + (max_w - logo.width) // 2
    y = top + (max_h - logo.height) // 2
    canvas.paste(logo, (x, y), logo)


def ensure_windows_ico(icons_dir: Path, logo_rgba: "Image.Image") -> None:
    """Rewrite icon.ico with standard sizes for Explorer and NSIS."""
    assert Image is not None
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    logo_rgba.save(icons_dir / "icon.ico", format="ICO", sizes=ico_sizes)


def generate_nsis_images(icons_dir: Path, logo_rgba: "Image.Image") -> None:
    """Build NSIS installer header/sidebar bitmaps from the app logo."""
    assert Image is not None
    nsis_dir = icons_dir / "nsis"
    nsis_dir.mkdir(parents=True, exist_ok=True)

    header_w, header_h = NSIS_HEADER_SIZE
    header = Image.new("RGB", NSIS_HEADER_SIZE, (255, 255, 255))
    _paste_logo(
        header,
        logo_rgba,
        (header_w // 3, 2, header_w - 4, header_h - 2),
    )
    header.save(nsis_dir / "header.bmp", format="BMP")

    sidebar_w, sidebar_h = NSIS_SIDEBAR_SIZE
    sidebar = _brand_gradient(NSIS_SIDEBAR_SIZE)
    _paste_logo(
        sidebar,
        logo_rgba,
        (8, 24, sidebar_w - 8, sidebar_h - 24),
    )
    sidebar.save(nsis_dir / "sidebar.bmp", format="BMP")


def main() -> int:
    args = parse_args()
    project_root = Path(args.project_root).resolve()
    source_image = (project_root / args.input).resolve()
    icons_dir = project_root / "src-tauri" / "icons"

    if not source_image.exists():
        print(f"[error] source image not found: {source_image}")
        return 1

    if Image is None:
        print("[error] Missing dependency: Pillow")
        print("Install it with: uv pip install pillow")
        return 1

    pnpm_bin = shutil.which("pnpm.cmd" if sys.platform.startswith("win") else "pnpm")
    if not pnpm_bin:
        print("[error] pnpm is not available in PATH.")
        return 1

    print(f"[info] Preparing square icon source from: {source_image}")
    with Image.open(source_image) as img:
        rgba = img.convert("RGBA")
        side = max(rgba.width, rgba.height)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        offset = ((side - rgba.width) // 2, (side - rgba.height) // 2)
        square.paste(rgba, offset)

        with tempfile.NamedTemporaryFile(
            suffix=".png", prefix="tauri-icon-src-", delete=False
        ) as temp_file:
            temp_path = Path(temp_file.name)
        square.save(temp_path, format="PNG")

    print(f"[info] Generating icons from square source: {temp_path}")
    command = [pnpm_bin, "tauri", "icon", str(temp_path)]
    completed = subprocess.run(command, cwd=project_root)
    temp_path.unlink(missing_ok=True)
    if completed.returncode != 0:
        print("[error] Tauri icon generation failed.")
        return completed.returncode

    missing = [name for name in EXPECTED_OUTPUTS if not (icons_dir / name).exists()]
    if missing:
        print("[error] Icon generation finished, but files are missing:")
        for name in missing:
            print(f"  - {name}")
        return 2

    icon_png = icons_dir / "icon.png"
    if not icon_png.exists():
        print(f"[error] Missing {icon_png} — cannot generate NSIS installer images.")
        return 2

    print(f"[info] Generating NSIS installer images from: {icon_png}")
    with Image.open(icon_png) as logo:
        logo_rgba = logo.convert("RGBA")
        ensure_windows_ico(icons_dir, logo_rgba)
        generate_nsis_images(icons_dir, logo_rgba)

    missing_nsis = [name for name in NSIS_OUTPUTS if not (icons_dir / name).exists()]
    if missing_nsis:
        print("[error] NSIS image generation finished, but files are missing:")
        for name in missing_nsis:
            print(f"  - {name}")
        return 2

    print(
        f"[ok] Generated {len(EXPECTED_OUTPUTS)} icon files and "
        f"{len(NSIS_OUTPUTS)} NSIS images in {icons_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

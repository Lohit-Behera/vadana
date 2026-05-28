"""Entry point for the bundled voice sidecar (used by the desktop app)."""

from __future__ import annotations

from live_voice.logging_config import setup_logging

setup_logging()

try:
    from live_voice.__main__ import main
except Exception:
    import logging

    logging.exception("Backend failed to import (see session.log above)")
    raise

if __name__ == "__main__":
    main()

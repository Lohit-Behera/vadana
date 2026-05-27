"""Parse CHAT_TITLE from the first assistant reply (no separate LLM call)."""

from __future__ import annotations

TITLE_PREFIX = "CHAT_TITLE:"
MAX_TITLE_PREFIX_SCAN = 120

FIRST_TURN_TITLE_INSTRUCTION = (
    "This is the first message in a new conversation. "
    "Before your reply to the user, output exactly one line in this format (plain text, no markdown):\n"
    "CHAT_TITLE: <a short sidebar title, 3–6 words>\n"
    "Then one blank line, then your normal reply."
)


def sanitize_chat_title(raw: str) -> str | None:
    t = raw.strip().strip("\"'`").split()
    t = " ".join(t)
    if not t or t.lower() == "new chat":
        return None
    if len(t) > 48:
        t = f"{t[:48].rstrip()}…"
    return t


class FirstTurnTitleParser:
    """Strip a leading CHAT_TITLE line from streamed tokens; body goes to UI/TTS."""

    def __init__(self) -> None:
        self.title: str | None = None
        self._buf = ""
        self._done = False

    def feed(self, text: str) -> str:
        if self._done or not text:
            return text if self._done else ""

        self._buf += text
        stripped = self._buf.lstrip()
        if not stripped.startswith(TITLE_PREFIX) and len(self._buf) > MAX_TITLE_PREFIX_SCAN:
            self._done = True
            out = self._buf
            self._buf = ""
            return out

        if TITLE_PREFIX not in self._buf:
            return ""

        idx = self._buf.find(TITLE_PREFIX)
        after = self._buf[idx + len(TITLE_PREFIX) :]
        if "\n" not in after:
            return ""

        title_line, remainder = after.split("\n", 1)
        self.title = sanitize_chat_title(title_line)
        self._done = True
        self._buf = ""
        return remainder.lstrip("\n")

    def flush(self) -> str:
        if self._done:
            out = self._buf
            self._buf = ""
            return out

        if TITLE_PREFIX in self._buf:
            idx = self._buf.find(TITLE_PREFIX)
            after = self._buf[idx + len(TITLE_PREFIX) :]
            if "\n" in after:
                title_line, remainder = after.split("\n", 1)
                self.title = sanitize_chat_title(title_line)
                self._done = True
                self._buf = ""
                return remainder.lstrip("\n")
            self.title = sanitize_chat_title(after)
            self._done = True
            self._buf = ""
            return ""

        self._done = True
        out = self._buf
        self._buf = ""
        return out

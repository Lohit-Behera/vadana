# Vadana — demo recording script

Use this guide when recording a product demo, GitHub README video, or screenshots for [`app-showcase/`](../app-showcase/).

---

## Before you record

### Environment

| Item | Action |
|------|--------|
| **LM Studio** | Load a chat model; start local server on `http://127.0.0.1:1234`. |
| **Model id** | In app **Settings → LLM**, set **Model** to the same id LM Studio shows for the API. |
| **Headphones** | Wear them so the mic does not pick up speaker output (VAD loop). |
| **Microphone** | Allow mic access for Vadana / Python on Windows. |
| **First-run weights** | Run the app once beforehand so **Silero VAD** and **Whisper** are already downloaded. |
| **Supertonic (optional)** | **Settings → TTS** → **Download model weights**, or run `uv run python -m live_voice.download_supertonic` in `backend/`. |
| **Window** | 1920×1080, app maximized or centered; hide unrelated desktop clutter. |
| **Recording** | OBS, ShareX, or Win+G; capture app window only. |

### Suggested demo questions (pick 2–3)

Keep answers short so the video stays tight.

1. *“What is Vadana in one sentence?”*
2. *“Give me three tips for staying focused while coding.”*
3. *“Explain what a local voice assistant is and why privacy matters.”*
4. *(Hindi TTS)* *“नमस्ते, आज मौसम कैसा है?”* — only if Supertonic + `lang` is configured.

### Build to demo

- **Dev:** `pnpm tauri dev` (full features).
- **Release (recommended for public demo):** install `Vadana_*_x64-setup.exe` from [Releases](https://github.com/Lohit-Behera/vadana/releases) so viewers see the shipped experience.

---

## Version A — 60-second pitch

**Goal:** README hero, social clip, release asset.

| Time | On screen | Narrator (optional) |
|------|-----------|---------------------|
| 0:00–0:08 | Title card or app icon + text: **Vadana — local desktop voice assistant** | “Meet Vadana: open-source voice on your desktop. Speech stays local.” |
| 0:08–0:18 | Launch app → wait through **Starting voice backend** (cut in edit if long) → main chat with sidebar visible | “Tauri and React talk to a Python sidecar on localhost only.” |
| 0:18–0:22 | Brief pan: sidebar (**New chat**, past sessions), header **context meter** | “Chats are saved in SQLite on your machine.” |
| 0:22–0:45 | Click **Start** → speak question #1 → show **listening → thinking → speaking** and transcript | “Whisper transcribes on device; LiteLLM talks to LM Studio; Supertonic speaks the reply.” |
| 0:45–0:52 | Flash **Settings → LLM** (provider + model) then back to chat | “Swap LM Studio, Ollama, or cloud providers from settings. API keys live in the OS keychain.” |
| 0:52–1:00 | End card: GitHub URL + **Download** link | “MIT licensed — link in description.” |

**Edit note:** Trim backend startup to &lt;2s or use a pre-warmed second launch.

---

## Version B — 90-second walkthrough

**Goal:** GitHub Pages embed, fuller README demo.

| Time | On screen | Narrator (optional) |
|------|-----------|---------------------|
| 0:00–0:10 | Cold open on empty chat → **Start** | “This is Vadana — vadana means speech in Sanskrit.” |
| 0:10–0:35 | Voice turn #1 (spoken) | “I press Start, speak naturally, and Silero VAD segments my speech.” |
| 0:35–0:50 | Type in footer: *“Summarize that in five words.”* → **Send** | “You can type or attach images and PDFs in the same session.” |
| 0:50–1:05 | Header: **model picker**, **status badge**, **context meter** | “Per-chat model override, live session state, and token usage in the header.” |
| 1:05–1:15 | **Stop** session → sidebar → **New chat** → open an older chat | “History persists across sessions.” |
| 1:15–1:25 | Sidebar → **Settings** → tabs: **General**, **LLM**, **Voice**, **TTS**, **System** | “Whisper size, VAD, TTS voice, and provider — all in one place.” |
| 1:25–1:30 | End card | “Build from source or grab the Windows installer on GitHub.” |

---

## Version C — 5-minute deep dive

**Goal:** YouTube / developer audience.

### 1. Intro (0:00–0:30)

- Problem: cloud voice assistants and always-on upload.
- Solution: local Whisper + localhost WebSocket + Tauri desktop shell.

### 2. Architecture (0:30–1:00)

- Optional slide or voice-over: `React UI → Tauri → Python ws://127.0.0.1:8765`.
- Mention: no exposure of port 8765 to the network.

### 3. First launch (1:00–2:00)

1. Open installed app (or `pnpm tauri dev`).
2. Show **Starting voice backend** / **Checking readiness** if visible.
3. If preflight fails, show **Retry** once, then fix LM Studio off-camera.
4. Land on empty chat with central **Start** button.

### 4. Voice session (2:00–3:30)

1. **Start** → wait for **Ready when you are. Start speaking or type below.**
2. Speak demo question #1; pause on assistant text streaming.
3. Speak follow-up; point at **context meter** increasing.
4. **Interrupt** during TTS (optional) → show barge-in.
5. **Stop** session.

### 5. Text & attachments (3:30–4:00)

1. **Start** again.
2. **Paperclip** → attach a screenshot or PDF → short typed prompt → **Send**.

### 6. Settings & privacy (4:00–4:45)

1. Sidebar → **Settings**.
2. **LLM:** LM Studio, base URL, **Fetch models**, model id.
3. **Voice:** Whisper model size.
4. **TTS:** Supertonic voice / lang or Piper path; mention **Download model weights**.
5. **System:** theme; mention cloud API keys in keychain (do not show real keys).

### 7. Knowledge (optional, 4:45–5:00)

1. Sidebar → **Knowledge** — brief view of stored docs if you use RAG in the demo.

### 8. Outro (5:00)

- `docs/build.md`, MIT license, contribute on GitHub.

---

## Screenshot shot list (for `app-showcase`)

Capture these as **PNG** at 2× scale if possible; drop into `app-showcase/src/assets/` and wire in `app-showcase/src/App.jsx`.

| # | Filename (suggested) | Scene |
|---|----------------------|--------|
| 1 | `screenshot-home.png` | Sidebar with 2–3 chats; empty or idle main area; **New chat** visible. |
| 2 | `screenshot-voice.png` | Active session: user + assistant lines in transcript; status **Listening** or **Speaking**; context meter visible. |
| 3 | `screenshot-settings.png` | **Settings → LLM** tab: provider, base URL, model selected. |

---

## On-screen action cheat sheet

| UI label | Location | When to use in demo |
|----------|----------|---------------------|
| **Start** | Center (empty chat) or footer | Begin voice session |
| **Stop** | Footer during session | End session, keep backend |
| **Interrupt** | Footer during TTS | Show cancel / barge-in |
| Type + **Send** | Footer input | Typed message demo |
| **Paperclip** | Footer | Image/PDF attachment |
| **New chat** | Sidebar | Fresh thread |
| Past chat row | Sidebar | History / persistence |
| **Settings** | Sidebar bottom | Provider & TTS |
| **Knowledge** | Sidebar bottom | RAG docs (if used) |
| Model picker | Chat header toolbar | Per-session model |
| Context meter | Chat header | Token / context usage |

### Settings tabs

- **General** — models folder, theme, updates  
- **LLM** — provider, base URL, model, context limit, API key  
- **Voice** — Whisper, VAD (via Settings panel)  
- **TTS** — Supertonic / Piper / system  
- **System** — advanced / system options  

---

## Troubleshooting while recording

| Issue | Fix |
|-------|-----|
| **Start** disabled | Wait for backend ready; check LM Studio; run preflight / **Retry**. |
| Long “Starting voice backend” | Pre-warm app before recording; cut in post. |
| No mic / no transcript | Windows mic permission; correct input device. |
| Assistant silent | TTS not configured; try Supertonic download or system TTS. |
| LM Studio errors | Server running; model id matches; port 1234 free. |
| Echo / double triggers | Use headphones; lower speaker volume. |

---

## Post-production checklist

- [ ] Add captions (many viewers watch muted).
- [ ] Blur or avoid showing real API keys.
- [ ] Export 1080p MP4 (H.264); optional 15s GIF of voice loop for README.
- [ ] Upload to GitHub Release or unlisted YouTube; link from README and `app-showcase`.
- [ ] Replace showcase placeholders with the three PNGs above.

---

## Links to mention on end card

- Repo: `https://github.com/Lohit-Behera/vadana`
- Docs: `README.md`, `docs/build.md`, `docs/frontend.md`
- Releases / Windows installer: GitHub **Releases** tab

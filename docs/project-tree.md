# Project tree

One-line description per file. **Vadana** — Tauri desktop app + React UI + Python WebSocket voice sidecar.

> Bundled copies under `src-tauri/resources/backend/` mirror `backend/` at release time (see `scripts/sync-backend-resources.ps1`). Descriptions match the source tree unless noted.

---

## Root

```
live/
├── .gitignore                          # Git ignore patterns (build artifacts, deps, env)
├── components.json                     # shadcn/ui component registry and Tailwind paths
├── index.html                          # Vite HTML shell; mounts React root `#root`
├── LICENSE                             # Project license text
├── package.json                        # npm scripts, React/Tauri/Vite dependencies
├── pnpm-lock.yaml                      # Locked Node dependency versions for pnpm
├── README.md                           # Project overview, prerequisites, quick start
├── THIRD_PARTY_NOTICES.md              # Third-party license attributions
├── tsconfig.json                       # TypeScript config for the React app (`src/`)
├── tsconfig.node.json                  # TypeScript config for Vite/Vitest Node tooling
├── vite.config.ts                      # Vite dev server (port 1420), `@/` alias, Tauri HMR
├── vitest.config.ts                    # Vitest unit test runner config and `@/` alias
├── public/
│   ├── tauri.svg                       # Static Tauri logo served by Vite
│   └── vite.svg                        # Static Vite logo served by Vite
├── scripts/
│   ├── smoke.ps1                       # End-to-end smoke test script (PowerShell)
│   └── sync-backend-resources.ps1      # Copies `backend/` into Tauri bundle resources
└── docs/
    ├── README.md                       # Documentation index and links
    ├── frontend.md                     # React/Vite UI, hooks, Tauri integration guide
    └── project-tree.md                 # This file — project tree with per-file notes
```

---

## `src/` — React frontend

```
src/
├── main.tsx                            # React 19 root mount, ThemeProvider, Toaster
├── App.tsx                             # App shell: chat / knowledge / settings views + voice session
├── App.css                             # Global layout, sidebar, transcript, and theme styles
├── vite-env.d.ts                       # Vite client type references (`import.meta.env`)
├── assets/
│   └── react.svg                       # Default React logo asset
├── test/
│   └── setup.ts                        # Vitest global setup (`@testing-library/jest-dom`)
├── hooks/
│   ├── useChats.ts                     # Chat list CRUD, SQLite persistence, backend history bridge
│   ├── useVoiceSession.ts              # Voice session lifecycle, config, bridge events, context usage
│   └── use-mobile.ts                   # Responsive breakpoint hook for mobile sidebar behavior
├── components/
│   ├── SettingsPanel.tsx               # Voice/STT/TTS/system-prompt settings form fields
│   ├── layout/
│   │   ├── AppShell.tsx                # Main layout wrapper (sidebar + content region)
│   │   ├── AppSidebar.tsx              # Chat list sidebar, new chat, navigation
│   │   ├── ChatHeader.tsx              # Active chat title, token usage, session controls
│   │   └── MainChat.tsx                # Transcript, input, attachments, pickers, start/stop voice
│   ├── chat/
│   │   ├── ChatKnowledgePicker.tsx     # Per-chat knowledge folder selection UI
│   │   ├── ChatModelPicker.tsx         # Per-chat LLM provider/model selection UI
│   │   ├── ChatSystemPromptEditor.tsx  # Per-chat system prompt editor
│   │   ├── ChatTtsPicker.tsx           # Per-chat TTS engine/voice selection UI
│   │   └── TranscriptThread.tsx        # Scrollable user/assistant message transcript
│   ├── knowledge/
│   │   └── KnowledgePage.tsx           # Knowledge folders: import, list, delete, rebuild index
│   ├── settings/
│   │   └── SettingsPage.tsx            # Full-page settings tabs (voice, LLM keys, preflight)
│   ├── llm/
│   │   └── LlmModelSelect.tsx          # Reusable LLM model dropdown with provider grouping
│   ├── tts/
│   │   ├── SupertonicLangSelect.tsx    # Supertonic language selector
│   │   └── SupertonicVoiceSelect.tsx   # Supertonic voice/style selector
│   └── ui/                             # shadcn/Radix UI primitives
│       ├── accordion.tsx               # Collapsible accordion sections
│       ├── alert-dialog.tsx            # Modal confirmation / destructive action dialog
│       ├── alert.tsx                   # Inline status alert banner
│       ├── avatar.tsx                  # User/assistant avatar display
│       ├── badge.tsx                   # Small status or label badge
│       ├── button.tsx                  # Button variants (default, outline, ghost, …)
│       ├── card.tsx                    # Card container with header/content/footer slots
│       ├── checkbox.tsx                # Checkbox input control
│       ├── command.tsx                 # Command palette / searchable list (cmdk)
│       ├── context-menu.tsx            # Right-click context menu
│       ├── dialog.tsx                  # Modal dialog overlay
│       ├── dropdown-menu.tsx           # Dropdown action menu
│       ├── input-group.tsx             # Input with leading/trailing addons
│       ├── input.tsx                   # Text input field
│       ├── label.tsx                   # Form field label
│       ├── progress.tsx                # Progress bar indicator
│       ├── scroll-area.tsx             # Custom scrollable viewport
│       ├── select.tsx                  # Select dropdown control
│       ├── separator.tsx               # Horizontal/vertical divider line
│       ├── sheet.tsx                   # Slide-over panel (mobile drawer)
│       ├── sidebar.tsx                 # Application sidebar primitive and provider
│       ├── skeleton.tsx                # Loading placeholder skeleton
│       ├── slider.tsx                  # Range slider control
│       ├── sonner.tsx                  # Toast notification wrapper (sonner)
│       ├── switch.tsx                  # Toggle switch control
│       ├── tabs.tsx                    # Tabbed panel navigation
│       ├── textarea.tsx                # Multi-line text input
│       └── tooltip.tsx                 # Hover tooltip wrapper
└── lib/
    ├── attachments.ts                  # Stage image/PDF attachments via Tauri for multimodal chat
    ├── chatsDb.ts                      # Tauri SQL: chats, messages, per-chat LLM/TTS/knowledge fields
    ├── errorMessages.ts                # Maps backend error codes to user-facing strings
    ├── errorMessages.test.ts           # Unit tests for error message mapping
    ├── generateChatTitle.ts            # Invokes Rust LLM command to auto-title chats
    ├── generateChatTitle.test.ts       # Unit tests for chat title generation helper
    ├── keychain.ts                     # Get/set/delete LLM API keys via OS keychain commands
    ├── knowledge.ts                    # High-level knowledge folder helpers for the UI
    ├── knowledgeDb.ts                  # SQLite metadata for knowledge files and folders
    ├── knowledgeDb.test.ts             # Unit tests for knowledge DB helpers
    ├── knowledgeRebuild.ts             # Triggers Python knowledge index rebuild via Tauri
    ├── llmModels.ts                    # Fetches and caches available models per provider
    ├── llmProviders.ts                 # LLM provider definitions, defaults, and key requirements
    ├── llmProviders.test.ts            # Unit tests for provider config helpers
    ├── settings.ts                     # Persisted voice/LLM settings (Tauri store + localStorage)
    ├── settings.test.ts                # Unit tests for settings load/save
    ├── supertonic.ts                   # Supertonic model presence check and download via Tauri
    ├── supertonicOptions.ts            # Supertonic language/voice option lists for the UI
    ├── supertonicOptions.test.ts       # Unit tests for Supertonic option helpers
    ├── tauri.ts                        # Safe `invoke` / `listen` wrappers (no-op outside Tauri)
    ├── utils.ts                        # `cn()` className merge helper (clsx + tailwind-merge)
    ├── utils.test.ts                   # Unit tests for `cn()` utility
    ├── voiceBridge.ts                  # Sends/receives WebSocket JSON via Rust voice bridge
    ├── voiceBridge.test.ts             # Unit tests for voice bridge message helpers
    ├── voiceConfig.ts                  # Builds backend `config` JSON from UI settings
    └── voiceConfig.test.ts             # Unit tests for voice config serialization
```

---

## `src-tauri/` — Rust desktop shell

```
src-tauri/
├── .gitignore                          # Ignores `target/`, local Tauri build artifacts
├── build.rs                            # Tauri build script hook (compile-time assets)
├── Cargo.toml                          # Rust crate manifest, Tauri plugins, dependencies
├── Cargo.lock                          # Locked Rust dependency versions
├── tauri.conf.json                     # App id, window, bundle, resource paths, dev URL
├── capabilities/
│   └── default.json                    # Tauri 2 capability permissions for shell/SQL/fs
├── gen/schemas/                        # Auto-generated by Tauri CLI (do not hand-edit)
│   ├── acl-manifests.json              # Generated ACL manifest for permissions
│   ├── capabilities.json               # Generated capability schema
│   ├── desktop-schema.json             # Generated desktop permission schema
│   └── windows-schema.json             # Generated Windows permission schema
├── icons/                              # Application icons bundled into installers
│   ├── 32x32.png                       # Small tray/taskbar icon
│   ├── 128x128.png                     # Standard app icon
│   ├── 128x128@2x.png                  # Retina 128×128 app icon
│   ├── icon.png                        # Primary PNG app icon
│   ├── icon.ico                        # Windows `.ico` application icon
│   ├── icon.icns                       # macOS `.icns` application icon
│   ├── StoreLogo.png                   # Microsoft Store logo asset
│   ├── Square30x30Logo.png             # Windows tile logo 30×30
│   ├── Square44x44Logo.png             # Windows tile logo 44×44
│   ├── Square71x71Logo.png             # Windows tile logo 71×71
│   ├── Square89x89Logo.png             # Windows tile logo 89×89
│   ├── Square107x107Logo.png           # Windows tile logo 107×107
│   ├── Square142x142Logo.png           # Windows tile logo 142×142
│   ├── Square150x150Logo.png           # Windows tile logo 150×150
│   ├── Square284x284Logo.png           # Windows tile logo 284×284
│   └── Square310x310Logo.png           # Windows tile logo 310×310
├── migrations/                         # SQLite migrations applied by `tauri-plugin-sql`
│   ├── 001_init.sql                    # Creates `chats` and `messages` tables
│   ├── 002_message_content.sql         # Message content schema adjustments
│   ├── 003_knowledge.sql               # Knowledge folder/file metadata tables
│   ├── 004_chat_system_prompt.sql      # Per-chat `system_prompt` column
│   ├── 005_chat_tts.sql                # Per-chat TTS engine/voice columns
│   └── 006_chat_llm.sql                # Per-chat LLM provider/model columns
├── src/
│   ├── main.rs                         # Windows release entry; calls `vadana_lib::run()`
│   ├── lib.rs                          # Tauri app: backend spawn, voice WS bridge, SQL, commands
│   ├── attachments.rs                  # Stage image/PDF attachments under app data for sidecar
│   ├── chat_title.rs                   # HTTP LLM call to generate sidebar chat titles (no CORS)
│   ├── keyring_store.rs                # OS keychain CRUD for provider API keys
│   ├── knowledge.rs                    # Knowledge folders on disk: import, list, delete, paths
│   └── llm_models.rs                     # Fetches OpenAI-compatible model lists from providers
└── resources/backend/                  # Bundled Python sidecar (synced from `backend/`)
    ├── main.py                         # (synced) Entry: runs `live_voice.__main__`
    ├── pyproject.toml                  # (synced) uv/Python project metadata and dependencies
    ├── uv.lock                         # (synced) Locked Python dependency versions
    ├── README.md                       # (synced) Backend setup and env var reference
    └── live_voice/
        ├── __init__.py                 # (synced) Package marker
        ├── __main__.py                 # (synced) WebSocket server main loop and CLI
        ├── audio_io.py                 # (synced) Microphone capture and speaker playback
        ├── download_supertonic.py      # (synced) Supertonic model download helper
        ├── errors.py                   # (synced) Structured error types and codes
        ├── llm_client.py               # (synced) LiteLLM streaming chat client
        ├── protocol.py                 # (synced) WebSocket JSON message types and handlers
        ├── session.py                  # (synced) Voice session state machine (VAD→STT→LLM→TTS)
        ├── stt.py                      # (synced) Local Whisper speech-to-text
        ├── text_split.py               # (synced) Sentence splitting for TTS chunking
        ├── tts_engine.py               # (synced) Supertonic / Piper / pyttsx3 TTS backends
        └── vad.py                      # (synced) Silero voice-activity detection
```

---

## `backend/` — Python WebSocket sidecar

```
backend/
├── .python-version                     # pyenv/uv Python version pin
├── main.py                             # Thin entry: delegates to `live_voice.__main__`
├── pyproject.toml                      # uv project metadata, dependencies, scripts
├── uv.lock                             # Locked Python dependency versions
├── README.md                           # Sidecar setup, env vars, module overview
├── protocol.md                         # WebSocket JSON protocol reference
├── live_voice/
│   ├── __init__.py                     # Package marker
│   ├── __main__.py                     # CLI + asyncio WebSocket server on port 8765
│   ├── audio_io.py                     # PyAudio (or equivalent) mic input and speaker output
│   ├── download_supertonic.py          # Downloads Supertonic ONNX/models from Hugging Face
│   ├── errors.py                       # Error codes and exceptions sent to the client
│   ├── hf_env.py                       # Hugging Face cache/token environment helpers
│   ├── list_models.py                  # Queries provider APIs for available LLM models
│   ├── llm_client.py                   # LiteLLM async streaming completions and tool use
│   ├── multimodal.py                   # Image/PDF attachment encoding for vision models
│   ├── protocol.py                     # Parses/serializes WebSocket frames; routes to session
│   ├── rebuild_knowledge.py            # CLI to rebuild RAG index from knowledge folders
│   ├── session.py                      # Per-connection session: VAD segments, STT, LLM, TTS pipeline
│   ├── stt.py                          # OpenAI Whisper local transcription
│   ├── text_split.py                   # Splits assistant text into TTS-friendly sentences
│   ├── tts_engine.py                   # TTS backend abstraction (Supertonic, Piper, pyttsx3)
│   ├── vad.py                          # Silero VAD: speech start/end detection on audio chunks
│   └── knowledge/
│       ├── __init__.py                 # Knowledge subpackage marker
│       ├── context.py                  # Retrieves relevant chunks for LLM context injection
│       ├── embeddings.py               # Embedding model load and vector encode for RAG
│       ├── fingerprint.py              # File content hashing for index invalidation
│       ├── loaders.py                  # Loads PDF/DOCX/text into chunked documents
│       └── manager.py                  # Knowledge index build, search, and folder management
├── scripts/
│   └── smoke_client.py                 # Minimal WebSocket client for manual protocol smoke tests
└── tests/
    ├── test_errors.py                  # Tests for error types and serialization
    ├── test_knowledge_context.py         # Tests for RAG context retrieval
    ├── test_knowledge_fingerprint.py     # Tests for knowledge file fingerprinting
    ├── test_knowledge_loaders.py         # Tests for document loaders
    ├── test_list_models.py               # Tests for model listing helpers
    ├── test_llm_stream.py                # Tests for LLM streaming client
    ├── test_multimodal.py                # Tests for attachment/multimodal encoding
    ├── test_protocol.py                  # Tests for WebSocket protocol messages
    ├── test_sentence_split.py            # Tests for sentence splitting utilities
    ├── test_system_prompt_compose.py     # Tests for system prompt composition
    └── test_text_split.py                # Tests for text split / TTS chunking
```

---

## Optional / tooling (not app runtime)

| Path | Description |
|------|-------------|
| `.agents/skills/docling/` | Agent skill docs for Docling document parsing (development aid) |
| `.claude/skills` | Symlink or local Claude Code skills (environment-specific) |
| `backend/.ruff_cache/` | Ruff linter cache (generated, safe to ignore) |

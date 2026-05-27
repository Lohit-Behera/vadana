# WebSocket protocol (JSON over text frames)

Authoritative contract between the **React/Tauri client** and the **Python sidecar**. For architecture, setup, and troubleshooting, see [backend/README.md](README.md) and [docs/frontend.md](../docs/frontend.md).

- **Bind:** `127.0.0.1` only (not exposed to the LAN by default).
- **Port:** `8765` by default (`LIVE_VOICE_PORT` env).
- **Version:** `protocol_version` in the `ready` message is `3`.

## Client → server

| `type` | Fields | Meaning |
|--------|--------|---------|
| `config` | `llm_provider`, `lm_base_url`, `model`, `api_key`, `max_context_tokens`, `chat_history`, `push_to_talk`, `input_gain`, `vad_sensitivity`, `system_prompt`, `piper_model`, `whisper_model`, `vad_barge_in`, `supertonic_voice`, `supertonic_lang`, `supertonic_model`, `models_root` | `llm_provider`: `lm_studio`, `openai`, `anthropic`, `ollama`, `groq`, `openrouter`. `chat_history`: `[{role, content}, ...]` user/assistant only — loaded on session start or chat switch. `api_key` from OS keychain (never logged). |
| `start` | — | Begin capture + pipeline. |
| `stop` | — | Stop capture and release models/devices. |
| `interrupt` | — | Barge-in: cancel LLM/TTS, clear playback. |
| `ptt_down` | — | Push-to-talk: start buffering mic. |
| `ptt_up` | — | Push-to-talk: flush buffered audio to STT. |
| `user_text` | `text` | Typed user message (text only): skips STT, runs the same LLM + TTS pipeline as voice. |
| `user_message` | `text`, `attachments` | Typed message with optional staged files. Each attachment: `id`, `kind` (`image` \| `pdf`), `mime`, `path` (under app data `attachments/`), `filename`. Paths must stay under `LIVE_VOICE_ATTACHMENTS_DIR`. |

## Server → client

| `type` | Fields | Meaning |
|--------|--------|---------|
| `ready` | `port`, `protocol_version` | Handshake after connect (`protocol_version` is `3`). |
| `state` | `state`: `idle` \| `listening` \| `thinking` \| `speaking` | UI status. |
| `stt_final` | `text` | User message shown in the transcript: from STT **or** from typed `user_text` (same UI event). |
| `stt_partial` | `text` | _(Optional / not emitted.)_ Partial STT for UI. |
| `llm_token` | `text` | Streaming answer token from the LLM (not chain-of-thought). |
| `llm_reasoning_token` | `text` | Streaming reasoning/thinking token (UI only; not sent to TTS). |
| `assistant_text` | `text`, `user_display` (optional), `chat_title` (optional) | Full assistant reply (after stream completes). On the first turn of a new chat, `chat_title` may be set from the model’s `CHAT_TITLE:` line (stripped from `text` / TTS). |
| `context_usage` | `prompt_tokens`, `completion_tokens`, `total_tokens`, `max_context_tokens`, `percent` | Token usage after each LLM turn. |
| `error` | `message`, `code` | Error string; optional `code`: `lm_unreachable`, `stt_failed`, `tts_failed`, `mic_unavailable`, `pipeline_failed`, `unknown`. |
| `notice` | `message` | Non-fatal hint (e.g. typed message sent before pipeline ready). |
| `interrupt_ack` | — | Interrupt was applied. |

Audio is played locally in Python (not streamed to the browser).

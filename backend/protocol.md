# WebSocket protocol (JSON over text frames)

Authoritative contract between the **React/Tauri client** and the **Python sidecar**. For architecture, setup, and troubleshooting, see [backend/README.md](README.md) and [docs/frontend.md](../docs/frontend.md).

- **Bind:** `127.0.0.1` only (not exposed to the LAN by default).
- **Port:** `8765` by default (`LIVE_VOICE_PORT` env).
- **Version:** `protocol_version` in the `ready` message is `1`.

## Client → server

| `type` | Fields | Meaning |
|--------|--------|---------|
| `config` | `lm_base_url`, `model`, `push_to_talk`, `input_gain`, `vad_sensitivity`, `system_prompt`, `piper_model`, `whisper_model`, `vad_barge_in`, `supertonic_voice`, `supertonic_lang`, `supertonic_model` | `vad_barge_in`: if true, mic VAD cancels assistant (echo-prone; use headphones). **Supertonic:** set `supertonic_voice` (e.g. `M1`) for on-device TTS; `supertonic_lang` is an ISO code (`en`, `hi`, … for **Supertonic 3**). Default `supertonic_model` is `supertonic-3`. Empty voice → Piper or pyttsx3. |
| `start` | — | Begin capture + pipeline. |
| `stop` | — | Stop capture and release models/devices. |
| `interrupt` | — | Barge-in: cancel LLM/TTS, clear playback. |
| `ptt_down` | — | Push-to-talk: start buffering mic. |
| `ptt_up` | — | Push-to-talk: flush buffered audio to STT. |
| `user_text` | `text` | Typed user message: skips STT, runs the same LLM + TTS pipeline as voice. |

## Server → client

| `type` | Fields | Meaning |
|--------|--------|---------|
| `ready` | `port`, `protocol_version` | Handshake after connect (`protocol_version` is `1`). |
| `state` | `state`: `idle` \| `listening` \| `thinking` \| `speaking` | UI status. |
| `stt_final` | `text` | User message shown in the transcript: from STT **or** from typed `user_text` (same UI event). |
| `stt_partial` | `text` | _(Optional / not emitted in v1.)_ Partial STT for UI. |
| `llm_token` | `text` | Streaming token from the LLM. |
| `assistant_text` | `text` | Full assistant reply (after stream completes). |
| `error` | `message`, `code` | Error string; optional `code`: `lm_unreachable`, `stt_failed`, `tts_failed`, `mic_unavailable`, `pipeline_failed`, `unknown`. |
| `notice` | `message` | Non-fatal hint (e.g. typed message sent before pipeline ready). |
| `interrupt_ack` | — | Interrupt was applied. |

Audio is played locally in Python (not streamed to the browser in v1).

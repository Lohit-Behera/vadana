const ERROR_MESSAGES: Record<string, string> = {
  lm_unreachable:
    "Cannot reach the LLM server. Start LM Studio (or your OpenAI-compatible server) and check the base URL and model id.",
  stt_failed:
    "Speech recognition failed. Try speaking again or check the Whisper model setting.",
  tts_failed:
    "Text-to-speech failed. Check Supertonic/Piper settings or try another TTS backend.",
  mic_unavailable:
    "Microphone unavailable. Allow microphone access for this app in Windows settings.",
  pipeline_failed:
    "Voice pipeline failed to start. See logs for details.",
  model_no_multimodal:
    "This model does not support images or PDFs. Choose a vision-capable model in Settings.",
  invalid_attachment:
    "Could not read the attachment. Stop the session, press Start again, then re-attach the file.",
  unknown: "An unexpected error occurred.",
};

export function friendlyErrorMessage(
  message: string | undefined,
  code?: string,
): string {
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  if (!message) {
    return ERROR_MESSAGES.unknown;
  }
  const lower = message.toLowerCase();
  if (
    lower.includes("connect") &&
    (lower.includes("refused") || lower.includes("unreachable"))
  ) {
    return ERROR_MESSAGES.lm_unreachable;
  }
  return message;
}

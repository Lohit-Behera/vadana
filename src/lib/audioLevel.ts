/**
 * Soft-knee compression: quiet/moderate levels stay natural; only loud peaks are tamed.
 */
export function normalizeAudioLevel(raw: number): number {
  const x = Math.max(0, Math.min(1, raw));
  const knee = 0.42;
  if (x <= knee) {
    return x;
  }
  const excess = x - knee;
  return knee + Math.tanh(excess * 2.8) * 0.4;
}

/** Asymmetric smoothing — quick attack, slower release. */
export function smoothAudioLevel(
  prev: number,
  next: number,
  attack = 0.38,
  release = 0.12,
): number {
  const normalized = normalizeAudioLevel(next);
  const alpha = normalized > prev ? attack : release;
  return prev + (normalized - prev) * alpha;
}

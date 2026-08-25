export function shouldConfirm({
  confidence,
  threshold,
  streak,
  sameLabel,
  elapsedSinceLast,
  cooldown,
}: {
  confidence: number;
  threshold: number;
  streak: number;
  sameLabel: boolean;
  elapsedSinceLast: number;
  cooldown: number;
}) {
  if (confidence < threshold || streak < 2) return false;
  return !sameLabel || elapsedSinceLast > cooldown;
}

export function isRecentDuplicate(
  previous: { gloss: string; timestamp: number } | undefined,
  next: { gloss: string; timestamp: number },
  windowMs = 2500,
) {
  return Boolean(previous && previous.gloss === next.gloss && next.timestamp - previous.timestamp < windowMs);
}

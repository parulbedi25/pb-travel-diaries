/** Completion must always be checked against this countdown's actual deadline. */
export function hasCountdownExpired(targetDate: string, now = Date.now()): boolean {
  const deadline = Date.parse(targetDate);
  return Number.isFinite(deadline) && deadline <= now;
}
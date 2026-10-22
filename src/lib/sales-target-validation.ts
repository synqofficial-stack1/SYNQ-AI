export function parseDealsTarget(value: string): number {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error('Enter a whole-number deals target.');
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new Error('Enter a whole-number target between 0 and 1,000,000.');
  }
  return parsed;
}

/**
 * A Places call ceiling shared across every source in one refresh.
 *
 * Each resolver used to guard itself with its own per-run limit, which two
 * sources defeat by construction: two runs of 4,500 spend 9,000 against a
 * free allowance of 5,000 without either one tripping. The ceiling has to be
 * carried between them, so `spentAlready` is how the second source learns
 * what the first used.
 */
export function createBudget(ceiling, spentAlready) {
  if (!Number.isInteger(ceiling) || ceiling < 1) {
    throw new Error(`Budget ceiling must be a positive integer, got ${ceiling}`);
  }

  let used = Number(spentAlready) || 0;

  return {
    spend() {
      if (used >= ceiling) {
        throw new Error(
          `Places call budget of ${ceiling} exhausted (${used} used) — stopping before the free tier does`
        );
      }
      used++;
      return used;
    },
    used() {
      return used;
    },
    remaining() {
      return Math.max(0, ceiling - used);
    },
  };
}

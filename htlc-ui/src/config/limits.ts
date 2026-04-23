/**
 * Runtime-configurable safety windows for the swap flow.
 *
 * These are the numbers that used to be hardcoded inside AliceSwap.tsx /
 * BobSwap.tsx. Demo/testnet runs need tiny values (so a 2-minute expiry test
 * is actually feasible); mainnet runs want the original CLI defaults. Centralise
 * them here so one env switch changes the whole app.
 *
 * Every value has a sane fallback — the UI works out of the box without any
 * custom VITE_ variables set.
 */

const num = (key: string, fallback: number): number => {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const limits = {
  /** Minimum acceptable Cardano deadline (minutes) when Alice locks. */
  aliceMinDeadlineMin: num('VITE_ALICE_MIN_DEADLINE_MIN', 3),
  /** Default value shown in Alice's deadline input. */
  aliceDefaultDeadlineMin: num('VITE_ALICE_DEFAULT_DEADLINE_MIN', 120),
  /** Minimum time remaining on Alice's Cardano lock before Bob will accept. */
  bobMinCardanoWindowSecs: num('VITE_BOB_MIN_CARDANO_WINDOW_SECS', 180),
  /** Seconds of safety buffer Bob leaves inside Alice's Cardano deadline. */
  bobSafetyBufferSecs: num('VITE_BOB_SAFETY_BUFFER_SECS', 60),
  /** Minutes Bob's Midnight deadline ideally lasts from now. */
  bobDeadlineMin: num('VITE_BOB_DEADLINE_MIN', 2),
  /**
   * Minutes the reverse-flow taker's Cardano deadline lasts from now.
   *
   * Default is 5 minutes — longer than forward's `bobDeadlineMin` because the
   * reverse maker's claim must land on Cardano (slower finality + script tx
   * propagation + validTo safety margin) before this expires, unlike forward
   * where the maker's claim lands on fast-finality Midnight.
   */
  reverseTakerDeadlineMin: num('VITE_REVERSE_TAKER_DEADLINE_MIN', 5),
  /** Absolute floor (seconds) for Bob's deposit TTL after safety-buffer truncation. */
  bobMinDepositTtlSecs: num('VITE_BOB_MIN_DEPOSIT_TTL_SECS', 60),
  /** Browse hides offers whose deadline is within this many seconds. */
  browseMinRemainingSecs: num('VITE_BROWSE_MIN_REMAINING_SECS', 180),
  /** Ms after the user clicks a signing button before we show "check your wallet". */
  walletPopupHintMs: num('VITE_WALLET_POPUP_HINT_MS', 3000),
};

/** Derive a human-readable "Alice 120min → Bob ≤ 119min → safety ≤ 118min" summary. */
export const describeBobWindow = (cardanoDeadlineMs: number, bobDeadlineSecs: number): string => {
  const cardanoMin = Math.floor((cardanoDeadlineMs - Date.now()) / 60_000);
  const bobMin = Math.floor((bobDeadlineSecs * 1000 - Date.now()) / 60_000);
  return `Cardano deadline: ~${cardanoMin}min  •  Your Midnight deadline: ~${bobMin}min  •  Safety buffer: ${limits.bobSafetyBufferSecs}s`;
};

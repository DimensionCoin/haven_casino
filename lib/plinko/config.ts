// lib/plinko/config.ts

// Number of "steps" in the LR pattern.
// With 17 sinks, 16 drops gives outcomes 0–16.
export const PLINKO_TOTAL_DROPS = 16;

// Multiplier per sink index (0–16).
// You can tweak these, but they MUST respect your global max payout.
export const PLINKO_MULTIPLIERS: Record<number, number> = {
  0: 100,
  1: 40,
  2: 10,
  3: 2,
  4: 1.5,
  5: 1.2,
  6: 1.0,
  7: 0.5,
  8: 0.3,
  9: 0.5,
  10: 1.0,
  11: 1.2,
  12: 1.5,
  13: 2.0,
  14: 10,
  15: 40,
  16: 100,
};

// 10% rake → 0.10
export const PLINKO_RAKE_RATE = 0.1;

// What fraction of the casino float is allowed as MAX payout for a single Plinko win.
// Match this to your pool logic (e.g. same % you use in CasinoProvider for plinko).
export const PLINKO_MAX_POOL_PCT_PER_BET = 0.15; // example: 15% of casino float

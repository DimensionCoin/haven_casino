// lib/plinko/engine.ts

import { WIDTH } from "@/lib/plinko/constants";
import { PLINKO_TOTAL_DROPS, PLINKO_MULTIPLIERS } from "@/lib/plinko/config";
import { outcomes } from "@/lib/plinko/outcomes";
import { pad } from "@/lib/plinko/padding";

export type PlinkoPatternStep = "L" | "R";

export type PlinkoOutcome = {
  sinkIndex: number;
  multiplier: number;
  payoutAmount: number;
  point: number; // padded X coordinate for BallManager.addBall
  pattern: PlinkoPatternStep[];
};

function defaultPoint(): number {
  // Fallback to center if outcomes bucket is empty
  return pad(WIDTH / 2);
}

/**
 * Deterministic plinko outcome generator.
 * All randomness lives here; given the same RNG, you get the same result.
 */
export function generatePlinkoOutcome(
  betAmount: number,
  rng: () => number = Math.random
): PlinkoOutcome {
  const pattern: PlinkoPatternStep[] = [];
  let sinkIndex = 0;

  // Binomial process: count number of "R" steps
  for (let i = 0; i < PLINKO_TOTAL_DROPS; i++) {
    if (rng() > 0.5) {
      pattern.push("R");
      sinkIndex++;
    } else {
      pattern.push("L");
    }
  }

  const multiplier = PLINKO_MULTIPLIERS[sinkIndex] ?? 0;

  const bucket = outcomes[String(sinkIndex)] ?? [];
  let point = defaultPoint();
  if (bucket.length > 0) {
    const idx = Math.floor(rng() * bucket.length);
    point = bucket[Math.max(0, Math.min(bucket.length - 1, idx))];
  }

  const payoutAmount = betAmount * multiplier;

  return {
    sinkIndex,
    multiplier,
    payoutAmount,
    point,
    pattern,
  };
}

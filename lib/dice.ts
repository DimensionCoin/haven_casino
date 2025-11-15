// lib/dice.ts
import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import crypto from "crypto";

/* ============================================================================
   BASIC TYPES
   ============================================================================ */

export type DiceDirection = "over" | "under";

/**
 * Config the frontend / API will send to the dice engine.
 *
 * - betAmount: chips / USDC equivalent (already rounded to cents on API layer)
 * - target: integer between 1 and 99 (no 0 or 100 for solvency/fair odds)
 * - direction: "over" or "under"
 * - houseEdgePct: optional override; default ~1.5%
 */
export type DiceConfig = {
  betAmount: number;
  target: number; // 1-99
  direction: DiceDirection;
  houseEdgePct?: number; // e.g. 0.015 = 1.5%
};

export type DiceOutcome = {
  // Input echo
  betAmount: number;
  target: number;
  direction: DiceDirection;

  // RNG
  roll: number; // 0.00 - 99.99

  // Math
  winChance: number; // 0-1 (probability)
  houseEdgePct: number;
  multiplierBeforeCap: number; // total payout / bet, before pool cap

  // Result
  win: boolean;
  payoutBeforeCap: number; // total payout (stake + profit) before cap
  payoutAfterCap: number; // after pool cap
  profitBeforeCap: number; // payoutBeforeCap - betAmount (or 0 if lose)
  profitAfterCap: number; // payoutAfterCap - betAmount (or 0 if lose)
  cappedByPool: boolean;
  maxWinCap: number;
};

/**
 * Lightweight odds preview for UI:
 * - does NOT roll RNG
 * - does NOT consider pool cap (pure “theoretical” odds)
 */
export type DiceOddsPreview = {
  target: number;
  direction: DiceDirection;
  winChance: number;
  houseEdgePct: number;
  multiplier: number; // total payout (stake + profit) per 1 chip
};

/* ============================================================================
   SOLANA / CASINO POOL CONFIG
   ============================================================================ */

const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  clusterApiUrl(NETWORK);

const connection = new Connection(RPC, "confirmed");

// Casino USDC pool – SAME ENV PATTERN AS SLOTS
const CASINO_WALLET_STR = process.env.NEXT_PUBLIC_CASINO_WALLET;
const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT;

const CASINO_WALLET = CASINO_WALLET_STR
  ? new PublicKey(CASINO_WALLET_STR)
  : null;

const USDC_MINT = USDC_MINT_STR ? new PublicKey(USDC_MINT_STR) : null;

/**
 * Fraction of the global USDC pool we allocate to dice.
 * e.g. DICE_POOL_PCT = 0.25 → 25% of casino bankroll belongs to dice.
 */
const DICE_POOL_PCT = 0.25;

/**
 * We never let a single roll win more than (1 - DICE_POOL_BUFFER_PCT)
 * of the dice pool.
 *
 * DICE_POOL_BUFFER_PCT = 0.10  ->  user max win = 90% of dice pool.
 * That 10% buffer helps keep the casino solvent even on huge hits.
 */
const DICE_POOL_BUFFER_PCT = 0.1;

/**
 * Default house edge for dice.
 * 0.015 = 1.5% edge baked into multipliers (similar to real casinos).
 */
const DEFAULT_HOUSE_EDGE = 0.015;

/* ============================================================================
   HELPERS
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Crypto RNG (0..max-1)
function randomInt(max: number): number {
  return crypto.randomInt(0, max);
}

/**
 * Roll a number between 0.00 and 99.99, inclusive.
 * Classic web dice: 2 decimal precision.
 */
function randomRoll(): number {
  const n = randomInt(10_000); // 0..9999
  return n / 100; // 0.00..99.99
}

/* ============================================================================
   PURE ODDS / MATH HELPERS (no RPC / no RNG)
   ============================================================================ */

/**
 * Compute base winChance + multiplier from target/direction + house edge.
 * Fully deterministic & sync; great for UI previews and tests.
 */
export function computeDiceOdds(
  targetInput: number,
  directionInput: DiceDirection,
  houseEdgeInput?: number
): DiceOddsPreview {
  // Sanitize target
  const target = Math.floor(targetInput);
  if (target <= 0 || target >= 100) {
    throw new Error("target must be between 1 and 99");
  }

  const direction = directionInput;
  if (direction !== "over" && direction !== "under") {
    throw new Error('direction must be "over" or "under"');
  }

  // Clamp house edge
  let houseEdge = houseEdgeInput ?? DEFAULT_HOUSE_EDGE;
  if (!Number.isFinite(houseEdge)) houseEdge = DEFAULT_HOUSE_EDGE;
  houseEdge = Math.max(0, Math.min(houseEdge, 0.2)); // 0–20%

  // Strict inequalities:
  //  - "under": win if roll < target
  //  - "over":  win if roll > target
  const winChance = direction === "under" ? target / 100 : (100 - target) / 100;

  if (winChance <= 0 || winChance >= 1) {
    throw new Error("invalid winChance derived from target/direction");
  }

  // Fair multiplier would be 1 / winChance. Apply edge:
  const multiplier = (1 - houseEdge) / winChance;

  return {
    target,
    direction,
    winChance,
    houseEdgePct: houseEdge,
    multiplier: roundToCents(multiplier),
  };
}

/**
 * Given a known dice pool cap, compute the maximum bet such that
 * the *uncapped* theoretical payout will NOT exceed that cap.
 *
 * This lets you implement a max-bet guard in the API or UI.
 */
export function computeMaxBetForConfig(params: {
  target: number;
  direction: DiceDirection;
  houseEdgePct?: number;
  maxWinCap: number; // already in USDC/chips (e.g. output of getDiceMaxWinCap)
}): number {
  const { target, direction, houseEdgePct, maxWinCap } = params;

  if (maxWinCap <= 0) return 0;

  const odds = computeDiceOdds(target, direction, houseEdgePct);
  const multiplier = odds.multiplier;

  // maxBet * multiplier <= maxWinCap  ->  maxBet = maxWinCap / multiplier
  const raw = maxWinCap / multiplier;
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  // Slightly conservative rounding (down to cents).
  return roundToCents(Math.max(raw - 0.01, 0));
}

/* ============================================================================
   CASINO POOL HELPERS
   ============================================================================ */

async function getCasinoUsdcBalance(): Promise<number> {
  if (!CASINO_WALLET || !USDC_MINT) {
    // If env missing, treat as 0 (safer: no pool, no big wins).
    return 0;
  }

  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, CASINO_WALLET);
    const account = await getAccount(connection, ata);
    const amount = Number(account.amount); // raw units
    // Assuming USDC 6 decimals
    return amount / 10 ** 6;
  } catch (err) {
    console.error("[dice] Error fetching casino USDC pool", err);
    return 0;
  }
}

/**
 * Get the max allowed payout (stake + profit) for a *single* dice roll.
 *
 * - Reads casino USDC pool for CASINO_WALLET
 * - Takes DICE_POOL_PCT as the dice “bankroll slice”
 * - Applies DICE_POOL_BUFFER_PCT to keep a buffer (e.g. 10% of dice pool)
 */
export async function getDiceMaxWinCap(): Promise<number> {
  const totalPool = await getCasinoUsdcBalance();
  if (totalPool <= 0) return 0;

  const dicePool = totalPool * DICE_POOL_PCT;
  const maxWin = dicePool * (1 - DICE_POOL_BUFFER_PCT);

  return maxWin;
}

/* ============================================================================
   CORE LOGIC: ONE DICE ROLL (NO DB SIDE EFFECTS)
   ============================================================================ */

/**
 * Play one round of dice with the given config.
 *
 * - Computes win chance from (target, direction)
 * - Builds multiplier using (1 - houseEdge) / winChance
 * - Rolls a number 0.00-99.99 with crypto RNG
 * - Applies pool-based max win cap (so user never wins > 90% of dice pool)
 *
 * NOTE:
 * - This does NOT move any balances. Your API route should:
 *   1) call applyBetWithRake (or applyBet) to debit the user
 *   2) call rollDice()
 *   3) if outcome.win, call applyPayout with outcome.payoutAfterCap
 *
 * Full solvency is guaranteed by:
 * - chipVault invariants (chipsInCirculation <= on-chain USDC)
 * - dice pool cap here (payoutAfterCap <= 90% of dice pool slice)
 */
export async function rollDice(config: DiceConfig): Promise<DiceOutcome> {
  // Sanitize bet
  const betAmount = roundToCents(config.betAmount);
  if (betAmount <= 0) {
    throw new Error("betAmount must be > 0");
  }

  // Reuse pure odds math for validation & multipliers
  const odds = computeDiceOdds(
    config.target,
    config.direction,
    config.houseEdgePct
  );

  const { target, direction, winChance, houseEdgePct, multiplier } = odds;

  // RNG: fair roll
  const roll = randomRoll();

  const win = direction === "under" ? roll < target : roll > target;

  let payoutBeforeCap = 0;
  if (win) {
    payoutBeforeCap = roundToCents(betAmount * multiplier);
  }

  const profitBeforeCap = win ? roundToCents(payoutBeforeCap - betAmount) : 0;

  // Pool-based max win cap (bankroll protection)
  const maxWinCap = await getDiceMaxWinCap();
  let payoutAfterCap = payoutBeforeCap;
  let cappedByPool = false;

  if (maxWinCap > 0 && payoutBeforeCap > maxWinCap) {
    payoutAfterCap = roundToCents(maxWinCap);
    cappedByPool = true;
  }

  const profitAfterCap = win ? roundToCents(payoutAfterCap - betAmount) : 0;

  return {
    betAmount,
    target,
    direction,
    roll,
    winChance,
    houseEdgePct,
    multiplierBeforeCap: multiplier,
    win,
    payoutBeforeCap,
    payoutAfterCap,
    profitBeforeCap,
    profitAfterCap,
    cappedByPool,
    maxWinCap: roundToCents(maxWinCap),
  };
}

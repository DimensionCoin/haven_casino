// lib/highlow.ts
import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import crypto from "crypto";

/* ============================================================================
   BASIC TYPES
   ============================================================================ */

export type HighLowDirection = "higher" | "lower";

export type HighLowOutcome = {
  initialNumber: number;
  nextNumber: number;
  direction: HighLowDirection;
  isWin: boolean;
  isLoss: boolean;
  isPush: boolean;
  rawPayout: number; // before pool cap
  finalPayout: number; // after pool cap
  maxWinCap: number;
  cappedByPool: boolean;

  // 🔥 Ladder-style info
  potBefore: number; // the "run" amount you staked on THIS guess
  potAfter: number; // the new ladder pot if you keep going (0 on loss)
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

const CASINO_WALLET_STR = process.env.NEXT_PUBLIC_CASINO_WALLET;
const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT;

const CASINO_WALLET = CASINO_WALLET_STR
  ? new PublicKey(CASINO_WALLET_STR)
  : null;

const USDC_MINT = USDC_MINT_STR ? new PublicKey(USDC_MINT_STR) : null;

/**
 * Portion of total casino USDC pool that is allocated to the High/Low game.
 */
const HIGHLOW_POOL_PCT = Number(
  process.env.NEXT_PUBLIC_HIGHLOW_POOL_PCT ?? "0.15"
); // 15% of USDC pool

/**
 * Single-round win cap for the High/Low pool.
 * 0.9 = 90% of the highlow pool -> 10% safety buffer.
 */
const HIGHLOW_MAX_SINGLE_WIN_POOL_PCT = 0.9;

/**
 * Payout multiplier for a correct guess.
 */
const HIGHLOW_PAYOUT_MULTIPLIER = Number(
  process.env.NEXT_PUBLIC_HIGHLOW_PAYOUT_MULTIPLIER ?? "1.5"
);

/* ============================================================================
   HELPERS
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Inclusive random int, using crypto RNG for fairness.
function randomIntInclusive(min: number, max: number): number {
  if (max < min) throw new Error("invalid randomIntInclusive range");
  // crypto.randomInt is [min, max) so add 1 to max
  return crypto.randomInt(min, max + 1);
}

/* ============================================================================
   CASINO POOL HELPERS
   ============================================================================ */

async function getCasinoUsdcBalance(): Promise<number> {
  if (!CASINO_WALLET || !USDC_MINT) {
    // If env missing, treat as 0 for safety.
    return 0;
  }

  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, CASINO_WALLET);
    const account = await getAccount(connection, ata);
    const amount = Number(account.amount); // raw token units
    // Assuming USDC 6 decimals
    return amount / 10 ** 6;
  } catch (err) {
    console.error("[highlow] Error fetching casino USDC pool", err);
    return 0;
  }
}

export async function getHighLowMaxWinCap(): Promise<number> {
  const totalPool = await getCasinoUsdcBalance();
  if (totalPool <= 0) return 0;

  const highLowPool = totalPool * HIGHLOW_POOL_PCT;
  const cap = highLowPool * HIGHLOW_MAX_SINGLE_WIN_POOL_PCT; // minus 10% buffer
  return cap;
}

/* ============================================================================
   INITIAL NUMBER GENERATOR
   ============================================================================ */

export function getHighLowInitialNumber(): number {
  // 🔥 First card: force 45–65
  return randomIntInclusive(45, 65);
}

/* ============================================================================
   MAIN GAME LOGIC (ONE STEP IN THE LADDER)
   - You treat betAmount as "current ladder pot" for this guess.
   - If win   → potAfter = betAmount * multiplier (capped by pool).
   - If push  → potAfter = betAmount (no change).
   - If loss  → potAfter = 0  (run is dead).
   - Frontend keeps calling this with potAfter as the next betAmount
     until the user hits "Cashout" or they lose.
   ============================================================================ */

export async function playHighLow(
  betAmount: number,
  direction: HighLowDirection,
  initialNumberOverride?: number,
  /**
   * 🔥 true = this is the VERY FIRST flip after the initial card
   * in the current ladder run → force nextNumber into 45–65.
   * false/undefined = normal behaviour (nextNumber 1–100).
   */
  isFirstFlip: boolean = false
): Promise<HighLowOutcome> {
  if (!Number.isFinite(betAmount)) {
    throw new Error("betAmount must be a finite number");
  }

  // We treat betAmount as the ladder pot for this guess.
  const bet = roundToCents(Math.max(0, betAmount));

  if (bet <= 0) {
    throw new Error("betAmount must be > 0");
  }

  const initialNumber =
    typeof initialNumberOverride === "number"
      ? initialNumberOverride
      : getHighLowInitialNumber();

  // 🔥 Logic change:
  // - If this is the FIRST flip -> 45–65
  // - Otherwise -> 1–100
  const nextNumber = isFirstFlip
    ? randomIntInclusive(45, 65)
    : randomIntInclusive(1, 100);

  const isHigher = nextNumber > initialNumber;
  const isLower = nextNumber < initialNumber;

  const isPush = nextNumber === initialNumber;
  const isWin =
    !isPush &&
    ((direction === "higher" && isHigher) ||
      (direction === "lower" && isLower));
  const isLoss = !isPush && !isWin;

  let rawPayout: number;

  if (isPush) {
    // Tie → keep pot as-is (ladder continues unchanged).
    rawPayout = bet;
  } else if (isWin) {
    // Correct guess
    rawPayout = bet * HIGHLOW_PAYOUT_MULTIPLIER;
  } else {
    // Loss → ladder pot nuked
    rawPayout = 0;
  }

  rawPayout = roundToCents(rawPayout);

  const maxWinCap = await getHighLowMaxWinCap();

  const cappedPayout =
    maxWinCap > 0 ? Math.min(rawPayout, roundToCents(maxWinCap)) : rawPayout;

  const finalPayout = roundToCents(cappedPayout);
  const cappedByPool = finalPayout < rawPayout;

  const potBefore = bet;
  const potAfter = finalPayout; // new ladder pot the frontend should use for the next guess

  return {
    initialNumber,
    nextNumber,
    direction,
    isWin,
    isLoss,
    isPush,
    rawPayout,
    finalPayout,
    maxWinCap: roundToCents(maxWinCap),
    cappedByPool,
    potBefore,
    potAfter,
  };
}

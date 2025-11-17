// lib/plinko.ts
import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import crypto from "crypto";

export type PlinkoRisk = "low" | "medium" | "high";

export type PlinkoConfig = {
  risk: PlinkoRisk;
  rows: number;
  destinations: number; // = rows - 1
  multipliers: number[]; // length = destinations
  rakePct: number;
  maxWinCap: number;
  maxBet: number;
  poolAmount: number;
};

export type PlinkoPlayOutcome = {
  slotIndex: number; // 0..destinations-1 (LOCAL index for the current rows)
  multiplier: number;
  winAmountBeforeCap: number;
  winAmountAfterCap: number;
  cappedByPool: boolean;
};

/* ============================================================================
   SOLANA / POOL CONFIG
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

// How much of the global USDC pool is "assigned" to plinko.
const PLINKO_POOL_PCT = 0.25; // 25% of total USDC pool

// Max a single Plinko **payout** can ever be, as a % of plinkoPool
const PLINKO_MAX_SINGLE_WIN_POOL_PCT = 0.9; // 90% of plinko pool

// Max a single **bet** can be, as a % of plinkoPool
export const PLINKO_MAX_BET_POOL_PCT = 0.9; // 90% of plinko pool

// Rake: 1% of every bet
export const PLINKO_RAKE_PCT = 0.01;

/* ============================================================================
   RNG HELPERS
   ============================================================================ */

function randomInt(max: number): number {
  return crypto.randomInt(0, max); // [0, max-1]
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ============================================================================
   MULTIPLIER TABLES (BASE = 17 buckets)
   ============================================================================ */

const MAX_ROWS = 18;
const ROW_OPTIONS = [10, 12, 14, 16, 18] as const;

const BASE_MULTIPLIERS: Record<PlinkoRisk, number[]> = {
  low: [
    3.0, 2.5, 1.9, 1.5, 1.2, 1.1, 0.9, 0.75, 0.5, 0.75, 0.9, 1.1, 1.2, 1.5, 1.9,
    2.5, 3.0,
  ],
  medium: [
    6.0, 4.0, 3.0, 2.5, 2.0, 1.3, 0.9, 0.5, 0.3, 0.5, 0.9, 1.3, 2.0, 2.5, 3.0,
    4.0, 6.0,
  ],
  high: [
    10.0, 8.0, 6.0, 4.0, 2.0, 1.5, 0.2, 0.2, 0.2, 0.2, 0.2, 1.5, 2.0, 4.0, 6.0,
    8.0, 10.0,
  ],
};

function getMaxMultiplier(): number {
  return Math.max(
    ...BASE_MULTIPLIERS.low,
    ...BASE_MULTIPLIERS.medium,
    ...BASE_MULTIPLIERS.high
  );
}

function normalizeRows(rowsRaw?: number): number {
  const n = Number(rowsRaw) || MAX_ROWS;
  if (ROW_OPTIONS.includes(n as (typeof ROW_OPTIONS)[number])) return n;
  return MAX_ROWS;
}

/**
 * Backend version of "getLayoutForRows" – same idea as front-end:
 * - sinkCount = rows - 1
 * - take center slice of 17-wide curve
 */
function getLayoutForRowsBackend(
  risk: PlinkoRisk,
  rowsRaw?: number
): { rows: number; sinkCount: number; multipliers: number[] } {
  const rows = normalizeRows(rowsRaw);
  const sinkCount = rows - 1;

  const base = BASE_MULTIPLIERS[risk];

  if (sinkCount >= base.length) {
    // in practice we never exceed 17, but keep this safe
    return {
      rows,
      sinkCount: base.length,
      multipliers: base,
    };
  }

  const diff = base.length - sinkCount;
  const start = Math.floor(diff / 2);
  const end = start + sinkCount;

  return {
    rows,
    sinkCount,
    multipliers: base.slice(start, end),
  };
}

/* ============================================================================
   CASINO POOL HELPERS
   ============================================================================ */

async function getCasinoUsdcBalance(): Promise<number> {
  if (!CASINO_WALLET || !USDC_MINT) return 0;

  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, CASINO_WALLET);
    const account = await getAccount(connection, ata);
    const amount = Number(account.amount);
    return amount / 10 ** 6; // USDC decimals
  } catch (err) {
    console.error("[plinko] Error fetching casino USDC pool", err);
    return 0;
  }
}

export async function getPlinkoLimits(): Promise<{
  totalPool: number;
  plinkoPool: number;
  maxWinCap: number;
  maxBet: number;
}> {
  const totalPool = await getCasinoUsdcBalance();
  if (totalPool <= 0) {
    return {
      totalPool: 0,
      plinkoPool: 0,
      maxWinCap: 0,
      maxBet: 0,
    };
  }

  const plinkoPool = totalPool * PLINKO_POOL_PCT;

  const maxWinCap = plinkoPool * PLINKO_MAX_SINGLE_WIN_POOL_PCT;

  const theoreticalMaxMult = getMaxMultiplier() || 1;
  const safeMaxBetFromCap =
    theoreticalMaxMult > 0 ? maxWinCap / theoreticalMaxMult : plinkoPool;

  const maxBet = Math.min(
    plinkoPool * PLINKO_MAX_BET_POOL_PCT,
    safeMaxBetFromCap
  );

  return {
    totalPool: roundToCents(totalPool),
    plinkoPool: roundToCents(plinkoPool),
    maxWinCap: roundToCents(maxWinCap),
    maxBet: roundToCents(maxBet),
  };
}

/* ============================================================================
   CONFIG + PLAY LOGIC
   ============================================================================ */

export async function getPlinkoConfig(
  risk: PlinkoRisk,
  rowsRaw?: number
): Promise<PlinkoConfig> {
  const { plinkoPool, maxWinCap, maxBet } = await getPlinkoLimits();
  const { rows, sinkCount, multipliers } = getLayoutForRowsBackend(
    risk,
    rowsRaw
  );

  return {
    risk,
    rows,
    destinations: sinkCount,
    multipliers,
    rakePct: PLINKO_RAKE_PCT,
    maxWinCap,
    maxBet,
    poolAmount: plinkoPool,
  };
}

export async function playPlinko(
  betAmount: number,
  risk: PlinkoRisk,
  rowsRaw?: number
): Promise<{ config: PlinkoConfig; outcome: PlinkoPlayOutcome }> {
  const config = await getPlinkoConfig(risk, rowsRaw);

  const cleanBet = roundToCents(betAmount);
  if (cleanBet <= 0) {
    throw new Error("Bet must be > 0");
  }

  if (config.maxBet > 0 && cleanBet > config.maxBet) {
    throw new Error(
      `Bet exceeds max plinko bet. Max allowed is ${config.maxBet}`
    );
  }

  const multipliers = config.multipliers;

  // slotIndex is 0..(destinations-1) FOR THE CURRENT ROWS
  const slotIndex = randomInt(multipliers.length);
  const multiplier = multipliers[slotIndex];

  const rawWin = roundToCents(cleanBet * multiplier);
  const cappedWin =
    config.maxWinCap > 0 ? Math.min(rawWin, config.maxWinCap) : rawWin;

  const outcome: PlinkoPlayOutcome = {
    slotIndex,
    multiplier,
    winAmountBeforeCap: rawWin,
    winAmountAfterCap: cappedWin,
    cappedByPool: cappedWin < rawWin,
  };

  return { config, outcome };
}

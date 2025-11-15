// lib/slots.ts
import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import crypto from "crypto";

/* ============================================================================
   BASIC TYPES
   ============================================================================ */

export type SlotSymbol = "🍒" | "🍋" | "🔔" | "💎" | "7";

export type LineWin = {
  lineIndex: number;
  length: 3 | 4 | 5 | 6; // now supports 3-of-a-kind
  symbol: SlotSymbol;
  payout: number;
  isZigZag: boolean;
  freeSpin: boolean;
};

export type SlotGrid = SlotSymbol[][]; // [row][col]

export type SlotSpinOutcome = {
  grid: SlotGrid;
  lineWins: LineWin[];
  totalWinBeforeCap: number;
  totalWinAfterCap: number;
  freeSpins: number;
  maxWinCap: number;
  cappedByPool: boolean;
};

/* ============================================================================
   SOLANA / CASINO POOL CONFIG
   ============================================================================ */

// Network + RPC (reuse your casino buy config pattern)
const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  clusterApiUrl(NETWORK);

const connection = new Connection(RPC, "confirmed");

// Casino USDC pool – these MUST be set in env for pool-based max win logic
const CASINO_WALLET_STR = process.env.NEXT_PUBLIC_CASINO_WALLET;
const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT;

const CASINO_WALLET = CASINO_WALLET_STR
  ? new PublicKey(CASINO_WALLET_STR)
  : null;

const USDC_MINT = USDC_MINT_STR ? new PublicKey(USDC_MINT_STR) : null;

// How much of the global USDC pool is "assigned" to slots
// You can adjust this when you add other games (dice, roulette, etc).
const SLOTS_POOL_PCT = 0.25; // 25% of total USDC pool goes to slots

// Max a single spin can ever win from that slots pool
const MAX_SINGLE_WIN_POOL_PCT = 0.9; // 90% of slots pool

/* ============================================================================
   REELS / SYMBOL WEIGHTS
   ============================================================================ */

const ROWS = 4;
const COLS = 6;

// Weights control volatility & RTP feel. Rarer symbols hit less often.
// 🍒, 🍋 are common low-payers; 🔔 mid; 💎 and 7 are high-payers & rarer.
const SYMBOL_WEIGHTS: { symbol: SlotSymbol; weight: number }[] = [
  { symbol: "🍒", weight: 40 },
  { symbol: "🍋", weight: 32 },
  { symbol: "🔔", weight: 16 },
  { symbol: "💎", weight: 8 },
  { symbol: "7", weight: 4 },
];

const TOTAL_WEIGHT = SYMBOL_WEIGHTS.reduce((sum, s) => sum + s.weight, 0);

/* ============================================================================
   PAYLINES (STRAIGHT + ZIGZAG)
   Each pattern is an array of row indexes for each of the 6 columns.
   ============================================================================ */

// 0–3: straight lines (rows)
// 4–9: zig-zag lines
export const PAYLINES: number[][] = [
  // Straight
  [0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3, 3],
  // Zig-zag patterns
  [0, 1, 2, 3, 2, 1],
  [3, 2, 1, 0, 1, 2],
  [1, 0, 1, 2, 3, 2],
  [2, 3, 2, 1, 0, 1],
  [0, 0, 1, 1, 2, 2],
  [3, 3, 2, 2, 1, 1],
];

/* ============================================================================
   PAYTABLE (symbol-dependent, Vegas-style)
   - Straight lines pay more than zig-zags
   - High-value symbols (💎, 7) pay more
   - 3-of-a-kind small hits, 5–6 can be chunky
   ============================================================================ */

const STRAIGHT_PAYTABLE: Record<
  SlotSymbol,
  Partial<Record<3 | 4 | 5 | 6, number>>
> = {
  "🍒": { 3: 0.3, 4: 0.6, 5: 1.2, 6: 2.0 },
  "🍋": { 3: 0.4, 4: 0.8, 5: 1.5, 6: 3.0 },
  "🔔": { 3: 0.6, 4: 1.2, 5: 2.5, 6: 5.0 },
  "💎": { 3: 1.0, 4: 2.5, 5: 5.0, 6: 12.0 },
  "7": { 3: 1.5, 4: 4.0, 5: 10.0, 6: 25.0 },
};

const ZIGZAG_PAYTABLE: Record<
  SlotSymbol,
  Partial<Record<3 | 4 | 5 | 6, number>>
> = {
  "🍒": { 3: 0.1, 4: 0.2, 5: 0.4, 6: 0.8 },
  "🍋": { 3: 0.1, 4: 0.3, 5: 0.6, 6: 1.0 },
  "🔔": { 3: 0.15, 4: 0.4, 5: 0.8, 6: 1.5 },
  "💎": { 3: 0.2, 4: 0.5, 5: 1.0, 6: 2.0 },
  "7": { 3: 0.25, 4: 0.6, 5: 1.2, 6: 2.5 },
};

/* ============================================================================
   RNG HELPERS
   ============================================================================ */

// Use crypto RNG, not Math.random, for casino fairness.
function randomInt(max: number): number {
  // returns 0..max-1
  return crypto.randomInt(0, max);
}

function randomSymbol(): SlotSymbol {
  const r = randomInt(TOTAL_WEIGHT);
  let acc = 0;
  for (const entry of SYMBOL_WEIGHTS) {
    acc += entry.weight;
    if (r < acc) return entry.symbol;
  }
  // Fallback; should never hit.
  return SYMBOL_WEIGHTS[0].symbol;
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ============================================================================
   GRID GENERATION
   ============================================================================ */

export function generateSlotGrid(): SlotGrid {
  const grid: SlotGrid = Array.from({ length: ROWS }, () =>
    Array<SlotSymbol>(COLS).fill("🍒")
  );

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      grid[row][col] = randomSymbol();
    }
  }

  return grid;
}

/* ============================================================================
   EVALUATION LOGIC
   - Check each payline
   - Count matching symbols from left -> right
   - 3/4/5/6 in a row pay out
   - Zigzags: smaller pays but good source of free spins
   - 7s on straight lines also award free spins (like a "bonus" vibe)
   ============================================================================ */

export function evaluateSlotGrid(
  grid: SlotGrid,
  betAmount: number
): { totalWin: number; lineWins: LineWin[]; freeSpins: number } {
  let totalWin = 0;
  let freeSpins = 0;
  const lineWins: LineWin[] = [];

  PAYLINES.forEach((pattern, lineIndex) => {
    const isZigZag = lineIndex >= 4;

    const firstRow = pattern[0];
    const firstSymbol = grid[firstRow][0];

    let runLength = 1;
    for (let col = 1; col < COLS; col++) {
      const row = pattern[col];
      if (grid[row][col] === firstSymbol) {
        runLength++;
      } else {
        break;
      }
    }

    // Require at least 3-of-a-kind from the left-most reel
    if (runLength < 3) return;

    const length = Math.min(runLength, 6) as 3 | 4 | 5 | 6;

    const paytable = isZigZag
      ? ZIGZAG_PAYTABLE[firstSymbol]
      : STRAIGHT_PAYTABLE[firstSymbol];

    const multiplier = paytable[length] ?? 0;
    if (multiplier <= 0) return;

    let givesFreeSpin = false;
    let freeSpinsFromThisLine = 0;

    // Zig-zags: always small pays, but can award free spins on longer chains
    if (isZigZag) {
      if (length >= 4) {
        // 4,5,6 on zig-zag → 1 free spin
        givesFreeSpin = true;
        freeSpinsFromThisLine = 1;
      }
    } else {
      // Straight lines: 7s feel like bonus triggers
      if (firstSymbol === "7" && length >= 4) {
        givesFreeSpin = true;
        // 4x 7s → 1 free spin, 5x → 2, 6x → 3
        freeSpinsFromThisLine = length - 3;
      }
    }

    const payout = roundToCents(betAmount * multiplier);
    totalWin += payout;

    if (givesFreeSpin && freeSpinsFromThisLine > 0) {
      freeSpins += freeSpinsFromThisLine;
    }

    lineWins.push({
      lineIndex,
      length,
      symbol: firstSymbol,
      payout,
      isZigZag,
      freeSpin: givesFreeSpin,
    });
  });

  return { totalWin: roundToCents(totalWin), lineWins, freeSpins };
}

/* ============================================================================
   CASINO POOL HELPERS
   - Read USDC balance for casino wallet
   - Derive slots pool & max per-spin win cap
   ============================================================================ */

async function getCasinoUsdcBalance(): Promise<number> {
  if (!CASINO_WALLET || !USDC_MINT) {
    // If env missing, no pool -> no max cap (treat as 0 for safety).
    return 0;
  }

  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, CASINO_WALLET);
    const account = await getAccount(connection, ata);
    const amount = Number(account.amount); // raw units
    // Assuming USDC 6 decimals
    return amount / 10 ** 6;
  } catch (err) {
    console.error("[slots] Error fetching casino USDC pool", err);
    return 0;
  }
}

export async function getSlotsMaxWinCap(): Promise<number> {
  const totalPool = await getCasinoUsdcBalance();
  if (totalPool <= 0) return 0;

  const slotsPool = totalPool * SLOTS_POOL_PCT;
  const cap = slotsPool * MAX_SINGLE_WIN_POOL_PCT;
  return cap;
}

/* ============================================================================
   MAIN: ONE COMPLETE SPIN (NO DB SIDE EFFECTS)
   ============================================================================ */

export async function spinSlots(betAmount: number): Promise<SlotSpinOutcome> {
  const bet = Math.max(0, betAmount);

  const grid = generateSlotGrid();
  const { totalWin, lineWins, freeSpins } = evaluateSlotGrid(grid, bet);

  const maxWinCap = await getSlotsMaxWinCap();

  const cappedWin = maxWinCap > 0 ? Math.min(totalWin, maxWinCap) : totalWin;

  return {
    grid,
    lineWins,
    totalWinBeforeCap: totalWin,
    totalWinAfterCap: cappedWin,
    freeSpins,
    maxWinCap,
    cappedByPool: cappedWin < totalWin,
  };
}

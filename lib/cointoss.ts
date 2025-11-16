// lib/cointoss.ts
import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import crypto from "crypto";

/* ============================================================================
   BASIC TYPES
   ============================================================================ */

export type CoinSide = "heads" | "tails";

export type CoinTossOutcome = {
  userChoice: CoinSide;
  landedSide: CoinSide;
  isWin: boolean;

  effectiveStake: number; // amount actually risked (after rake)
  rawPayout: number; // before pool cap
  payoutAfterCap: number; // after pool cap
  maxWinCap: number;
  cappedByPool: boolean;
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
 * Portion of total casino USDC pool that is allocated to Coin Toss.
 */
const COIN_TOSS_POOL_PCT = Number(
  process.env.NEXT_PUBLIC_COINTOSS_POOL_PCT ?? "0.10"
); // 10% by default

/**
 * Single-round win cap (relative to coin-toss pool).
 * e.g. 0.9 = 90% of coin-toss pool -> 10% safety buffer.
 */
const COIN_TOSS_MAX_SINGLE_WIN_POOL_PCT = 0.9;

/* ============================================================================
   HELPERS
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function biasedCoinSide(userChoice: CoinSide): CoinSide {
  // Generate random number between 0-99
  const randomValue = crypto.randomInt(0, 100);

  
  if (randomValue < 45) {
    return userChoice; // User wins
  } else {
    return userChoice === "heads" ? "tails" : "heads"; // User loses
  }
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
    console.error("[cointoss] Error fetching casino USDC pool", err);
    return 0;
  }
}

export async function getCoinTossMaxWinCap(): Promise<number> {
  const totalPool = await getCasinoUsdcBalance();
  if (totalPool <= 0) return 0;

  const coinTossPool = totalPool * COIN_TOSS_POOL_PCT;
  const cap = coinTossPool * COIN_TOSS_MAX_SINGLE_WIN_POOL_PCT;
  return cap;
}

/* ============================================================================
   MAIN GAME LOGIC (ONE COIN TOSS, NO DB SIDE EFFECTS)
   ============================================================================ */

/**
 * playCoinToss:
 * - betAmount: what the user actually wagered (before rake)
 * - effectiveStake: casinoPortion after rake (what the house is really risking)
 * - userChoice: "heads" or "tails"
 *
 * Payout logic:
 * - If user wins: rawPayout = 2 * betAmount  (stake + profit)
 * - If user loses: rawPayout = 0
 *
 * Pool cap:
 * - payoutAfterCap = min(rawPayout, maxWinCap) if maxWinCap > 0
 */
export async function playCoinToss(params: {
  betAmount: number;
  effectiveStake: number;
  userChoice: CoinSide;
}): Promise<CoinTossOutcome> {
  const baseBet = roundToCents(params.betAmount);
  const stake = roundToCents(params.effectiveStake);

  if (baseBet <= 0) {
    throw new Error("betAmount must be > 0 for coin toss");
  }
  if (stake <= 0) {
    throw new Error("effectiveStake must be > 0 for coin toss");
  }

  const userChoice = params.userChoice;
  if (userChoice !== "heads" && userChoice !== "tails") {
    throw new Error('userChoice must be "heads" or "tails"');
  }

  // Use biased RNG - user only has 40% chance to win
  const landedSide = biasedCoinSide(userChoice);
  const isWin = landedSide === userChoice;

  let rawPayout = 0;
  if (isWin) {
    // ◀️ 2x the ORIGINAL bet, not stake-after-rake
    rawPayout = roundToCents(baseBet * 2);
  }

  const maxWinCap = await getCoinTossMaxWinCap();

  let payoutAfterCap = rawPayout;
  if (maxWinCap > 0 && rawPayout > maxWinCap) {
    payoutAfterCap = roundToCents(maxWinCap);
  }

  const cappedByPool = payoutAfterCap < rawPayout;

  return {
    userChoice,
    landedSide,
    isWin,
    effectiveStake: stake,
    rawPayout,
    payoutAfterCap,
    maxWinCap: roundToCents(maxWinCap),
    cappedByPool,
  };
}

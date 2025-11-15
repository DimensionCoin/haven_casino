// lib/chipVault.ts
import mongoose from "mongoose";
import ChipVault from "@/models/ChipVault";
import UserModel from "@/models/User";
import Treasury from "@/models/Treasury";
import { connectDb } from "@/lib/db";
import { getOnChainCasinoUsdcBalance } from "@/lib/onchain";

const CASINO_WALLET = process.env.NEXT_PUBLIC_CASINO_WALLET!;
const TREASURY_WALLET =
  process.env.NEXT_PUBLIC_CASINO_TREASURY_WALLET ||
  process.env.CASINO_TREASURY_WALLET ||
  "";

/* ============================================================================
   Helpers
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ensure there is a ChipVault document.
 * Also backfill any missing fields on older docs (like casinoVirtualBalance).
 */
export async function getOrCreateVault(session?: mongoose.ClientSession) {
  await connectDb();

  const vault = await ChipVault.findOne({ token: "USDC" }).session(
    session ?? null
  );

  if (vault) {
    let changed = false;

    // Make sure casinoWallet is correct
    if (vault.casinoWallet !== CASINO_WALLET) {
      vault.casinoWallet = CASINO_WALLET;
      changed = true;
    }

    // Backfill casinoVirtualBalance if missing
    if (typeof vault.casinoVirtualBalance !== "number") {
      vault.casinoVirtualBalance = 0;
      changed = true;
    }

    // Ensure lastUsdcBalance is a number
    if (typeof vault.lastUsdcBalance !== "number") {
      vault.lastUsdcBalance = 0;
      changed = true;
    }

    if (changed) {
      await vault.save({ session });
    }

    return vault;
  }

  // No vault yet → create fresh one with all fields
  const created = await ChipVault.create(
    [
      {
        token: "USDC",
        casinoWallet: CASINO_WALLET,
        chipsInCirculation: 0,
        casinoVirtualBalance: 0,
        lastUsdcBalance: 0,
      },
    ],
    { session }
  );

  return created[0];
}

/* ============================================================================
   Minting (supply changes)
   ============================================================================ */

/**
 * Called when a user buys chips (after USDC actually hits the casino wallet).
 *
 * 1 chip = 1 USDC
 *
 * - credits user's virtualBalance
 * - bumps chipsInCirculation
 * - NEVER allows chipsInCirculation > on-chain USDC backing
 * - DOES NOT touch casinoVirtualBalance (that's only for house float)
 */
export async function mintChipsForUser(walletAddress: string, amount: number) {
  if (amount <= 0) throw new Error("mint amount must be > 0");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const vault = await getOrCreateVault(session);

      // Hard backstop: never over-mint vs on-chain USDC
      const onChain = await getOnChainCasinoUsdcBalance();
      vault.lastUsdcBalance = onChain;

      if (vault.chipsInCirculation + amount > onChain) {
        throw new Error("Insufficient on-chain USDC to back new user chips");
      }

      const user = await UserModel.findOneAndUpdate(
        { walletAddress },
        { $setOnInsert: { walletAddress } },
        { new: true, upsert: true, session }
      );

      user.virtualBalance = (user.virtualBalance ?? 0) + amount;

      // Global supply includes user chips
      vault.chipsInCirculation += amount;

      await user.save({ session });
      await vault.save({ session });
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Mint chips into the CASINO virtual wallet (house float).
 *
 * Flow:
 * 1. Admin sends USDC -> CASINO_WALLET on-chain.
 * 2. We call mintHouseChips(amount).
 * 3. Treasury.virtualBalance (for CASINO_WALLET) += amount
 *    vault.chipsInCirculation (global supply) += amount
 *    vault.casinoVirtualBalance (house float) += amount
 */
export async function mintHouseChips(amount: number) {
  if (amount <= 0) throw new Error("mint amount must be > 0");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const vault = await getOrCreateVault(session);

      // find or create treasury record for the casino wallet
      let treasury = await Treasury.findOne({
        walletAddress: CASINO_WALLET,
      }).session(session);

      if (!treasury) {
        treasury = new Treasury({
          walletAddress: CASINO_WALLET,
          virtualBalance: 0,
          totalFeesCollected: 0,
        });
      }

      const onChain = await getOnChainCasinoUsdcBalance();
      vault.lastUsdcBalance = onChain;

      // global solvency: total chips can never exceed USDC backing
      if (vault.chipsInCirculation + amount > onChain) {
        throw new Error(
          "Not enough on-chain USDC in casino vault to back additional house chips"
        );
      }

      // House chips: used to pay game wins
      treasury.virtualBalance = (treasury.virtualBalance ?? 0) + amount;

      // Global supply (users + house)
      vault.chipsInCirculation += amount;

      // House float tracked on the vault itself
      vault.casinoVirtualBalance = (vault.casinoVirtualBalance ?? 0) + amount;

      await treasury.save({ session });
      await vault.save({ session });
    });
  } finally {
    await session.endSession();
  }
}

/* ============================================================================
   Centralized game accounting (NO supply change)
   ============================================================================ */

/**
 * Simple bet:
 * - Move `amount` chips from USER -> CASINO
 * - DOES NOT change chipsInCirculation (just redistributes ownership)
 *
 * Used by games that don't have a treasury rake split.
 */
export async function applyBet(walletAddress: string, amount: number) {
  if (amount <= 0) throw new Error("bet amount must be > 0");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const vault = await getOrCreateVault(session);

      const user = await UserModel.findOne({
        walletAddress,
      }).session(session);

      if (!user) {
        throw new Error("User not found for bet");
      }

      const currentBalance = user.virtualBalance ?? 0;

      if (currentBalance < amount) {
        throw new Error("Insufficient chips to place bet");
      }

      // USER → CASINO
      user.virtualBalance = roundToCents(currentBalance - amount);
      vault.casinoVirtualBalance = roundToCents(
        (vault.casinoVirtualBalance ?? 0) + amount
      );

      // chipsInCirculation is unchanged (just moving ownership)
      await user.save({ session });
      await vault.save({ session });
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Bet with rake:
 * - Move `amount` chips from USER
 * - Split: casinoPortion -> casinoVirtualBalance
 *          treasuryPortion -> Treasury.virtualBalance (+ totalFeesCollected)
 * - DOES NOT change chipsInCirculation
 *
 * Used for slots (and any rake-based games).
 */
export async function applyBetWithRake(
  walletAddress: string,
  amount: number,
  rakeRate: number
): Promise<{ casinoPortion: number; treasuryPortion: number }> {
  if (amount <= 0) throw new Error("bet amount must be > 0");

  // Clamp rakeRate to [0, 1]
  const safeRate = Math.max(0, Math.min(rakeRate, 1));

  const rawTreasury = amount * safeRate;
  const treasuryPortion = roundToCents(rawTreasury);
  const casinoPortion = roundToCents(amount - treasuryPortion);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const vault = await getOrCreateVault(session);

      const user = await UserModel.findOne({
        walletAddress,
      }).session(session);

      if (!user) {
        throw new Error("User not found for bet");
      }

      const currentBalance = user.virtualBalance ?? 0;

      if (currentBalance < amount) {
        throw new Error("Insufficient chips to place bet");
      }

      // USER total debit
      user.virtualBalance = roundToCents(currentBalance - amount);

      // Casino share
      vault.casinoVirtualBalance = roundToCents(
        (vault.casinoVirtualBalance ?? 0) + casinoPortion
      );

      // Treasury share (if treasury wallet exists)
      if (TREASURY_WALLET && treasuryPortion > 0) {
        await Treasury.findOneAndUpdate(
          { walletAddress: TREASURY_WALLET },
          {
            $setOnInsert: {
              walletAddress: TREASURY_WALLET,
            },
            $inc: {
              virtualBalance: treasuryPortion,
              totalFeesCollected: treasuryPortion,
            },
          },
          { new: true, upsert: true, session }
        ).exec();
      }

      // chipsInCirculation is unchanged (just moving ownership)
      await user.save({ session });
      await vault.save({ session });
    });
  } finally {
    await session.endSession();
  }

  return { casinoPortion, treasuryPortion };
}

/**
 * Apply a payout (win):
 * - Move `amount` chips from CASINO -> USER
 * - DOES NOT change chipsInCirculation (just redistributes ownership)
 *
 * Call this when a user wins (amount can include stake + profit).
 */
export async function applyPayout(walletAddress: string, amount: number) {
  if (amount <= 0) throw new Error("payout amount must be > 0");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const vault = await getOrCreateVault(session);

      const casinoFloat = vault.casinoVirtualBalance ?? 0;
      if (casinoFloat < amount) {
        throw new Error("Casino has insufficient virtual balance for payout");
      }

      const user = await UserModel.findOneAndUpdate(
        { walletAddress },
        {
          $setOnInsert: { walletAddress },
        },
        { new: true, upsert: true, session }
      );

      const currentBalance = user.virtualBalance ?? 0;

      // CASINO → USER
      user.virtualBalance = roundToCents(currentBalance + amount);
      vault.casinoVirtualBalance = roundToCents(casinoFloat - amount);

      // chipsInCirculation is unchanged (just moving ownership)
      await user.save({ session });
      await vault.save({ session });
    });
  } finally {
    await session.endSession();
  }
}

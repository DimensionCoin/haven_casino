// app/api/buy/complete/route.ts
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import User, { type IUser } from "@/models/User";
import Treasury from "@/models/Treasury";
import { mintChipsForUser } from "@/lib/chipVault"; // 👈 NEW: use vault logic
import { Cluster, clusterApiUrl, Connection } from "@solana/web3.js";
import { FEE_RATE } from "@/lib/fee";
import { Schema, model, models, type Document, type Model } from "mongoose";

/* ============================================================================
   ENV & RPC
   ============================================================================ */

const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  clusterApiUrl(NETWORK);

const connection = new Connection(RPC, "confirmed");

// Optional feature flag: turn on full on-chain verification when ready
const VERIFY_BUY_TX = process.env.VERIFY_BUY_TX === "true";

const CASINO_USDC_MINT = process.env.CASINO_USDC_MINT || "";

// Main casino wallet (where base USDC goes)
const CASINO_WALLET =
  process.env.NEXT_PUBLIC_CASINO_WALLET ||
  process.env.CASINO_HOUSE_WALLET ||
  "";

// Treasury wallet (where fee USDC goes)
const CASINO_TREASURY_WALLET =
  process.env.NEXT_PUBLIC_CASINO_TREASURY_WALLET || "";

const USDC_DECIMALS = Number(process.env.CASINO_USDC_DECIMALS ?? "6") || 6;

/* ============================================================================
   HELPERS
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Clamp fee to sane 0–20% so bad env can't wreck things
const SAFE_FEE_RATE = (() => {
  if (typeof FEE_RATE !== "number" || !Number.isFinite(FEE_RATE)) return 0;
  if (FEE_RATE < 0) return 0;
  if (FEE_RATE > 0.2) return 0.2;
  return FEE_RATE;
})();

function roughlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/* ============================================================================
   DepositTx MODEL (for idempotency)
   ============================================================================ */

interface IDepositTx extends Document {
  walletAddress: string;
  txSignature: string;
  chips: number; // how many chips the user should receive (1 chip = 1 USDC base)
  totalDebit: number; // base + fee in USDC
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const DepositTxSchema = new Schema<IDepositTx>(
  {
    walletAddress: { type: String, required: true, index: true, trim: true },
    txSignature: { type: String, required: true, unique: true, index: true },
    chips: { type: Number, required: true, min: 0 },
    totalDebit: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

const DepositTx: Model<IDepositTx> =
  (models.DepositTx as Model<IDepositTx> | undefined) ||
  model<IDepositTx>("DepositTx", DepositTxSchema);

/* ============================================================================
   ROUTE
   ============================================================================ */

export async function POST(req: Request) {
  try {
    await connectDb();

    const body = await req.json().catch(() => null);

    const walletAddress = body?.walletAddress as string | undefined;
    const amount = body?.amount as number | undefined; // chips requested
    const txSignature = body?.txSignature as string | undefined;

    /* ----- Basic validation ----- */

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Valid numeric amount is required" },
        { status: 400 }
      );
    }

    // Hard cap to prevent ridiculous values
    if (amount > 1_000_000) {
      return NextResponse.json({ error: "Amount too large" }, { status: 400 });
    }

    if (!txSignature || typeof txSignature !== "string") {
      return NextResponse.json(
        { error: "txSignature is required" },
        { status: 400 }
      );
    }

    const normalizedWallet = walletAddress.trim();
    const chipsRequested = Number(amount); // 1 chip = 1 USDC of base

    /* ----- Fee & total debit (server-side canonical) ----- */

    const fee = roundToCents(chipsRequested * SAFE_FEE_RATE); // USDC → fee ONLY
    const baseUi = roundToCents(chipsRequested); // USDC → sent to casino
    const totalDebit = roundToCents(baseUi + fee); // USDC user paid total

    if (totalDebit <= 0) {
      return NextResponse.json(
        { error: "Total debit must be positive" },
        { status: 400 }
      );
    }

    /* =========================================================================
       IDEMPOTENCY: lock on txSignature
       ========================================================================= */

    const existingDeposit = await DepositTx.findOneAndUpdate(
      { txSignature },
      {
        $setOnInsert: {
          walletAddress: normalizedWallet,
          chips: chipsRequested,
          totalDebit,
          status: "pending",
        },
      },
      { new: true, upsert: true }
    ).lean<IDepositTx>();

    if (!existingDeposit) {
      return NextResponse.json(
        { error: "Failed to track deposit" },
        { status: 500 }
      );
    }

    // Already processed → just return current user + deposit info (no double credit)
    if (existingDeposit.status === "completed") {
      const user = await User.findOne({
        walletAddress: normalizedWallet,
      }).lean<IUser>();

      const safeVirtual =
        typeof user?.virtualBalance === "number" ? user.virtualBalance : 0;

      return NextResponse.json(
        {
          user: user
            ? { ...user, virtualBalance: safeVirtual }
            : { walletAddress: normalizedWallet, virtualBalance: 0 },
          credited: existingDeposit.chips,
          fee,
          totalDebit: existingDeposit.totalDebit,
          txSignature,
          alreadyProcessed: true,
        },
        { status: 200 }
      );
    }

    // Signature reused with mismatched data → reject
    if (
      existingDeposit.walletAddress !== normalizedWallet ||
      !roughlyEqual(existingDeposit.chips, chipsRequested, 0.0001) ||
      !roughlyEqual(existingDeposit.totalDebit, totalDebit, 0.0001)
    ) {
      return NextResponse.json(
        { error: "Deposit details mismatch for this txSignature" },
        { status: 400 }
      );
    }

    /* =========================================================================
       OPTIONAL: on-chain verification (flip VERIFY_BUY_TX=true when ready)
       ========================================================================= */

    if (VERIFY_BUY_TX) {
      if (!CASINO_USDC_MINT || !CASINO_WALLET || !CASINO_TREASURY_WALLET) {
        console.error(
          "[buy/complete] VERIFY_BUY_TX=true but CASINO_USDC_MINT / CASINO_WALLET / CASINO_TREASURY_WALLET missing"
        );
        return NextResponse.json(
          { error: "Server misconfigured for verification" },
          { status: 500 }
        );
      }

      try {
        const tx = await connection.getParsedTransaction(txSignature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });

        if (!tx || !tx.meta || tx.meta.err) {
          await DepositTx.updateOne(
            { txSignature },
            { $set: { status: "failed" } }
          );
          return NextResponse.json(
            { error: "Transaction not found or failed" },
            { status: 400 }
          );
        }

        const preTokenBalances = tx.meta.preTokenBalances || [];
        const postTokenBalances = tx.meta.postTokenBalances || [];

        // Casino (base)
        const casinoPre = preTokenBalances.find(
          (b) => b.mint === CASINO_USDC_MINT && b.owner === CASINO_WALLET
        );
        const casinoPost = postTokenBalances.find(
          (b) => b.mint === CASINO_USDC_MINT && b.owner === CASINO_WALLET
        );

        // Treasury (fee)
        const treasuryPre = preTokenBalances.find(
          (b) =>
            b.mint === CASINO_USDC_MINT && b.owner === CASINO_TREASURY_WALLET
        );
        const treasuryPost = postTokenBalances.find(
          (b) =>
            b.mint === CASINO_USDC_MINT && b.owner === CASINO_TREASURY_WALLET
        );

        if (!casinoPre || !casinoPost) {
          await DepositTx.updateOne(
            { txSignature },
            { $set: { status: "failed" } }
          );
          return NextResponse.json(
            { error: "USDC deposit to casino wallet not detected" },
            { status: 400 }
          );
        }

        const tolerance = 1 / 10 ** USDC_DECIMALS;

        const preCasinoAmount = Number(casinoPre.uiTokenAmount?.uiAmount ?? 0);
        const postCasinoAmount = Number(
          casinoPost.uiTokenAmount?.uiAmount ?? 0
        );
        const deltaCasino = postCasinoAmount - preCasinoAmount;

        let deltaTreasury = 0;

        if (fee > 0) {
          if (!treasuryPre || !treasuryPost) {
            await DepositTx.updateOne(
              { txSignature },
              { $set: { status: "failed" } }
            );
            return NextResponse.json(
              { error: "USDC fee to treasury wallet not detected" },
              { status: 400 }
            );
          }

          const preTreasuryAmount = Number(
            treasuryPre.uiTokenAmount?.uiAmount ?? 0
          );
          const postTreasuryAmount = Number(
            treasuryPost.uiTokenAmount?.uiAmount ?? 0
          );
          deltaTreasury = postTreasuryAmount - preTreasuryAmount;
        }

        const deltaTotal = deltaCasino + deltaTreasury;

        // Check total debit matches
        if (!roughlyEqual(deltaTotal, totalDebit, tolerance)) {
          await DepositTx.updateOne(
            { txSignature },
            { $set: { status: "failed" } }
          );
          return NextResponse.json(
            {
              error: "On-chain total amount does not match expected debit",
              expected: totalDebit,
              actual: deltaTotal,
            },
            { status: 400 }
          );
        }

        // Check casino received the base (chips)
        if (!roughlyEqual(deltaCasino, baseUi, tolerance)) {
          await DepositTx.updateOne(
            { txSignature },
            { $set: { status: "failed" } }
          );
          return NextResponse.json(
            {
              error: "On-chain casino amount does not match base portion",
              expectedBase: baseUi,
              actualBase: deltaCasino,
            },
            { status: 400 }
          );
        }

        // Check treasury received the fee
        if (fee > 0 && !roughlyEqual(deltaTreasury, fee, tolerance)) {
          await DepositTx.updateOne(
            { txSignature },
            { $set: { status: "failed" } }
          );
          return NextResponse.json(
            {
              error: "On-chain treasury amount does not match fee portion",
              expectedFee: fee,
              actualFee: deltaTreasury,
            },
            { status: 400 }
          );
        }
      } catch (verifyErr) {
        console.error("[buy/complete] verification error:", verifyErr);
        await DepositTx.updateOne(
          { txSignature },
          { $set: { status: "failed" } }
        );
        return NextResponse.json(
          { error: "Failed to verify transaction on-chain" },
          { status: 400 }
        );
      }
    }

    /* =========================================================================
       MINT CHIPS VIA CHIPVAULT (updates global supply + user virtualBalance)
       ========================================================================= */

    // 👇 This is the critical bit: this will
    // - increment vault.chipsInCirculation
    // - increment user.virtualBalance
    // - enforce solvency vs on-chain USDC
    await mintChipsForUser(normalizedWallet, chipsRequested);

    // Fetch updated user for response
    const userDoc = await User.findOne({
      walletAddress: normalizedWallet,
    }).lean<IUser>();

    const safeVirtual =
      typeof userDoc?.virtualBalance === "number" && userDoc.virtualBalance >= 0
        ? userDoc.virtualBalance
        : 0;

    const responseUser = userDoc
      ? { ...userDoc, virtualBalance: safeVirtual }
      : { walletAddress: normalizedWallet, virtualBalance: safeVirtual };

    /* =========================================================================
       CREDIT TREASURY FEE STATS (USDC fee only, no chips)
       ========================================================================= */

    if (fee > 0 && CASINO_TREASURY_WALLET) {
      try {
        await Treasury.findOneAndUpdate(
          { walletAddress: CASINO_TREASURY_WALLET },
          {
            $setOnInsert: {
              walletAddress: CASINO_TREASURY_WALLET,
              notes: "Primary casino treasury wallet",
            },
            $inc: {
              // Only track fee stats; do NOT give treasury chips here
              totalFeesCollected: fee,
            },
          },
          { upsert: true }
        );
      } catch (e) {
        console.error("[buy/complete] failed to update Treasury fee stats:", e);
        // don't fail whole request – user already got chips, on-chain tx is done
      }
    }

    // Mark deposit as completed (best-effort; user already has chips)
    try {
      await DepositTx.updateOne(
        { txSignature },
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
          },
        }
      );
    } catch (e) {
      console.error("[buy/complete] failed to mark deposit completed:", e);
    }

    return NextResponse.json(
      {
        user: responseUser,
        credited: chipsRequested,
        fee,
        totalDebit,
        txSignature,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/buy/complete error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

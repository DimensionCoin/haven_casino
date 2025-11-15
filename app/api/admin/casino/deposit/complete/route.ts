// app/api/admin/casino/deposit/complete/route.ts
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { mintHouseChips } from "@/lib/chipVault";
import { getOnChainCasinoUsdcBalance } from "@/lib/onchain";
import ChipVault from "@/models/ChipVault";
import Treasury from "@/models/Treasury";
import { isAdminWallet } from "@/lib/admin";

import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { Schema, model, models, type Document, type Model } from "mongoose";

/* ============================================================================
   ENV & RPC
   ============================================================================ */

const VERIFY_ADMIN_DEPOSIT = process.env.VERIFY_ADMIN_DEPOSIT === "true";

const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  clusterApiUrl(NETWORK);

const connection = new Connection(RPC, "confirmed");

const CASINO_USDC_MINT = process.env.CASINO_USDC_MINT || "";
const CASINO_WALLET =
  process.env.NEXT_PUBLIC_CASINO_WALLET ||
  process.env.CASINO_HOUSE_WALLET ||
  "";

const USDC_DECIMALS = Number(process.env.CASINO_USDC_DECIMALS ?? "6") || 6;

/* ============================================================================
   HELPERS
   ============================================================================ */

function roughlyEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/* ============================================================================
   AdminDepositTx MODEL (idempotency for house deposits)
   ============================================================================ */

interface IAdminDepositTx extends Document {
  walletAddress: string; // admin wallet
  txSignature: string;
  amount: number; // USDC / chips
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const AdminDepositTxSchema = new Schema<IAdminDepositTx>(
  {
    walletAddress: { type: String, required: true, index: true, trim: true },
    txSignature: { type: String, required: true, unique: true, index: true },
    amount: { type: Number, required: true, min: 0 },
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

const AdminDepositTx: Model<IAdminDepositTx> =
  (models.AdminDepositTx as Model<IAdminDepositTx> | undefined) ||
  model<IAdminDepositTx>("AdminDepositTx", AdminDepositTxSchema);

/* ============================================================================
   ROUTE
   ============================================================================ */

export async function POST(req: Request) {
  try {
    await connectDb();

    const body = await req.json().catch(() => null);
    const walletAddress = body?.walletAddress as string | undefined;
    const amount = body?.amount as number | undefined;
    const txSignature = body?.txSignature as string | undefined;

    /* ----- Basic validation ----- */

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    // 🔒 Only allow known admin wallets to use this endpoint
    if (!isAdminWallet(walletAddress.trim())) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Valid numeric amount is required" },
        { status: 400 }
      );
    }

    if (amount > 1_000_000) {
      return NextResponse.json({ error: "Amount too large" }, { status: 400 });
    }

    if (!txSignature || typeof txSignature !== "string") {
      return NextResponse.json(
        { error: "txSignature is required" },
        { status: 400 }
      );
    }

    const depositUi = amount;
    const normalizedWallet = walletAddress.trim();

    /* =========================================================================
       IDEMPOTENCY: lock on txSignature
       ========================================================================= */

    const existing = await AdminDepositTx.findOneAndUpdate(
      { txSignature },
      {
        $setOnInsert: {
          walletAddress: normalizedWallet,
          amount: depositUi,
          status: "pending",
        },
      },
      { new: true, upsert: true }
    ).lean<IAdminDepositTx>();

    if (!existing) {
      return NextResponse.json(
        { error: "Failed to track admin deposit" },
        { status: 500 }
      );
    }

    // Already completed → don't mint again, just return current state
    if (existing.status === "completed") {
      const [onChainUsdc, vault, treasury] = await Promise.all([
        getOnChainCasinoUsdcBalance(),
        ChipVault.findOne({ token: "USDC" }),
        Treasury.findOne({ walletAddress: CASINO_WALLET }),
      ]);

      return NextResponse.json(
        {
          ok: true,
          minted: existing.amount,
          backingUsdc: onChainUsdc,
          vault: {
            chipsInCirculation: vault?.chipsInCirculation ?? 0,
            casinoVirtualBalance: vault?.casinoVirtualBalance ?? 0,
            lastUsdcBalance: vault?.lastUsdcBalance ?? null,
          },
          treasury: {
            walletAddress: treasury?.walletAddress ?? null,
            virtualBalance: treasury?.virtualBalance ?? 0,
          },
          txSignature,
          alreadyProcessed: true,
        },
        { status: 200 }
      );
    }

    // Signature reused with mismatched details → reject
    if (
      existing.walletAddress !== normalizedWallet ||
      !roughlyEqual(existing.amount, depositUi, 0.0001)
    ) {
      return NextResponse.json(
        { error: "Deposit details mismatch for this txSignature" },
        { status: 400 }
      );
    }

    /* =========================================================================
       OPTIONAL: on-chain verification (admin -> casino)
       ========================================================================= */

    if (VERIFY_ADMIN_DEPOSIT) {
      if (!CASINO_USDC_MINT || !CASINO_WALLET) {
        console.error(
          "[admin/casino/deposit/complete] VERIFY_ADMIN_DEPOSIT=true but env missing"
        );
        return NextResponse.json(
          { error: "Server misconfigured for verification" },
          { status: 500 }
        );
      }

      const tx = await connection.getParsedTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });

      if (!tx || !tx.meta || tx.meta.err) {
        await AdminDepositTx.updateOne(
          { txSignature },
          { $set: { status: "failed" } }
        );
        return NextResponse.json(
          { error: "Transaction not found or failed" },
          { status: 400 }
        );
      }

      const adminPk = new PublicKey(normalizedWallet);
      const mintPkStr = CASINO_USDC_MINT;
      const casinoPkStr = CASINO_WALLET;

      const pre = tx.meta.preTokenBalances || [];
      const post = tx.meta.postTokenBalances || [];

      const adminPre = pre.find(
        (b) => b.mint === mintPkStr && b.owner === adminPk.toBase58()
      );
      const adminPost = post.find(
        (b) => b.mint === mintPkStr && b.owner === adminPk.toBase58()
      );

      const casinoPre = pre.find(
        (b) => b.mint === mintPkStr && b.owner === casinoPkStr
      );
      const casinoPost = post.find(
        (b) => b.mint === mintPkStr && b.owner === casinoPkStr
      );

      if (!adminPre || !adminPost || !casinoPre || !casinoPost) {
        await AdminDepositTx.updateOne(
          { txSignature },
          { $set: { status: "failed" } }
        );
        return NextResponse.json(
          { error: "USDC transfer admin->casino not detected" },
          { status: 400 }
        );
      }

      const admPre = Number(adminPre.uiTokenAmount?.uiAmount ?? 0);
      const admPost = Number(adminPost.uiTokenAmount?.uiAmount ?? 0);
      const casPre = Number(casinoPre.uiTokenAmount?.uiAmount ?? 0);
      const casPost = Number(casinoPost.uiTokenAmount?.uiAmount ?? 0);

      const deltaAdmin = admPost - admPre;
      const deltaCasino = casPost - casPre;
      const tolerance = 1 / 10 ** USDC_DECIMALS;

      // admin should have lost `amount`, casino gained `amount`
      if (
        !roughlyEqual(deltaAdmin, -depositUi, tolerance) ||
        !roughlyEqual(deltaCasino, depositUi, tolerance)
      ) {
        await AdminDepositTx.updateOne(
          { txSignature },
          { $set: { status: "failed" } }
        );
        return NextResponse.json(
          {
            error: "On-chain amounts do not match expected admin deposit",
            expected: depositUi,
            deltaAdmin,
            deltaCasino,
          },
          { status: 400 }
        );
      }
    }

    /* =========================================================================
       MINT HOUSE CHIPS (single source of truth)
       ========================================================================= */

    await mintHouseChips(depositUi);

    // Mark deposit as completed (best-effort; chips already minted)
    try {
      await AdminDepositTx.updateOne(
        { txSignature },
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
          },
        }
      );
    } catch (e) {
      console.error(
        "[admin/casino/deposit/complete] failed to mark deposit completed:",
        e
      );
    }

    const [onChainUsdc, vault, treasury] = await Promise.all([
      getOnChainCasinoUsdcBalance(),
      ChipVault.findOne({ token: "USDC" }),
      Treasury.findOne({ walletAddress: CASINO_WALLET }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        minted: depositUi,
        backingUsdc: onChainUsdc,
        vault: {
          chipsInCirculation: vault?.chipsInCirculation ?? 0,
          casinoVirtualBalance: vault?.casinoVirtualBalance ?? 0,
          lastUsdcBalance: vault?.lastUsdcBalance ?? null,
        },
        treasury: {
          walletAddress: treasury?.walletAddress ?? null,
          virtualBalance: treasury?.virtualBalance ?? 0,
        },
        txSignature,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/admin/casino/deposit/complete error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

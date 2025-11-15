// app/api/sell/complete/route.ts
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import User, { type IUser } from "@/models/User";
import {
  Cluster,
  clusterApiUrl,
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Schema, model, models, type Document, type Model } from "mongoose";
import { burnUserChips } from "@/lib/chipVault"; // 👈 NEW

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

// Casino wallet (payer of withdrawals)
const CASINO_PUBLIC =
  process.env.NEXT_PUBLIC_CASINO_WALLET ||
  process.env.CASINO_TREASURY_WALLET ||
  "";

const CASINO_SECRET = process.env.CASINO_WALLET_SECRET_KEY || "";

const CASINO_USDC_MINT =
  process.env.CASINO_USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "";

const USDC_DECIMALS = Number(process.env.CASINO_USDC_DECIMALS ?? "6") || 6;

/* ============================================================================
   HELPERS
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function requireEnv() {
  if (!CASINO_PUBLIC || !CASINO_SECRET || !CASINO_USDC_MINT) {
    throw new Error(
      "Casino withdraw env missing: NEXT_PUBLIC_CASINO_WALLET / CASINO_WALLET_SECRET_KEY / CASINO_USDC_MINT"
    );
  }

  let secretArr: number[];
  try {
    secretArr = JSON.parse(CASINO_SECRET);
  } catch {
    throw new Error("CASINO_WALLET_SECRET_KEY is not valid JSON");
  }

  if (!Array.isArray(secretArr) || secretArr.length === 0) {
    throw new Error("CASINO_WALLET_SECRET_KEY JSON must be a non-empty array");
  }

  const secretKey = Uint8Array.from(secretArr);
  const keypair = Keypair.fromSecretKey(secretKey);
  const pubkey = new PublicKey(CASINO_PUBLIC);

  // Optional sanity: make sure env pubkey matches derived pubkey
  if (!keypair.publicKey.equals(pubkey)) {
    console.warn(
      "[sell/complete] Warning: CASINO_WALLET_SECRET_KEY does not match NEXT_PUBLIC_CASINO_WALLET"
    );
  }

  return { casinoKeypair: keypair, casinoPubkey: pubkey };
}

/* ============================================================================
   WithdrawTx MODEL (logging only)
   ============================================================================ */

interface IWithdrawTx extends Document {
  walletAddress: string;
  txSignature: string;
  chips: number;
  usdcAmount: number; // how much USDC was sent
  status: "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const WithdrawTxSchema = new Schema<IWithdrawTx>(
  {
    walletAddress: { type: String, required: true, index: true, trim: true },
    txSignature: { type: String, required: true, unique: true, index: true },
    chips: { type: Number, required: true, min: 0 },
    usdcAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["completed", "failed"],
      default: "completed",
      index: true,
    },
  },
  { timestamps: true }
);

const WithdrawTx: Model<IWithdrawTx> =
  (models.WithdrawTx as Model<IWithdrawTx> | undefined) ||
  model<IWithdrawTx>("WithdrawTx", WithdrawTxSchema);

/* ============================================================================
   ROUTE: Redeem chips → USDC
   ============================================================================ */

export async function POST(req: Request) {
  try {
    await connectDb();

    // 1) Basic input
    const body = await req.json().catch(() => null);

    const walletAddress = body?.walletAddress as string | undefined;
    const amount = body?.amount as number | undefined; // chips to redeem

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

    if (amount > 1_000_000) {
      return NextResponse.json({ error: "Amount too large" }, { status: 400 });
    }

    const normalizedWallet = walletAddress.trim();
    const chipsToRedeem = roundToCents(Number(amount)); // keep it clean
    const userPubkey = new PublicKey(normalizedWallet);

    // 2) Load casino keypair + mint
    let casinoKeypair: Keypair;
    let casinoPubkey: PublicKey;
    try {
      const env = requireEnv();
      casinoKeypair = env.casinoKeypair;
      casinoPubkey = env.casinoPubkey;
    } catch (envErr: unknown) {
      console.error("[sell/complete env error]", envErr);
      return NextResponse.json(
        { error: "Server misconfigured for withdrawals" },
        { status: 500 }
      );
    }

    const usdcMintPk = new PublicKey(CASINO_USDC_MINT);

    // 3) Check user has enough chips (virtualBalance)
    const userDoc = await User.findOne({
      walletAddress: normalizedWallet,
    }).lean<IUser>();

    const currentChips =
      typeof userDoc?.virtualBalance === "number" ? userDoc.virtualBalance : 0;

    if (!userDoc || currentChips <= 0 || currentChips < chipsToRedeem) {
      return NextResponse.json(
        {
          error: "Insufficient chips to withdraw",
          currentChips,
          requested: chipsToRedeem,
        },
        { status: 400 }
      );
    }

    // 4) Check casino has enough USDC (on-chain backing)
    const casinoAta = await getAssociatedTokenAddress(usdcMintPk, casinoPubkey);
    const userAta = await getAssociatedTokenAddress(usdcMintPk, userPubkey);

    const casinoBalanceResp = await connection.getTokenAccountBalance(
      casinoAta
    );
    const casinoUsdc = casinoBalanceResp.value.uiAmount ?? 0;

    if (casinoUsdc < chipsToRedeem) {
      console.error(
        "[sell/complete] Casino USDC too low",
        casinoUsdc,
        "needed",
        chipsToRedeem
      );
      return NextResponse.json(
        {
          error: "Casino treasury does not have enough USDC for this payout",
        },
        { status: 500 }
      );
    }

    // 5) Build on-chain transfer: casino → user
    const uiFactor = 10 ** USDC_DECIMALS;
    const rawAmount = BigInt(Math.round(chipsToRedeem * uiFactor));

    const ix = createTransferInstruction(
      casinoAta,
      userAta,
      casinoPubkey,
      rawAmount,
      [],
      TOKEN_PROGRAM_ID
    );

    const latestBlockhash = await connection.getLatestBlockhash("finalized");

    const message = new TransactionMessage({
      payerKey: casinoPubkey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([casinoKeypair]);

    let txSignature: string;
    try {
      txSignature = await connection.sendTransaction(tx, {
        skipPreflight: false,
      });

      await connection.confirmTransaction(txSignature, "confirmed");
    } catch (chainErr) {
      console.error("[sell/complete] On-chain send error:", chainErr);
      return NextResponse.json(
        { error: "Failed to send USDC to your wallet" },
        { status: 500 }
      );
    }

    // 6) Burn chips in vault (global supply ↓) and update user chips
    try {
      await burnUserChips(normalizedWallet, chipsToRedeem);
    } catch (burnErr) {
      console.error("[sell/complete] burnUserChips error:", burnErr);
      // At this point USDC already left the vault; you may want alerts
      // or a compensating script if this ever throws.
    }

    // Optionally update lastSeenAt without touching balances
    await User.updateOne(
      { walletAddress: normalizedWallet },
      { $set: { lastSeenAt: new Date() } }
    );

    const updatedUser = await User.findOne({
      walletAddress: normalizedWallet,
    }).lean<IUser>();

    const safeVirtual =
      typeof updatedUser?.virtualBalance === "number" &&
      updatedUser.virtualBalance >= 0
        ? updatedUser.virtualBalance
        : 0;

    const responseUser = updatedUser
      ? { ...updatedUser, virtualBalance: safeVirtual }
      : { walletAddress: normalizedWallet, virtualBalance: safeVirtual };

    // 7) Log withdrawal
    try {
      await WithdrawTx.create({
        walletAddress: normalizedWallet,
        txSignature,
        chips: chipsToRedeem,
        usdcAmount: chipsToRedeem, // 1:1 payout
        status: "completed",
      });
    } catch (logErr) {
      console.error("[sell/complete] Failed to log withdrawal:", logErr);
    }

    return NextResponse.json(
      {
        user: responseUser,
        debitedChips: chipsToRedeem,
        usdcSent: chipsToRedeem,
        txSignature,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/sell/complete error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

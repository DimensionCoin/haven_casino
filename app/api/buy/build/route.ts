// app/api/buy/build/route.ts
import { NextResponse } from "next/server";
import {
  Cluster,
  clusterApiUrl,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { FEE_RATE } from "@/lib/fee";

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

// Casino & treasury wallets
const CASINO_WALLET = process.env.NEXT_PUBLIC_CASINO_WALLET || "";
const TREASURY_WALLET =
  process.env.NEXT_PUBLIC_CASINO_TREASURY_WALLET ||
  process.env.CASINO_TREASURY_WALLET ||
  "";

const USDC_MINT =
  process.env.CASINO_USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "";

// On-chain decimals for USDC
const USDC_DECIMALS = Number(process.env.CASINO_USDC_DECIMALS ?? "6") || 6;

/* ============================================================================
   HELPERS
   ============================================================================ */

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Clamp fee rate to sane bounds so a bad env var doesn’t wreck things
const SAFE_FEE_RATE = (() => {
  if (typeof FEE_RATE !== "number" || !Number.isFinite(FEE_RATE)) return 0;
  if (FEE_RATE < 0) return 0;
  if (FEE_RATE > 0.2) return 0.2; // max 20% for safety
  return FEE_RATE;
})();

/* ============================================================================
   ROUTE
   ============================================================================ */

export async function POST(req: Request) {
  try {
    if (!CASINO_WALLET || !TREASURY_WALLET || !USDC_MINT) {
      console.error(
        "[buy/build] Missing CASINO_WALLET / TREASURY_WALLET / USDC_MINT env"
      );
      return NextResponse.json(
        { error: "Server misconfigured for USDC transfers" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);

    const walletAddress = body?.walletAddress as string | undefined;
    const amount = body?.amount as number | undefined; // chips requested

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

    // Hard cap so someone can’t “accidentally” try to move insane amounts
    if (amount > 1_000_000) {
      return NextResponse.json({ error: "Amount too large" }, { status: 400 });
    }

    const normalizedWallet = walletAddress.trim();
    const chipsRequested = Number(amount);

    const userPubkey = new PublicKey(normalizedWallet);
    const casinoPubkey = new PublicKey(CASINO_WALLET);
    const treasuryPubkey = new PublicKey(TREASURY_WALLET);
    const usdcMintPk = new PublicKey(USDC_MINT);

    /* ----- Canonical fee & debit (must match /buy/complete) ----- */

    const feeUi = roundToCents(chipsRequested * SAFE_FEE_RATE);
    const baseUi = roundToCents(chipsRequested); // non-fee portion
    const totalDebitUi = roundToCents(baseUi + feeUi);

    if (totalDebitUi <= 0) {
      return NextResponse.json(
        { error: "Total debit must be positive" },
        { status: 400 }
      );
    }

    // Convert to on-chain integer (USDC_DECIMALS, usually 6)
    const uiFactor = Math.pow(10, USDC_DECIMALS);

    // Use BigInt without literals so TS target < ES2020 is fine
    const baseAmount = BigInt(Math.round(baseUi * uiFactor));
    const feeAmount = BigInt(Math.round(feeUi * uiFactor));

    if (baseAmount <= BigInt(0)) {
      return NextResponse.json(
        { error: "Base transfer amount must be positive" },
        { status: 400 }
      );
    }

    /* =========================================================================
       BUILD TRANSACTION:
       - 1) Create ATAs for casino / treasury if they don't exist
       - 2) Transfer base → casino
       - 3) Transfer fee → treasury (if > 0)
       ========================================================================= */

    // Derive ATAs
    const userAta = await getAssociatedTokenAddress(usdcMintPk, userPubkey);
    const casinoAta = await getAssociatedTokenAddress(usdcMintPk, casinoPubkey);
    const treasuryAta = await getAssociatedTokenAddress(
      usdcMintPk,
      treasuryPubkey
    );

    const instructions: TransactionInstruction[] = [];

    // Check if casino / treasury ATAs exist; if not, create them (paid by user)
    const [casinoInfo, treasuryInfo] = await Promise.all([
      connection.getAccountInfo(casinoAta),
      connection.getAccountInfo(treasuryAta),
    ]);

    if (!casinoInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          userPubkey, // payer
          casinoAta,
          casinoPubkey,
          usdcMintPk
        )
      );
    }

    if (!treasuryInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          userPubkey, // payer
          treasuryAta,
          treasuryPubkey,
          usdcMintPk
        )
      );
    }

    // 1) Base transfer: user -> casino
    const ixBase = createTransferInstruction(
      userAta,
      casinoAta,
      userPubkey,
      baseAmount,
      [],
      TOKEN_PROGRAM_ID
    );
    instructions.push(ixBase);

    // 2) Fee transfer: user -> treasury (if > 0)
    if (feeAmount > BigInt(0)) {
      const ixFee = createTransferInstruction(
        userAta,
        treasuryAta,
        userPubkey,
        feeAmount,
        [],
        TOKEN_PROGRAM_ID
      );
      instructions.push(ixFee);
    }

    // Fresh blockhash for fast confirmation
    const latestBlockhash = await connection.getLatestBlockhash("finalized");

    const message = new TransactionMessage({
      payerKey: userPubkey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);

    // DO NOT SIGN HERE — user signs client-side via wallet-adapter
    const serializedTx = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json(
      {
        serializedTx,
        chipsRequested,
        fee: feeUi,
        base: baseUi,
        totalDebit: totalDebitUi,
        usdcDecimals: USDC_DECIMALS,
        casinoWallet: CASINO_WALLET,
        treasuryWallet: TREASURY_WALLET,
        usdcMint: USDC_MINT,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/buy/build error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

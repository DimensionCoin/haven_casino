// app/api/admin/deposit/build/route.ts
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

const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  clusterApiUrl(NETWORK);

const connection = new Connection(RPC, "confirmed");

const CASINO_WALLET = process.env.NEXT_PUBLIC_CASINO_WALLET || "";
const USDC_MINT =
  process.env.CASINO_USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "";

const USDC_DECIMALS = Number(process.env.CASINO_USDC_DECIMALS ?? "6") || 6;

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: Request) {
  try {
    if (!CASINO_WALLET || !USDC_MINT) {
      console.error(
        "[admin/deposit/build] Missing CASINO_WALLET / USDC_MINT env"
      );
      return NextResponse.json(
        { error: "Server misconfigured for USDC transfers" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    const walletAddress = body?.walletAddress as string | undefined;
    const amount = body?.amount as number | undefined; // USDC (chips) to send

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
    const depositUi = roundToCents(amount);

    const adminPk = new PublicKey(normalizedWallet);
    const casinoPk = new PublicKey(CASINO_WALLET);
    const usdcMintPk = new PublicKey(USDC_MINT);

    const uiFactor = Math.pow(10, USDC_DECIMALS);
    const depositAmount = BigInt(Math.round(depositUi * uiFactor));
    if (depositAmount <= BigInt(0)) {
      return NextResponse.json(
        { error: "Deposit amount must be positive" },
        { status: 400 }
      );
    }

    // ATAs
    const adminAta = await getAssociatedTokenAddress(usdcMintPk, adminPk);
    const casinoAta = await getAssociatedTokenAddress(usdcMintPk, casinoPk);

    const instructions: TransactionInstruction[] = [];

    // Ensure casino ATA exists
    const casinoInfo = await connection.getAccountInfo(casinoAta);
    if (!casinoInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          adminPk, // payer
          casinoAta,
          casinoPk,
          usdcMintPk
        )
      );
    }

    // Admin -> Casino transfer (no fee)
    const ix = createTransferInstruction(
      adminAta,
      casinoAta,
      adminPk,
      depositAmount,
      [],
      TOKEN_PROGRAM_ID
    );
    instructions.push(ix);

    const latestBlockhash = await connection.getLatestBlockhash("finalized");

    const message = new TransactionMessage({
      payerKey: adminPk,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const serializedTx = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json(
      {
        serializedTx,
        amountUi: depositUi,
        usdcDecimals: USDC_DECIMALS,
        casinoWallet: CASINO_WALLET,
        usdcMint: USDC_MINT,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/admin/deposit/build error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

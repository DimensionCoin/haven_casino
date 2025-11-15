// app/api/admin/casino/overview/route.ts
import { NextResponse } from "next/server";
import {
  Cluster,
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

import { connectDb } from "@/lib/db";
import Treasury from "@/models/Treasury";
import ChipVault from "@/models/ChipVault";
import { getOnChainCasinoUsdcBalance } from "@/lib/onchain"; // 👈 aggregated backing helper

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

const CASINO_WALLET = process.env.NEXT_PUBLIC_CASINO_WALLET || "";
const TREASURY_WALLET = process.env.NEXT_PUBLIC_CASINO_TREASURY_WALLET || "";

const USDC_MINT =
  process.env.CASINO_USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "";

/* ============================================================================
   Helpers
   ============================================================================ */

async function getSolBalance(address: string): Promise<number> {
  if (!address) return 0;
  const pubkey = new PublicKey(address);
  const lamports = await connection.getBalance(pubkey, "confirmed");
  return lamports / LAMPORTS_PER_SOL;
}

async function getUsdcBalance(ownerAddress: string): Promise<number> {
  if (!ownerAddress || !USDC_MINT) return 0;

  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(USDC_MINT);

  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    // ATA doesn't exist yet → treat as 0
    return 0;
  }
}

/* ============================================================================
   GET /api/admin/casino/overview
   ============================================================================ */

export async function GET() {
  try {
    if (!CASINO_WALLET || !TREASURY_WALLET || !USDC_MINT) {
      console.error(
        "[admin/casino/overview] Missing env NEXT_PUBLIC_CASINO_WALLET / NEXT_PUBLIC_CASINO_TREASURY_WALLET / USDC_MINT"
      );
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    await connectDb();

    const [
      casinoSol,
      casinoUsdcOnChain,
      treasurySol,
      treasuryUsdcOnChain,
      // 👇 this should sum everything that backs chips (casino wallet + any vault wallets)
      backingUsdcRaw,
      vaultDoc,
      casinoTreasuryDoc,
      mainTreasuryDoc,
    ] = await Promise.all([
      getSolBalance(CASINO_WALLET),
      getUsdcBalance(CASINO_WALLET),
      getSolBalance(TREASURY_WALLET),
      getUsdcBalance(TREASURY_WALLET),
      getOnChainCasinoUsdcBalance().catch(() => null),
      // Always grab the latest vault snapshot (in case multiple docs exist)
      ChipVault.findOne({ token: "USDC" }).sort({ updatedAt: -1 }).lean(),
      Treasury.findOne({ walletAddress: CASINO_WALLET }).lean(),
      Treasury.findOne({ walletAddress: TREASURY_WALLET }).lean(),
    ]);

    // ---------------- Vault data (ChipVault) ----------------
    const chipsInCirculation = vaultDoc?.chipsInCirculation ?? 0; // users + house
    const casinoVirtualBalance = vaultDoc?.casinoVirtualBalance ?? 0; // house float in chips
    const lastUsdcBalance =
      typeof vaultDoc?.lastUsdcBalance === "number"
        ? vaultDoc.lastUsdcBalance
        : null;

    // Effective backing = what we actually count as solvency capital
    // Prefer the aggregated helper; fall back to casino+treasury; finally last snapshot
    const backingUsdcCurrent =
      typeof backingUsdcRaw === "number" && !Number.isNaN(backingUsdcRaw)
        ? backingUsdcRaw
        : casinoUsdcOnChain + treasuryUsdcOnChain || lastUsdcBalance || 0;

    // Core solvency check: can we pay all chips back 1:1 right now?
    const solvencyGap = backingUsdcCurrent - chipsInCirculation; // USDC - chips
    const solvencyOk = solvencyGap >= -1e-6; // small negative tolerance for float drift

    // Optional ratio if you want to show e.g. 1.03x overcollateralized
    const solvencyRatio =
      chipsInCirculation > 0 ? backingUsdcCurrent / chipsInCirculation : null;

    // ---------------- Treasury data (virtual balances) ----------------
    const treasuryVirtual = mainTreasuryDoc?.virtualBalance ?? 0;
    const treasuryFees = mainTreasuryDoc?.totalFeesCollected ?? 0;

    // If you track a Treasury row for CASINO_WALLET separately:
    const casinoVirtualFromTreasury = casinoTreasuryDoc?.virtualBalance ?? 0;

    return NextResponse.json(
      {
        // House / casino wallet (on-chain + house virtual chips)
        casino: {
          wallet: CASINO_WALLET,
          solBalance: casinoSol,
          usdcOnChain: casinoUsdcOnChain,
          // chips held by the house that can be used for payouts
          virtualChips: casinoVirtualBalance,
          // optional: if you also store credits for CASINO_WALLET in Treasury
          virtualCreditsFromTreasury: casinoVirtualFromTreasury,
        },

        // Global vault info (ChipVault) – this is what your solvency UI should key off
        vault: {
          token: vaultDoc?.token ?? "USDC",
          casinoWallet: vaultDoc?.casinoWallet ?? CASINO_WALLET,

          // 🔥 circulating supply of chips in the system (users + house)
          chipsInCirculation,

          // 🔥 house float in chips
          casinoVirtualBalance,

          // Historical snapshot of backing when you last reconciled
          lastUsdcBalance,

          // 🔥 live on-chain backing you're actually counting for solvency
          backingUsdcCurrent,

          // Core solvency metrics
          solvencyGap, // USDC - chips (negative = deficit)
          solvencyOk,
          solvencyRatio, // e.g. 1.02 → 102% backed, null if no chips
        },

        // External treasury / fee collector
        treasury: {
          wallet: TREASURY_WALLET,
          solBalance: treasurySol,
          usdcOnChain: treasuryUsdcOnChain,
          virtualBalance: treasuryVirtual,
          totalFeesCollected: treasuryFees,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/admin/casino/overview error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

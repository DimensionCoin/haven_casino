"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { isAdminWallet } from "@/lib/admin";
import { HOUSE_POOL_PCT, ROULETTE_POOL_PCT } from "@/lib/casinoConfig";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

// Ensure Buffer exists in browser (Next 15 / Turbopack sometimes needs this)
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

/* ======================= Types ======================= */

type AdminOverview = {
  casino: {
    wallet: string;
    solBalance?: number;
    usdcOnChain?: number;
    virtualChips?: number; // house-held chips (from Treasury CASINO_WALLET)
  };
  vault?: {
    token?: string;
    chipsInCirculation?: number;
    lastUsdcBalance?: number | null;
    casinoVirtualBalance?: number | null;
    solvencyOk?: boolean;
    solvencyGap?: number; // on-chain USDC - chipsInCirculation
  };
  treasury: {
    wallet: string;
    solBalance?: number;
    usdcOnChain?: number;
    virtualBalance?: number;
    totalFeesCollected?: number;
  };
};

type OverviewResponse = AdminOverview | { error?: string };

export default function AdminPage() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();

  const isAdmin = useMemo(
    () => (publicKey ? isAdminWallet(publicKey.toBase58()) : false),
    [publicKey]
  );

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // deposit state
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState<string | null>(null);

  /* ======================= Gate by wallet ======================= */

  useEffect(() => {
    if (!connected) return;
    if (!isAdmin) {
      router.replace("/dashboard");
    }
  }, [connected, isAdmin, router]);

  /* ======================= Fetch overview ======================= */

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/admin/casino/overview");
      const json = (await res
        .json()
        .catch(() => null)) as OverviewResponse | null;

      if (!res.ok || !json) {
        const message =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : "Failed to fetch overview from server";
        throw new Error(message);
      }

      // If server returned an error shape but res.ok was true (weird, but safe-guard)
      if ("error" in json && json.error) {
        throw new Error(json.error);
      }

      setData(json as AdminOverview);
    } catch (err: unknown) {
      console.error("Failed to load admin overview:", err);
      setError(
        err instanceof Error ? err.message : "Unknown error loading stats"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch overview once admin is confirmed
  useEffect(() => {
    if (!connected || !isAdmin) return;
    void fetchOverview();
  }, [connected, isAdmin, fetchOverview]);

  if (!connected || !isAdmin) {
    // While gating / redirecting, render nothing
    return null;
  }

  /* ======================= Safe derived values ======================= */

  const casinoWallet = data?.casino?.wallet ?? "";
  const treasuryWallet = data?.treasury?.wallet ?? "";

  const casinoSol = data?.casino?.solBalance ?? 0;
  const casinoUsdcOnChain = data?.casino?.usdcOnChain ?? 0;
  const casinoVirtualChips = data?.casino?.virtualChips ?? 0;

  const treasurySol = data?.treasury?.solBalance ?? 0;
  const treasuryUsdcOnChain = data?.treasury?.usdcOnChain ?? 0;
  const treasuryVirtual = data?.treasury?.virtualBalance ?? 0;
  const treasuryFees = data?.treasury?.totalFeesCollected ?? 0;

  const vaultChipsInCirculation = data?.vault?.chipsInCirculation ?? 0;
  const vaultLastUsdc = data?.vault?.lastUsdcBalance ?? null;
  const vaultSolvencyOk =
    typeof data?.vault?.solvencyOk === "boolean"
      ? data?.vault?.solvencyOk
      : true;
  const vaultSolvencyGap = data?.vault?.solvencyGap ?? 0;

  // For pool math, we care about the house's virtual chips, not user chips
  const baseForPools = casinoVirtualChips;

  const houseReserveUsdc = baseForPools * HOUSE_POOL_PCT;
  const roulettePoolUsdc = baseForPools * ROULETTE_POOL_PCT;
  const otherGamesUsdc = Math.max(
    baseForPools - houseReserveUsdc - roulettePoolUsdc,
    0
  );

  const gamesPoolUsdc = Math.max(roulettePoolUsdc + otherGamesUsdc, 0);

  /* ======================= Admin deposit handler ======================= */

  const handleAdminDeposit = async () => {
    setDepositError(null);
    setDepositSuccess(null);

    if (!publicKey) {
      setDepositError("Wallet not connected.");
      return;
    }
    if (!connection) {
      setDepositError("No Solana connection available.");
      return;
    }
    if (!depositAmount || depositAmount <= 0) {
      setDepositError("Enter a positive deposit amount.");
      return;
    }

    try {
      setDepositLoading(true);

      // 1) Build tx on server
      const buildRes = await fetch("/api/admin/casino/deposit/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          amount: depositAmount,
        }),
      });

      const buildJson = (await buildRes.json().catch(() => null)) as {
        serializedTx?: string;
        error?: string;
      } | null;

      if (!buildRes.ok || !buildJson?.serializedTx) {
        throw new Error(
          buildJson?.error || "Failed to build admin deposit transaction"
        );
      }

      const serializedTx = buildJson.serializedTx;
      const txBuffer = Buffer.from(serializedTx, "base64");
      const tx = VersionedTransaction.deserialize(txBuffer);

      // 2) Send via wallet
      const sig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Optional: wait for confirmation
      await connection.confirmTransaction(sig, "confirmed");

      // 3) Complete on server (mint house chips)
      const completeRes = await fetch("/api/admin/casino/deposit/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          amount: depositAmount,
          txSignature: sig,
        }),
      });

      const completeJson = (await completeRes.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!completeRes.ok || !completeJson?.ok) {
        throw new Error(
          completeJson?.error || "Failed to mint chips for casino"
        );
      }

      setDepositSuccess(
        `Deposited ${depositAmount.toFixed(
          2
        )} USDC and minted house chips. Tx: ${sig}`
      );
      setDepositAmount(0);

      // Refresh admin overview to show new balances
      void fetchOverview();
    } catch (err: unknown) {
      console.error("[Admin] deposit error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to complete admin deposit";
      setDepositError(message);
    } finally {
      setDepositLoading(false);
    }
  };

  /* ======================= Render ======================= */

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">
            Overview of on-chain balances, house chips, and casino solvency.
          </p>
        </header>

        {loading && (
          <p className="text-sm text-muted-foreground">Loading stats…</p>
        )}

        {error && <p className="text-sm text-destructive">Error: {error}</p>}

        {data && (
          <div className="space-y-6">
            {/* Wallet balances */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Casino Wallet</CardTitle>
                  <p className="text-xs text-muted-foreground break-all">
                    {casinoWallet || "—"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SOL balance</span>
                    <span>{casinoSol.toFixed(4)} SOL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">USDC on-chain</span>
                    <span>{casinoUsdcOnChain.toFixed(4)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      House virtual chips
                    </span>
                    <span>{casinoVirtualChips.toFixed(2)} chips</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Treasury Wallet</CardTitle>
                  <p className="text-xs text-muted-foreground break-all">
                    {treasuryWallet || "—"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SOL balance</span>
                    <span>{treasurySol.toFixed(4)} SOL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">USDC on-chain</span>
                    <span>{treasuryUsdcOnChain.toFixed(4)} USDC</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Treasury virtual balance
                    </span>
                    <span>{treasuryVirtual.toFixed(2)} chips</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Total fees collected
                    </span>
                    <span>{treasuryFees.toFixed(2)} USDC</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Vault / solvency panel */}
            <Card>
              <CardHeader>
                <CardTitle>Chip Vault & Solvency</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Global minted chips vs real USDC backing in the casino vault.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Chips in circulation (users + house)
                  </span>
                  <span>{vaultChipsInCirculation.toFixed(2)} chips</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Last recorded USDC backing
                  </span>
                  <span>
                    {vaultLastUsdc !== null
                      ? `${vaultLastUsdc.toFixed(4)} USDC`
                      : "—"}
                  </span>
                </div>

                <Separator className="my-2" />

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Current on-chain USDC
                  </span>
                  <span>{casinoUsdcOnChain.toFixed(4)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Solvency gap (USDC - chips)
                  </span>
                  <span
                    className={
                      vaultSolvencyOk
                        ? "text-emerald-400 font-semibold"
                        : "text-destructive font-semibold"
                    }
                  >
                    {vaultSolvencyGap.toFixed(4)}{" "}
                    {vaultSolvencyOk ? "(OK)" : "(DEFICIT)"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Pool breakdown based on house virtual chips */}
            <Card>
              <CardHeader>
                <CardTitle>Casino Pool Allocation</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Split of house-held chips based on config percentages.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    House reserve ({(HOUSE_POOL_PCT * 100).toFixed(0)}%)
                  </span>
                  <span>{houseReserveUsdc.toFixed(4)} chips</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Roulette pool ({(ROULETTE_POOL_PCT * 100).toFixed(0)}%)
                  </span>
                  <span>{roulettePoolUsdc.toFixed(4)} chips</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Other games pool
                  </span>
                  <span>{otherGamesUsdc.toFixed(4)} chips</span>
                </div>

                <Separator className="my-2" />

                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Total games pool (all games)
                  </span>
                  <span>{gamesPoolUsdc.toFixed(4)} chips</span>
                </div>

                <div className="flex justify-between border-t border-border/40 pt-2 mt-2">
                  <span className="text-muted-foreground">
                    Total house virtual chips
                  </span>
                  <span>{casinoVirtualChips.toFixed(4)} chips</span>
                </div>
              </CardContent>
            </Card>

            {/* Casino Buffer Deposit */}
            <Card>
              <CardHeader>
                <CardTitle>Casino Buffer Deposit</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Send USDC from your admin wallet into the casino vault and
                  mint house-held chips for game payouts. No fee is charged.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={depositAmount || ""}
                    onChange={(e) =>
                      setDepositAmount(parseFloat(e.target.value) || 0)
                    }
                    className="w-40 px-3 py-2 rounded-md border border-border bg-background text-sm"
                    placeholder="Amount (USDC)"
                    disabled={depositLoading}
                  />
                  <button
                    onClick={handleAdminDeposit}
                    disabled={depositLoading || !depositAmount}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                  >
                    {depositLoading
                      ? "Depositing..."
                      : "Send USDC & Mint Chips"}
                  </button>
                </div>

                {depositError && (
                  <p className="text-xs text-destructive mt-1">
                    {depositError}
                  </p>
                )}
                {depositSuccess && (
                  <p className="text-xs text-emerald-400 mt-1">
                    {depositSuccess}
                  </p>
                )}

                <p className="text-[11px] text-muted-foreground mt-2">
                  Flow: Your wallet sends USDC to the casino vault. Once the
                  transaction is confirmed, the backend mints the same amount of
                  chips into the{" "}
                  <span className="font-semibold">house virtual balance</span>{" "}
                  and bumps the global
                  <span className="font-semibold"> chipsInCirculation</span>.
                  There is <span className="font-semibold">no fee</span> on this
                  operation.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

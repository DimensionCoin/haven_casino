// app/(private)/buy/page.tsx
"use client";

import React, { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUser } from "@/providers/UserProvider";
import { toast } from "react-hot-toast";
import { FEE_RATE, FEE_LABEL } from "@/lib/fee";
import { Buffer } from "buffer";

// Ensure Buffer exists in browser (Next.js / webpack quirk)
if (typeof window !== "undefined" && !window.Buffer) {
  window.Buffer = Buffer;
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

type TabId = "buy" | "redeem";

export default function BuyPage() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();

  const { virtualBalance, usdcBalance, refreshAll } = useUser();

  const [activeTab, setActiveTab] = useState<TabId>("buy");

  const [buyAmount, setBuyAmount] = useState<string>(""); // chips to buy
  const [redeemAmount, setRedeemAmount] = useState<string>(""); // chips to redeem

  const [buyLoading, setBuyLoading] = useState(false);
  const [redeemLoading, setRedeemLoading] = useState(false);

  const buyChips = Number(buyAmount) || 0;
  const redeemChips = Number(redeemAmount) || 0;

  // Env-driven fee for *buying* (display only — server is source of truth)
  const buyFee = buyChips > 0 ? roundToCents(buyChips * FEE_RATE) : 0;
  const buyTotalToPay = buyChips > 0 ? roundToCents(buyChips + buyFee) : 0;

  const walletAddress = publicKey?.toBase58();

  /* =========================================================================
     BUY HANDLER
     ========================================================================= */

  const handleBuy = async () => {
    if (!connected || !publicKey) {
      toast.error("Connect your wallet first.");
      return;
    }

    if (!signTransaction) {
      toast.error("Your wallet cannot sign transactions.");
      return;
    }

    if (!buyChips || buyChips <= 0) {
      toast.error("Enter how many chips you want.");
      return;
    }

    try {
      setBuyLoading(true);

      // 1) Ask server to build a USDC transfer for the correct amount
      const buildRes = await fetch("/api/buy/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          amount: buyChips, // CHIPS we want → server computes fee & totalDebit
        }),
      });

      const buildData = await buildRes.json();

      if (!buildRes.ok) {
        console.error("[buy/build error]", buildData);
        toast.error(buildData?.error || "Failed to build transaction.");
        return;
      }

      const { serializedTx, totalDebit } = buildData as {
        serializedTx: string;
        totalDebit: number;
      };

      if (!serializedTx) {
        toast.error("No transaction returned from server.");
        return;
      }

      // 2) Decode, sign and send transaction via wallet adapter
      let txSignature: string;
      try {
        const txBuffer = Buffer.from(serializedTx, "base64");
        const tx = VersionedTransaction.deserialize(txBuffer);

        const signedTx = await signTransaction(tx);

        txSignature = await connection.sendTransaction(signedTx, {
          skipPreflight: false,
        });

        await connection.confirmTransaction(txSignature, "confirmed");
      } catch (signErr) {
        console.error("[buy] signing/sending error:", signErr);
        toast.error("Transaction failed or was rejected.");
        return;
      }

      // 3) Tell backend to verify + credit chips
      const completeRes = await fetch("/api/buy/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          amount: buyChips, // CHIPS, not totalDebit
          txSignature,
        }),
      });

      const completeData = await completeRes.json();

      if (!completeRes.ok) {
        console.error("[buy/complete error]", completeData);
        toast.error(completeData?.error || "Failed to complete purchase.");
        return;
      }

      // 🔁 Refresh SOL, USDC and chips
      await refreshAll();

      const credited = completeData.credited ?? buyChips;
      const feePaid =
        typeof completeData.fee === "number"
          ? completeData.fee
          : totalDebit - credited;
      const totalDebited =
        typeof completeData.totalDebit === "number"
          ? completeData.totalDebit
          : totalDebit;

      toast.success(
        `You got ${credited.toFixed(2)} chips. Fee: ${feePaid.toFixed(
          4
        )} USDC (paid ${totalDebited.toFixed(4)} USDC).`
      );
      setBuyAmount("");
    } catch (err) {
      console.error("Buy error:", err);
      toast.error("Something went wrong. Try again.");
    } finally {
      setBuyLoading(false);
    }
  };

  /* =========================================================================
     REDEEM HANDLER (chips → USDC)
     ========================================================================= */

  const handleRedeem = async () => {
    if (!connected || !walletAddress) {
      toast.error("Connect your wallet first.");
      return;
    }

    if (!redeemChips || redeemChips <= 0) {
      toast.error("Enter how many chips you want to redeem.");
      return;
    }

    const currentChips = virtualBalance ?? 0;

    if (redeemChips > currentChips) {
      toast.error("You don’t have that many chips.");
      return;
    }

    try {
      setRedeemLoading(true);

      const res = await fetch("/api/sell/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          amount: redeemChips, // chips to redeem → 1:1 USDC on server
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("[sell/complete error]", data);
        toast.error(data?.error || "Failed to redeem chips.");
        return;
      }

      await refreshAll();

      const debited = data.debitedChips ?? redeemChips;
      const usdcSent = data.usdcSent ?? redeemChips;

      toast.success(
        `Redeemed ${debited.toFixed(2)} chips for ${usdcSent.toFixed(2)} USDC.`
      );
      setRedeemAmount("");
    } catch (err) {
      console.error("Redeem error:", err);
      toast.error("Something went wrong. Try again.");
    } finally {
      setRedeemLoading(false);
    }
  };

  const displayVirtual = (virtualBalance ?? 0).toFixed(2);
  const displayUsdc =
    typeof usdcBalance === "number" ? usdcBalance.toFixed(4) : "--";

  const disableBuy = buyLoading || !connected || buyChips <= 0;
  const disableRedeem =
    redeemLoading ||
    !connected ||
    redeemChips <= 0 ||
    redeemChips > (virtualBalance ?? 0);

  const redeemAll = () => {
    if (!virtualBalance || virtualBalance <= 0) return;
    setRedeemAmount(virtualBalance.toString());
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
            Casino Cashier
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xl">
            Buy chips with USDC to play any game in Celler, or cash your chips
            back out to your wallet.
          </p>
        </header>

        {/* Balances + Tabs card */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-md p-6 sm:p-8 space-y-6 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
          {/* Top: balances */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Your balances
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    Casino chips
                  </p>
                  <p className="text-xl font-semibold flex items-baseline gap-1">
                    {displayVirtual}
                    <span className="text-xs text-amber-300">chips</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    USDC wallet
                  </p>
                  <p className="text-xl font-semibold flex items-baseline gap-1">
                    {displayUsdc}
                    <span className="text-xs text-muted-foreground">USDC</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="inline-flex rounded-full bg-muted p-1 text-xs">
              <button
                className={`px-3 py-1 rounded-full font-medium transition ${
                  activeTab === "buy"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("buy")}
              >
                Buy Chips
              </button>
              <button
                className={`px-3 py-1 rounded-full font-medium transition ${
                  activeTab === "redeem"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("redeem")}
              >
                Redeem Chips
              </button>
            </div>
          </div>

          {/* ACTIVE PANEL */}
          {activeTab === "buy" ? (
            <>
              {/* Amount input */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Chips you want to buy
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={buyAmount}
                    onChange={(e) => setBuyAmount(e.target.value)}
                    placeholder="10.00"
                    className="flex-1"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This is how many chips you&apos;ll receive. We&apos;ll charge{" "}
                  {FEE_LABEL} extra on top from your USDC balance.
                </p>
              </div>

              {/* Breakdown */}
              <div className="rounded-xl bg-muted/40 border border-border/60 p-4 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Fee ({FEE_LABEL})
                  </span>
                  <span className="text-foreground">
                    {buyFee > 0 ? `${buyFee.toFixed(4)} USDC` : "--"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">You’ll pay</span>
                  <span className="text-foreground">
                    {buyTotalToPay > 0
                      ? `${buyTotalToPay.toFixed(4)} USDC`
                      : "--"}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border/40 pt-2 mt-1">
                  <span className="text-muted-foreground">You’ll receive</span>
                  <span className="text-amber-300 font-semibold">
                    {buyChips > 0 ? `${buyChips.toFixed(4)} chips` : "--"}
                  </span>
                </div>
              </div>

              {/* CTA */}
              <Button
                className="w-full mt-2"
                onClick={handleBuy}
                disabled={disableBuy}
              >
                {buyLoading
                  ? "Processing..."
                  : connected
                  ? "Confirm & Pay"
                  : "Connect wallet to buy"}
              </Button>

              <p className="text-[11px] text-muted-foreground">
                All top-ups are final. Chips are{" "}
                <span className="font-medium text-amber-300">
                  virtual credits inside the Celler casino
                </span>
                . Make sure you&apos;re comfortable with the amount before
                confirming.
              </p>
            </>
          ) : (
            <>
              {/* Redeem input */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Chips you want to redeem
                  </label>
                  <button
                    type="button"
                    onClick={redeemAll}
                    className="text-[11px] text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
                  >
                    Redeem max ({displayVirtual})
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={redeemAmount}
                    onChange={(e) => setRedeemAmount(e.target.value)}
                    placeholder="10.00"
                    className="flex-1"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Redeemed chips are burned from your casino balance, and the
                  equivalent amount of USDC is sent back to your connected
                  wallet.
                </p>
              </div>

              {/* Redeem breakdown */}
              <div className="rounded-xl bg-muted/40 border border-border/60 p-4 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">You’ll receive</span>
                  <span className="text-emerald-300 font-semibold">
                    {redeemChips > 0 ? `${redeemChips.toFixed(4)} USDC` : "--"}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border/40 pt-2 mt-1">
                  <span className="text-muted-foreground">
                    Chips after redeem
                  </span>
                  <span className="text-foreground">
                    {redeemChips > 0
                      ? Math.max(
                          (virtualBalance ?? 0) - redeemChips,
                          0
                        ).toFixed(4)
                      : displayVirtual}
                  </span>
                </div>
              </div>

              {/* CTA */}
              <Button
                className="w-full mt-2"
                onClick={handleRedeem}
                disabled={disableRedeem}
              >
                {redeemLoading
                  ? "Processing..."
                  : connected
                  ? "Redeem chips for USDC"
                  : "Connect wallet to redeem"}
              </Button>

              <p className="text-[11px] text-muted-foreground">
                Redemptions are{" "}
                <span className="font-medium text-emerald-300">1:1</span> — one
                chip equals one USDC. Make sure the connected wallet is where
                you want to receive your funds.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

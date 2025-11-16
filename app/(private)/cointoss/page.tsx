// app/(private)/cointoss/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "react-hot-toast";
import {
  CoinToss3DScene,
  type CoinSide,
} from "@/components/cointoss/CoinToss3DScene";
import { useUser } from "@/providers/UserProvider";

type CoinTossApiResponse = {
  success?: boolean;
  error?: string;
  walletAddress: string;
  betAmount: number;
  rakeRate: number;
  feeForTreasury: number;
  effectiveStake: number;
  userChoice: CoinSide;
  coinResult: CoinSide;
  isWin: boolean;
  rawPayout: number;
  payoutAfterCap: number;
  maxWinCap: number;
  cappedByPool: boolean;
  userVirtualBalance: number;
};

type HistoryEntry = {
  id: string;
  time: string;
  bet: number;
  profit: number;
  choice: CoinSide;
  result: CoinSide;
  win: boolean;
  createdAt: number;
};

const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX = 20;

const historyKeyForWallet = (wallet: string) =>
  `celler:cointoss:history:${wallet}`;

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatChips(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return "0.00";
  return n.toFixed(2);
}

const CoinTossPage: React.FC = () => {
  const { user, virtualBalance, refreshVirtualBalance } = useUser();
  const walletAddress: string | undefined = user?.walletAddress;

  // 🔒 Fixed bet size: 1 chip per toss
  const FIXED_BET = 1;

  const [choice, setChoice] = useState<CoinSide>("heads");
  const [isTossing, setIsTossing] = useState(false);
  const [lastResult, setLastResult] = useState<CoinTossApiResponse | null>(
    null
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  /* ===================== derived balance ===================== */

  const effectiveBalance = useMemo(() => {
    const vb =
      typeof virtualBalance === "number"
        ? virtualBalance
        : user?.virtualBalance ?? 0;
    return roundToCents(vb);
  }, [virtualBalance, user?.virtualBalance]);

  /* ===================== history from localStorage ===================== */

  useEffect(() => {
    if (!walletAddress) return;
    try {
      const key = historyKeyForWallet(walletAddress);
      const raw = localStorage.getItem(key);
      if (!raw) return;

      const parsed = JSON.parse(raw) as HistoryEntry[];
      const now = Date.now();
      const filtered = parsed.filter(
        (entry) => now - entry.createdAt < HISTORY_TTL_MS
      );

      setHistory(filtered);
    } catch (err) {
      console.error("[cointoss] error loading history from localStorage", err);
    }
  }, [walletAddress]);

  /* ===================== toss handler ===================== */

  async function handleToss() {
    if (!walletAddress) {
      toast.error("Connect wallet before playing.");
      return;
    }

    const betAmount = FIXED_BET;

    if (betAmount <= 0) {
      toast.error("Bet must be greater than zero.");
      return;
    }

    if (betAmount > effectiveBalance + 1e-6) {
      toast.error("You don't have enough chips to flip.");
      return;
    }

    const spinStart = Date.now();
    const MIN_TOSS_DURATION_MS = 1200;

    setIsTossing(true);
    setLoading(true);
    setLastResult(null);

    let resolvedResult: CoinTossApiResponse | null = null;

    try {
      const res = await fetch("/api/cointoss/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          betAmount, // always 1 chip
          choice,
        }),
      });

      const data: CoinTossApiResponse = await res.json();

      if (!res.ok || !data.success) {
        const errMsg = data.error || "Coin toss failed.";
        toast.error(errMsg);
        setIsTossing(false);
        setLoading(false);
        return;
      }

      resolvedResult = data;
      await refreshVirtualBalance().catch(() => {});
    } catch (err) {
      console.error("[cointoss] handleToss error", err);
      toast.error("Something went wrong while flipping.");
      setIsTossing(false);
      setLoading(false);
      return;
    } finally {
      if (!resolvedResult) return;

      const elapsed = Date.now() - spinStart;
      const remaining = Math.max(0, MIN_TOSS_DURATION_MS - elapsed);

      setTimeout(() => {
        setIsTossing(false);
        setLoading(false);
        setLastResult(resolvedResult as CoinTossApiResponse);

        const data = resolvedResult as CoinTossApiResponse;
        const profit = data.payoutAfterCap - data.betAmount;

        const entry: HistoryEntry = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          time: new Date().toLocaleTimeString(),
          bet: data.betAmount,
          profit,
          choice: data.userChoice,
          result: data.coinResult,
          win: data.isWin,
          createdAt: Date.now(),
        };

        setHistory((prev) => {
          const next = [entry, ...prev].slice(0, HISTORY_MAX);
          if (walletAddress) {
            try {
              const key = historyKeyForWallet(walletAddress);
              localStorage.setItem(key, JSON.stringify(next));
            } catch (err) {
              console.error(
                "[cointoss] error saving history to localStorage",
                err
              );
            }
          }
          return next;
        });

        if (data.isWin) {
          toast.success(
            `You won ${formatChips(
              data.payoutAfterCap - data.betAmount
            )} chips!`
          );
        } else {
          toast(`You lost ${formatChips(data.betAmount)} chips.`, {
            icon: "😵",
          });
        }
      }, remaining);
    }
  }

  /* ===================== derived values for visuals ===================== */

  const finalSide: CoinSide | undefined = lastResult?.coinResult;
  const highlightWin = lastResult?.isWin === true;

  const buttonLabel = loading
    ? "FLIPPING..."
    : `FLIP • ${formatChips(FIXED_BET)} chip`;

  const canToss =
    !loading &&
    !isTossing &&
    FIXED_BET > 0 &&
    FIXED_BET <= effectiveBalance + 1e-6;

  const outcomeText = useMemo(() => {
    if (!lastResult) return "Pick heads or tails and flip the coin.";
    const won = lastResult.isWin;
    const profit = lastResult.payoutAfterCap - lastResult.betAmount;
    const absProfit = Math.abs(profit);

    if (won) {
      return `WIN • Coin landed on ${lastResult.coinResult.toUpperCase()} • +${formatChips(
        absProfit
      )} chips`;
    }
    return `LOSS • Coin landed on ${lastResult.coinResult.toUpperCase()} • -${formatChips(
      lastResult.betAmount
    )} chips`;
  }, [lastResult]);

  /* ===================== render ===================== */

  return (
    <div className="min-h-screen text-amber-50 pb-12 bg-zinc-950 relative">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(248,180,0,0.22),_transparent_60%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.22),_transparent_55%)]" />

      <div className="relative">
        {/* Top Nav */}
        <div className="max-w-6xl mx-auto px-4 pt-6 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-zinc-200/80 hover:text-amber-200 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to lobby
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={() => window.location.reload()}
              className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/60 text-[11px] text-amber-200/90 bg-black/40 hover:bg-amber-500/10 transition shadow-[0_0_18px_rgba(0,0,0,0.8)]"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
            <div className="px-3 py-1 rounded-full bg-black/60 border border-amber-500/60 text-amber-200 shadow-[0_0_18px_rgba(0,0,0,0.8)]">
              Balance:{" "}
              <span className="font-semibold">
                {formatChips(effectiveBalance)}
              </span>{" "}
              chips
            </div>
          </div>
        </div>

        {/* Title / Subtitle */}
        <div className="max-w-6xl mx-auto px-4 mt-2 mb-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-4xl font-extrabold text-amber-50 tracking-tight leading-tight drop-shadow-[0_0_18px_rgba(0,0,0,0.8)]">
                Coin Toss
              </h1>

              <p className="text-[11px] text-zinc-300 mt-2">
                Each flip costs{" "}
                <span className="font-semibold text-amber-200">
                  {formatChips(FIXED_BET)} chip
                </span>
                . Win and you get{" "}
                <span className="font-semibold text-emerald-300">2 chips</span>{" "}
                back (your chip + 1 profit). Lose and you lose your chip.
              </p>
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-[1.1fr_1fr] gap-6">
          {/* Left: 3D Coin */}
          <div className="flex flex-col gap-4">
            <div className="h-[360px] md:h-[420px] rounded-2xl overflow-hidden">
              <CoinToss3DScene
                isTossing={isTossing}
                finalSide={finalSide}
                highlightWin={highlightWin}
              />
            </div>

            {/* Outcome banner */}
            <div className="rounded-2xl bg-zinc-950/85 border border-zinc-700/70 px-4 py-3 shadow-[0_0_35px_rgba(0,0,0,0.9)]">
              <p
                className={`text-xs md:text-sm ${
                  lastResult
                    ? lastResult.isWin
                      ? "text-emerald-300"
                      : "text-rose-300"
                    : "text-zinc-200/90"
                }`}
              >
                {outcomeText}
              </p>
              {lastResult && (
                <p className="text-[10px] text-zinc-400 mt-1">
                  Rake: {(lastResult.rakeRate * 100).toFixed(1)}% • Treasury
                  fee: {formatChips(lastResult.feeForTreasury)} chips •
                  Effective stake: {formatChips(lastResult.effectiveStake)}{" "}
                  chips
                </p>
              )}
            </div>
          </div>

          {/* Right: Controls & History */}
          <div className="flex flex-col gap-4">
            {/* Controls card */}
            <div className="rounded-2xl bg-zinc-950/85 border border-zinc-700/70 px-4 py-4 md:px-5 md:py-5 space-y-4 shadow-[0_0_40px_rgba(0,0,0,0.9)]">
              {/* Choice toggle */}
              <div className="flex justify-between items-center gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-300/90 mb-1">
                    Your call
                  </p>
                  <p className="text-xs text-zinc-100/90">
                    Even money: heads or tails. Fixed {formatChips(FIXED_BET)}{" "}
                    chip per flip.
                  </p>
                </div>

                <div className="inline-flex rounded-full bg-black/70 border border-zinc-700/80 p-1 shadow-[0_0_18px_rgba(0,0,0,0.8)]">
                  <button
                    type="button"
                    onClick={() => setChoice("heads")}
                    className={`px-3 py-1 text-[11px] rounded-full ${
                      choice === "heads"
                        ? "bg-amber-400 text-zinc-950"
                        : "text-zinc-200/80 hover:text-amber-200"
                    }`}
                  >
                    Heads
                  </button>
                  <button
                    type="button"
                    onClick={() => setChoice("tails")}
                    className={`px-3 py-1 text-[11px] rounded-full ${
                      choice === "tails"
                        ? "bg-amber-400 text-zinc-950"
                        : "text-zinc-200/80 hover:text-amber-200"
                    }`}
                  >
                    Tails
                  </button>
                </div>
              </div>

              {/* Fixed bet info */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="uppercase tracking-[0.16em] text-zinc-300/90 text-[10px]">
                    Bet size
                  </span>
                  <span className="text-zinc-200 text-[11px]">
                    Balance:{" "}
                    <span className="font-semibold text-amber-200">
                      {formatChips(effectiveBalance)} chips
                    </span>
                  </span>
                </div>
              </div>

              {/* Roll button */}
              <button
                type="button"
                onClick={handleToss}
                disabled={!canToss}
                className="mt-3 w-full inline-flex justify-center items-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-500/40 transition"
              >
                {loading || isTossing ? (
                  <>
                    <span className="w-4 h-4 border-2 border-zinc-900/60 border-t-zinc-900 rounded-full animate-spin" />
                    {buttonLabel}
                  </>
                ) : (
                  <>{buttonLabel}</>
                )}
              </button>
            </div>

            {/* History card */}
            <div className="rounded-2xl bg-zinc-950/85 border border-zinc-700/70 px-4 py-3 md:px-5 md:py-4 shadow-[0_0_35px_rgba(0,0,0,0.9)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-300/90">
                  Recent flips
                </span>
                <span className="text-[11px] text-zinc-400">
                  Last {history.length} rounds
                </span>
              </div>
              {history.length === 0 ? (
                <p className="text-[11px] text-zinc-400">
                  Place your first flip to start your streak.
                </p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="flex flex-col text-xs py-1.5 border-b border-zinc-800/70 last:border-b-0 gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-100">
                          {h.choice.toUpperCase()} → {h.result.toUpperCase()}
                        </span>
                        <span
                          className={`font-semibold ${
                            h.win ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {h.win
                            ? `+${formatChips(h.profit)}`
                            : `-${formatChips(h.bet)}`}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-400">
                        {h.time} • Bet {formatChips(h.bet)} chips
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoinTossPage;

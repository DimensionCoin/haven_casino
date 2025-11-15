// app/(pages)/linebreaker/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import { LineBreaker3DScene } from "@/components/linebreaker/LineBreaker3DScene";
import { useUser } from "@/providers/UserProvider";
import { toast } from "react-hot-toast";

type DiceDirection = "over" | "under";

type DiceApiResponse = {
  success?: boolean;
  error?: string;
  walletAddress?: string;
  betAmount?: number;
  feeForTreasury?: number;
  target?: number;
  direction?: DiceDirection;
  roll?: number;
  winChance?: number;
  houseEdgePct?: number;
  multiplierBeforeCap?: number;
  win?: boolean;
  payoutBeforeCap?: number;
  payoutAfterCap?: number;
  profitBeforeCap?: number;
  profitAfterCap?: number;
  cappedByPool?: boolean;
  maxWinCap?: number;
  userVirtualBalance?: number;
  treasuryVirtualBalance?: number;
  maxBet?: number;
};

type HistoryEntry = {
  id: string;
  time: string;
  bet: number;
  roll: number;
  win: boolean;
  profit: number;
  target: number;
  direction: DiceDirection;
  createdAt: number;
};

type MaxBetInfo = {
  maxBet: number;
  maxWinCap: number;
  winChance: number;
  multiplier: number;
  houseEdgePct: number;
};

const DEFAULT_HOUSE_EDGE = 0.015;

const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX = 15;
const historyKeyForWallet = (wallet: string) =>
  `celler:linebreaker:history:${wallet}`;

function formatPercent(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

function formatChips(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return "0.00";
  return n.toFixed(2);
}

function getWinExplanation(
  roll: number,
  target: number,
  direction: DiceDirection,
  isWin: boolean
) {
  const rollStr = roll.toFixed(2);
  const comparison =
    direction === "over"
      ? isWin
        ? `${rollStr} > ${target}`
        : `${rollStr} ≤ ${target}`
      : isWin
      ? `${rollStr} < ${target}`
      : `${rollStr} ≥ ${target}`;
  return `${isWin ? "WIN! " : "LOSE. "}Roll ${comparison}`;
}

const LineBreakerPage: React.FC = () => {
  const { user, virtualBalance, refreshVirtualBalance } = useUser();
  const walletAddress: string | undefined = user?.walletAddress;

  const [betAmount, setBetAmount] = useState<number>(0);
  const [direction, setDirection] = useState<DiceDirection>("over");
  const [target, setTarget] = useState<number>(50);
  const [isRolling, setIsRolling] = useState(false);
  const [lastResult, setLastResult] = useState<DiceApiResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [maxBetInfo, setMaxBetInfo] = useState<MaxBetInfo | null>(null);
  const [maxBetLoading, setMaxBetLoading] = useState(false);

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
      console.error(
        "[linebreaker] error loading history from localStorage",
        err
      );
    }
  }, [walletAddress]);

  /* ===================== max bet info ===================== */

  useEffect(() => {
    let cancelled = false;

    async function fetchMaxBet() {
      setMaxBetLoading(true);
      try {
        const params = new URLSearchParams({
          target: String(target),
          direction,
        });
        const res = await fetch(
          `/api/linebreaker/max-bet?${params.toString()}`
        );
        const data = await res.json();

        if (!res.ok || !data.success) {
          console.error("[linebreaker] max-bet error:", data.error);
          if (!cancelled) setMaxBetInfo(null);
          return;
        }

        if (cancelled) return;

        const info: MaxBetInfo = {
          maxBet: data.maxBet,
          maxWinCap: data.maxWinCap,
          winChance: data.winChance,
          multiplier: data.multiplier,
          houseEdgePct: data.houseEdgePct ?? DEFAULT_HOUSE_EDGE,
        };

        setMaxBetInfo(info);
      } catch (err) {
        console.error("[linebreaker] fetchMaxBet failed", err);
        if (!cancelled) setMaxBetInfo(null);
      } finally {
        if (!cancelled) setMaxBetLoading(false);
      }
    }

    fetchMaxBet();

    return () => {
      cancelled = true;
    };
  }, [target, direction]);

  /* ===================== caps & chip presets ===================== */

  const rawMaxBet = maxBetInfo?.maxBet ?? 0;
  const balanceCap = (() => {
    if (typeof virtualBalance === "number") return virtualBalance;
    if (typeof user?.virtualBalance === "number") return user.virtualBalance;
    return 0;
  })();

  const effectiveMaxBet = useMemo(() => {
    if (rawMaxBet <= 0 || balanceCap <= 0) return 0;
    return Math.min(rawMaxBet, balanceCap);
  }, [rawMaxBet, balanceCap]);

  const chipOptions = useMemo(() => {
    const max = effectiveMaxBet;
    if (max <= 0) return [];

    const presets = [1, 2, 5, 10, 25, 50, 100];
    const filtered = presets.filter((v) => v <= max + 1e-6);

    if (filtered.length === 0) {
      return [Number(max.toFixed(2))];
    }

    const last = filtered[filtered.length - 1];
    if (max - last > 0.01) {
      filtered.push(Number(max.toFixed(2)));
    }

    return filtered;
  }, [effectiveMaxBet]);

  useEffect(() => {
    if (chipOptions.length === 0) {
      setBetAmount(0);
      return;
    }

    if (!chipOptions.includes(betAmount)) {
      setBetAmount(chipOptions[0]);
    }
  }, [chipOptions, betAmount]);

  /* ===================== odds / max win ===================== */

  const odds = useMemo(() => {
    if (!maxBetInfo) {
      return {
        winChance: 0,
        multiplier: 0,
        houseEdgePct: DEFAULT_HOUSE_EDGE,
      };
    }

    return {
      winChance: maxBetInfo.winChance,
      multiplier: maxBetInfo.multiplier,
      houseEdgePct: maxBetInfo.houseEdgePct,
    };
  }, [maxBetInfo]);

  const maxPotentialWin = useMemo(() => {
    if (!betAmount || betAmount <= 0 || odds.multiplier <= 0) return 0;

    const theoretical = betAmount * odds.multiplier;
    const cap = maxBetInfo?.maxWinCap ?? Infinity;

    return Math.min(theoretical, cap);
  }, [betAmount, odds.multiplier, maxBetInfo?.maxWinCap]);

  /* ===================== roll handler ===================== */

  async function handleRoll() {
    if (!walletAddress) {
      toast.error("Connect wallet before playing.");
      return;
    }

    if (!maxBetInfo || effectiveMaxBet <= 0) {
      toast.error("Pool is unavailable or too small right now.");
      return;
    }

    if (betAmount <= 0) {
      toast.error("Bet must be greater than zero.");
      return;
    }

    if (betAmount > effectiveMaxBet + 1e-6) {
      toast.error(
        `Max bet for this line is ${formatChips(effectiveMaxBet)} chips.`
      );
      return;
    }

    const spinStart = Date.now();
    const MIN_SPIN_DURATION_MS = 1200;

    setIsRolling(true);

    let resolvedResult: DiceApiResponse | null = null;

    try {
      const res = await fetch("/api/linebreaker/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          betAmount,
          direction,
          target,
        }),
      });

      const data: DiceApiResponse = await res.json();

      if (!res.ok || !data.success) {
        const errMsg = data.error || "Failed to spin.";

        if (data.error === "Bet exceeds max allowed for current pool") {
          // specific handling if you want
        } else if (data.error === "Insufficient virtual balance") {
          // specific handling if you want
        } else if (
          data.error ===
            "Pool is unavailable right now. Please try again later." ||
          data.error === "Pool check failed. Please try again."
        ) {
          toast.error("Pool is currently unavailable. Try again soon.");
        } else {
          toast.error(errMsg);
        }

        setIsRolling(false);
        return;
      }

      resolvedResult = data;
      await refreshVirtualBalance().catch(() => {});
    } catch (err) {
      console.error("[linebreaker] handleRoll error", err);
      toast.error("Something went wrong while spinning.");
      setIsRolling(false);
      return;
    } finally {
      if (!resolvedResult) return;

      const elapsed = Date.now() - spinStart;
      const remaining = Math.max(0, MIN_SPIN_DURATION_MS - elapsed);

      setTimeout(() => {
        setIsRolling(false);
        setLastResult(resolvedResult as DiceApiResponse);

        const data = resolvedResult as DiceApiResponse;

        const entry: HistoryEntry = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          time: new Date().toLocaleTimeString(),
          bet: data.betAmount ?? betAmount,
          roll: data.roll ?? 0,
          win: !!data.win,
          profit: data.profitAfterCap ?? 0,
          target: data.target ?? target,
          direction: data.direction ?? direction,
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
                "[linebreaker] error saving history to localStorage",
                err
              );
            }
          }

          return next;
        });

        if (data.win) {
          toast.success(
            `You won ${formatChips(data.profitAfterCap ?? 0)} chips!`
          );
        } else {
          toast(`You lost ${formatChips(data.betAmount ?? betAmount)} chips.`, {
            icon: "😵",
          });
        }
      }, remaining);
    }
  }

  /* ===================== derived values for visuals ===================== */

  // Hide the old roll while a spin is in progress
  const currentRoll = isRolling ? undefined : lastResult?.roll;
  const isWin = lastResult?.win === true;
  const lastProfit = lastResult?.profitAfterCap ?? 0;
  const lastBet = lastResult?.betAmount ?? betAmount;

  const poolUnavailable =
    !maxBetInfo || effectiveMaxBet <= 0 || chipOptions.length === 0;

  /* ===================== render ===================== */

  return (
    <div className="min-h-screen text-amber-50 pb-12 bg-zinc-950 relative">
      {/* ambient glow to match hero */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(248,180,0,0.25),_transparent_60%),radial-gradient(circle_at_top_right,_rgba(220,38,38,0.25),_transparent_55%)]" />

      {/* Content wrapper */}
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
            <div className="px-3 py-1 rounded-full bg-black/60 border border-amber-500/60 text-amber-200 shadow-[0_0_18px_rgba(0,0,0,0.8)]">
              Balance:{" "}
              <span className="font-semibold">
                {formatChips(
                  typeof virtualBalance === "number"
                    ? virtualBalance
                    : user?.virtualBalance
                )}
              </span>{" "}
              chips
            </div>
          </div>
        </div>

        {/* Title / Subtitle */}
        <div className="max-w-6xl mx-auto px-4 mt-2 mb-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-4xl font-extrabold text-amber-50 tracking-tight leading-tight drop-shadow-[0_0_18px_rgba(0,0,0,0.8)]">
                Line Breaker
              </h1>
              <p className="text-xs md:text-sm text-zinc-100/85 mt-2 max-w-md drop-shadow-[0_0_12px_rgba(0,0,0,0.7)]">
                Bet over or under your target line (1-99). The orb spins a
                random number 0.00-99.99. Cross the line to win!
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/60 text-[11px] text-amber-200/90 bg-black/40 hover:bg-amber-500/10 transition shadow-[0_0_18px_rgba(0,0,0,0.8)]"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Main Layout */}
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-[1.1fr_1fr] gap-6">
          {/* Left: Wheel */}
          <div className="flex flex-col gap-4">
            <div className="h-[360px] md:h-[420px] rounded-2xl bg-zinc-950/80 border border-zinc-700/70 shadow-[0_0_45px_rgba(0,0,0,0.9)] overflow-hidden">
              <LineBreaker3DScene
                rolling={isRolling}
                finalRoll={currentRoll}
                target={target}
                direction={direction}
                isWin={isWin}
                profitAmount={lastProfit}
                betAmount={lastBet}
              />
            </div>
          </div>

          {/* Right: Controls & History */}
          <div className="flex flex-col gap-4">
            {/* Controls card */}
            <div className="rounded-2xl bg-zinc-950/85 border border-zinc-700/70 px-4 py-4 md:px-5 md:py-5 space-y-4 shadow-[0_0_40px_rgba(0,0,0,0.9)]">
              {/* Direction toggle */}
              <div className="flex justify-between items-center gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-300/90 mb-1">
                    Bet type
                  </p>
                  <p className="text-xs text-zinc-100/90">
                    {direction === "over"
                      ? "OVER: Win if roll > target (riskier, higher payout)"
                      : "UNDER: Win if roll < target (safer, lower payout)"}
                  </p>
                </div>

                <div className="inline-flex rounded-full bg-black/70 border border-zinc-700/80 p-1 shadow-[0_0_18px_rgba(0,0,0,0.8)]">
                  <button
                    type="button"
                    onClick={() => setDirection("under")}
                    className={`px-3 py-1 text-[11px] rounded-full flex items-center gap-1 ${
                      direction === "under"
                        ? "bg-amber-400 text-zinc-950"
                        : "text-zinc-200/80 hover:text-amber-200"
                    }`}
                  >
                    <ChevronDown className="w-3 h-3" />
                    Under
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection("over")}
                    className={`px-3 py-1 text-[11px] rounded-full flex items-center gap-1 ${
                      direction === "over"
                        ? "bg-amber-400 text-zinc-950"
                        : "text-zinc-200/80 hover:text-amber-200"
                    }`}
                  >
                    <ChevronUp className="w-3 h-3" />
                    Over
                  </button>
                </div>
              </div>

              {/* Target slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="uppercase tracking-[0.16em] text-zinc-300/90 text-[10px]">
                    Target line (1-99)
                  </span>
                  <span className="text-amber-100 font-medium text-sm">
                    {target}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                  className="w-full accent-amber-400"
                />
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>Safer (low target for under)</span>
                  <span>Riskier (high target for over)</span>
                </div>
              </div>

              {/* Bet amount */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="uppercase tracking-[0.16em] text-zinc-300/90 text-[10px]">
                    Bet size
                  </span>
                  <span className="text-zinc-200 text-[11px]">
                    Balance:{" "}
                    <span className="font-semibold text-amber-200">
                      {formatChips(
                        typeof virtualBalance === "number"
                          ? virtualBalance
                          : user?.virtualBalance
                      )}{" "}
                      chips
                    </span>
                  </span>
                </div>

                {poolUnavailable ? (
                  <div className="rounded-xl bg-rose-900/40 border border-rose-500/50 px-3 py-2 text-[11px] text-rose-100/90">
                    Pool too small or unavailable for this line.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {chipOptions.map((chip) => {
                        const selected = betAmount === chip;
                        const disabled =
                          chip > effectiveMaxBet + 1e-6 ||
                          chip > balanceCap + 1e-6 ||
                          isRolling ||
                          maxBetLoading;

                        return (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => !disabled && setBetAmount(chip)}
                            disabled={disabled}
                            className={`px-3 py-1.5 text-[11px] rounded-full border transition ${
                              selected
                                ? "bg-amber-400 text-zinc-950 border-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.45)]"
                                : "bg-black/70 text-zinc-100/90 border-zinc-700/80 hover:bg-zinc-900/80 disabled:opacity-40 disabled:cursor-not-allowed"
                            }`}
                          >
                            {formatChips(chip)} chips
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                      <span>
                        Max bet for this line:{" "}
                        <span className="text-amber-200 font-semibold">
                          {formatChips(effectiveMaxBet)} chips
                        </span>
                      </span>
                      {maxBetLoading && (
                        <span className="italic opacity-70">Updating…</span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Odds summary */}
              <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                <div className="rounded-xl bg-black/70 border border-zinc-700/80 px-3 py-2">
                  <p className="text-[10px] text-zinc-400 mb-0.5">Win chance</p>
                  <p className="text-sm font-semibold text-amber-100">
                    {odds.winChance > 0 ? formatPercent(odds.winChance) : "--"}
                  </p>
                </div>
                <div className="rounded-xl bg-black/70 border border-zinc-700/80 px-3 py-2">
                  <p className="text-[10px] text-zinc-400 mb-0.5">Payout (x)</p>
                  <p className="text-sm font-semibold text-amber-100">
                    {odds.multiplier > 0
                      ? odds.multiplier.toFixed(2) + "x"
                      : "--"}
                  </p>
                </div>
                <div className="rounded-xl bg-black/70 border border-zinc-700/80 px-3 py-2">
                  <p className="text-[10px] text-zinc-400 mb-0.5">
                    Max potential
                  </p>
                  <p className="text-sm font-semibold text-amber-100">
                    {formatChips(maxPotentialWin)} chips
                  </p>
                </div>
              </div>

              {/* Roll button */}
              <button
                type="button"
                onClick={handleRoll}
                disabled={
                  isRolling ||
                  poolUnavailable ||
                  betAmount <= 0 ||
                  betAmount > balanceCap + 1e-6
                }
                className="mt-3 w-full inline-flex justify-center items-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-amber-500/40 transition"
              >
                {isRolling ? (
                  <>
                    <span className="w-4 h-4 border-2 border-zinc-900/60 border-t-zinc-900 rounded-full animate-spin" />
                    Spinning…
                  </>
                ) : (
                  <>Break the line</>
                )}
              </button>
            </div>

            {/* History card */}
            <div className="rounded-2xl bg-zinc-950/85 border border-zinc-700/70 px-4 py-3 md:px-5 md:py-4 shadow-[0_0_35px_rgba(0,0,0,0.9)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-300/90">
                  Recent spins
                </span>
                <span className="text-[11px] text-zinc-400">
                  Last {history.length} rounds
                </span>
              </div>
              {history.length === 0 ? (
                <p className="text-[11px] text-zinc-400">
                  Place your first bet to start your streak.
                </p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {history.map((h) => {
                    const histExplanation = getWinExplanation(
                      h.roll,
                      h.target,
                      h.direction,
                      h.win
                    );
                    return (
                      <div
                        key={h.id}
                        className="flex flex-col text-xs py-1.5 border-b border-zinc-800/70 last:border-b-0 gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-100">
                            {h.roll.toFixed(2)}
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
                          {histExplanation} | Target {h.target} {h.direction} |{" "}
                          {h.time}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LineBreakerPage;

// app/(private)/slots/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Volume2, VolumeX, Sparkles } from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useCasino } from "@/providers/CasinoProvider";

/* ======================= Types matching API ======================= */

type SlotGrid = string[][]; // [row][col], each is an emoji from backend

type LineWin = {
  lineIndex: number;
  length: 4 | 5 | 6;
  symbol: string;
  payout: number;
  isZigZag: boolean;
  freeSpin: boolean;
};

type SpinResponse = {
  success: boolean;
  walletAddress: string;
  betAmount: number;
  feeForTreasury: number;
  grid: SlotGrid;
  lineWins: LineWin[];
  totalWinBeforeCap: number;
  totalWinAfterCap: number;
  cappedByPool: boolean;
  maxWinCap: number;
  freeSpins: number;
  userVirtualBalance: number;
  treasuryVirtualBalance: number;
  isFreeSpin?: boolean;
};

/* ======================= Client-side paylines (for highlights) ======================= */
/* MUST stay in sync with lib/slots.ts PAYLINES order */

const PAYLINES: number[][] = [
  // Straight lines
  [0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3, 3],
  // Zig-zag patterns
  [0, 1, 2, 3, 2, 1],
  [3, 2, 1, 0, 1, 2],
  [1, 0, 1, 2, 3, 2],
  [2, 3, 2, 1, 0, 1],
  [0, 0, 1, 1, 2, 2],
];

/* Random symbols for spin animation (matches backend emoji set) */
const ANIM_SYMBOLS = ["🍒", "🍋", "🔔", "💎", "7"];

/* Empty grid placeholder (4 rows × 6 columns) */
const EMPTY_GRID: SlotGrid = Array.from({ length: 4 }, () =>
  Array(6).fill("❔")
);

const COLS = 6;

/* ======================= Window type helper ======================= */

interface WindowWithAudioContext extends Window {
  AudioContext: { new(contextOptions?: AudioContextOptions): AudioContext; prototype: AudioContext; } | undefined;
  webkitAudioContext?: typeof AudioContext;
}

export default function SlotsGame() {
  const { user, virtualBalance, refreshVirtualBalance } = useUser();
  const {
    games,
    treasuryUsdcBalance,
    houseReserve,
    loading: casinoLoading,
  } = useCasino();

  const [bet, setBet] = useState(1);
  const [grid, setGrid] = useState<SlotGrid>(EMPTY_GRID);
  const [spinning, setSpinning] = useState(false);
  const [currentSpinIsFree, setCurrentSpinIsFree] = useState(false);

  const [result, setResult] = useState<{
    totalWin: number;
    message: string;
    win: boolean;
    freeSpins: number;
    isFreeSpin: boolean;
  } | null>(null);

  const [sound, setSound] = useState(true);

  const [history, setHistory] = useState<
    Array<{ grid: SlotGrid; totalWin: number; timestamp: Date }>
  >([]);

  // Queue of pending free spins (auto-played 1s apart)
  const [queuedFreeSpins, setQueuedFreeSpins] = useState(0);

  // TEMP front-end-only deduction of current bet while spin is in-flight
  const [pendingBet, setPendingBet] = useState<number | null>(null);

  // Cells that are part of winning lines (for highlighting)
  const [winningCells, setWinningCells] = useState<Set<string>>(new Set());

  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* =========================== Casino pool derived values =========================== */

  const slotsGame = games.find((g) => g.id === "slots");
  const slotsPool = slotsGame?.poolAmount ?? 0; // total pool for slots
  const uiMaxSingleWin = slotsPool > 0 ? slotsPool * 0.9 : null; // 90% of slots pool

  /* =========================== Audio =========================== */

  const playSound = (type: "spin" | "win" | "lose" | "free") => {
    if (!sound) return;
    if (typeof window === "undefined") return;

    const win = window as WindowWithAudioContext;
    const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "spin") {
      osc.frequency.value = 420;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "free") {
      // Slightly higher "ding" for free spin
      osc.frequency.value = 900;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "win") {
      osc.frequency.value = 750;
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else {
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    }
  };

  /* =========================== Helper: reel-style reveal =========================== */

  const revealResultGrid = (finalGrid: SlotGrid) => {
    // Stop random spin animation
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    // Start from whatever the current grid is and reveal column by column
    for (let col = 0; col < COLS; col++) {
      setTimeout(() => {
        setGrid((prev) =>
          prev.map((row, rIdx) => {
            const newRow = [...row];
            newRow[col] = finalGrid[rIdx][col];
            return newRow;
          })
        );
      }, col * 120); // 120ms stagger between columns
    }
  };

  /* =========================== Core spin logic (paid or free) =========================== */

  const performSpin = async (isFreeSpin: boolean) => {
    if (!user?.walletAddress) {
      console.error("No wallet connected for slots spin");
      return;
    }

    if (spinning) return;

    // Paid spins require enough balance
    if (!isFreeSpin && virtualBalance < bet) {
      console.warn("Insufficient balance for paid spin");
      return;
    }

    // If it's a queued free spin, consume one from the queue up-front
    if (isFreeSpin) {
      setQueuedFreeSpins((prev) => Math.max(0, prev - 1));
    } else {
      // FRONTEND UX: immediately show the bet deducted while spin runs
      setPendingBet(bet);
    }

    setSpinning(true);
    setCurrentSpinIsFree(isFreeSpin);
    setResult(null);
    setWinningCells(new Set());

    // Spin animation: randomize grid until we get server result
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
    }
    spinIntervalRef.current = setInterval(() => {
      setGrid(() =>
        Array.from({ length: 4 }, () =>
          Array(COLS)
            .fill(0)
            .map(
              () =>
                ANIM_SYMBOLS[Math.floor(Math.random() * ANIM_SYMBOLS.length)]
            )
        )
      );
    }, 60);

    try {
      playSound(isFreeSpin ? "free" : "spin");

      const res = await fetch("/api/slots/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: user.walletAddress,
          betAmount: bet,
          isFreeSpin,
        }),
      });

      const data: SpinResponse = await res.json();

      if (!res.ok || !data.success) {
        console.error("Spin failed:", data);
        if (spinIntervalRef.current) {
          clearInterval(spinIntervalRef.current);
          spinIntervalRef.current = null;
        }
        setSpinning(false);
        setCurrentSpinIsFree(false);
        setPendingBet(null); // clear temp deduction

        // Always sync from backend after a failed spin attempt
        refreshVirtualBalance().catch((e) =>
          console.error("refreshVirtualBalance failed", e)
        );
        return;
      }

      // Reel-style reveal
      revealResultGrid(data.grid);

      // Highlight winning cells (after the reveal delay)
      setTimeout(() => {
        const newWinning = new Set<string>();
        data.lineWins.forEach((lw) => {
          const pattern = PAYLINES[lw.lineIndex];
          if (!pattern) return;
          for (let col = 0; col < lw.length; col++) {
            const row = pattern[col];
            newWinning.add(`${row}-${col}`);
          }
        });
        setWinningCells(newWinning);
      }, COLS * 130);

      const totalWin = data.totalWinAfterCap;
      const hasWin = totalWin > 0;

      const message = hasWin
        ? data.freeSpins > 0
          ? `You won $${totalWin.toFixed(2)} and ${data.freeSpins} free spin${
              data.freeSpins === 1 ? "" : "s"
            }!`
          : `You won $${totalWin.toFixed(2)} on ${data.lineWins.length} line${
              data.lineWins.length === 1 ? "" : "s"
            }!`
        : isFreeSpin
        ? "Free spin bricked. Basement gods say run it back."
        : "No hit this time. Basement gods say spin again.";

      setTimeout(() => {
        setResult({
          totalWin,
          win: hasWin,
          freeSpins: data.freeSpins,
          isFreeSpin,
          message,
        });

        if (hasWin) {
          playSound("win");
        } else {
          playSound("lose");
        }

        setHistory((prev) => [
          {
            grid: data.grid,
            totalWin,
            timestamp: new Date(),
          },
          ...prev.slice(0, 4),
        ]);

        setSpinning(false);
        setCurrentSpinIsFree(false);
        setPendingBet(null); // clear temp deduction; backend balance will be correct after refresh

        // 🔥 Always refresh from backend after spin settles
        refreshVirtualBalance().catch((e) =>
          console.error("refreshVirtualBalance failed", e)
        );

        // Queue any new free spins we just won
        if (data.freeSpins > 0) {
          setQueuedFreeSpins((prev) => prev + data.freeSpins);
        }
      }, COLS * 130 + 100); // wait for reveal + a tiny buffer
    } catch (error) {
      console.error("Spin error:", error);
      if (spinIntervalRef.current) {
        clearInterval(spinIntervalRef.current);
        spinIntervalRef.current = null;
      }
      setSpinning(false);
      setCurrentSpinIsFree(false);
      setPendingBet(null); // clear temp deduction

      // Even on hard error, re-sync from backend (in case bet was processed)
      refreshVirtualBalance().catch((e) =>
        console.error("refreshVirtualBalance failed", e)
      );
    }
  };

  /* =========================== Auto-run free spins =========================== */

  useEffect(() => {
    if (!spinning && queuedFreeSpins > 0) {
      const timer = setTimeout(() => {
        // Auto-trigger a free spin
        performSpin(true);
      }, 1000); // 1 second between free spins
      return () => clearTimeout(timer);
    }
  }, [queuedFreeSpins, spinning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) {
        clearInterval(spinIntervalRef.current);
      }
    };
  }, []);

  /* =========================== Bet Controls =========================== */

  const handleBetChange = (newBet: number) => {
    if (newBet > 0 && newBet <= virtualBalance && !spinning) {
      setBet(Number(newBet.toFixed(2)));
      setResult(null);
    }
  };

  const handleSpinClick = () => {
    performSpin(false); // normal paid spin
  };

  const buttonLabel = (() => {
    if (spinning && currentSpinIsFree) return "FREE SPINNING...";
    if (spinning) return "SPINNING...";
    if (queuedFreeSpins > 0) return `FREE SPIN x${queuedFreeSpins} QUEUED`;
    return `SPIN (Bet: $${bet.toFixed(2)})`;
  })();

  const canSpinPaid = !spinning && virtualBalance >= bet;

  // 🔥 Effective balance: show bet deducted locally while paid spin is in-flight
  const effectiveBalance =
    spinning && !currentSpinIsFree && pendingBet != null
      ? Math.max(0, Number((virtualBalance - pendingBet).toFixed(2)))
      : virtualBalance;

  /* =========================== Render =========================== */

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-semibold">Back to Games</span>
            </Link>

            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground tracking-[0.15em] uppercase">
                🎰 Celler Slots
              </h1>
              <p className="text-xs text-muted-foreground">
                {casinoLoading ? (
                  "Summoning basement bankroll..."
                ) : (
                  <>
                    Slots Pool:{" "}
                    <span className="font-semibold text-primary">
                      ${slotsPool.toFixed(2)}
                    </span>
                    {uiMaxSingleWin != null && (
                      <>
                        {" "}
                        • Max Hit:{" "}
                        <span className="font-semibold text-emerald-400">
                          ${uiMaxSingleWin.toFixed(2)}
                        </span>
                      </>
                    )}
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {queuedFreeSpins > 0 && (
                <div className="hidden md:flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/60 shadow-[0_0_18px_rgba(245,158,11,0.5)]">
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span className="text-xs font-semibold text-amber-200">
                    {queuedFreeSpins} Basement Free Spin
                    {queuedFreeSpins === 1 ? "" : "s"}
                  </span>
                </div>
              )}

              <button
                onClick={() => setSound(!sound)}
                className="p-2 rounded-lg bg-card/50 border border-border/50 hover:border-primary/50 transition-all"
              >
                {sound ? (
                  <Volume2 className="w-5 h-5 text-primary" />
                ) : (
                  <VolumeX className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Slot Machine */}
          <div className="lg:col-span-2">
            <div
              className={`rounded-2xl bg-gradient-to-br from-black/80 via-slate-950/90 to-black/90 border p-8 backdrop-blur-md shadow-[0_0_60px_rgba(0,0,0,0.95)] relative overflow-hidden
                ${
                  currentSpinIsFree
                    ? "border-amber-400/70 shadow-[0_0_45px_rgba(245,158,11,0.6)]"
                    : "border-primary/50"
                }`}
            >
              <div className="absolute inset-0 pointer-events-none opacity-40 mix-blend-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_55%),_radial-gradient(circle_at_bottom,_rgba(34,197,94,0.14),_transparent_55%)]" />

              {/* Reel Display */}
              <div className="mb-8 flex flex-col items-center relative z-10">
                <div className="inline-flex flex-col gap-3 bg-black/55 p-5 rounded-3xl border border-primary/40 shadow-[0_0_40px_rgba(56,189,248,0.35)]">
                  {grid.map((row, rIdx) => (
                    <div key={rIdx} className="flex gap-3 justify-center">
                      {row.map((symbol, cIdx) => {
                        const isWinning = winningCells.has(`${rIdx}-${cIdx}`);
                        return (
                          <div
                            key={`${rIdx}-${cIdx}`}
                            className={[
                              "w-14 h-14 md:w-16 md:h-16 rounded-2xl flex items-center justify-center text-3xl md:text-4xl font-bold border-2 md:border-4 transition-all duration-200",
                              "bg-gradient-to-br from-slate-800 to-slate-900",
                              spinning ? "animate-pulse" : "",
                              isWinning
                                ? "border-emerald-400 ring-2 ring-emerald-400/70 shadow-[0_0_28px_rgba(52,211,153,0.8)] scale-110"
                                : currentSpinIsFree
                                ? "border-amber-300/70 shadow-[0_0_16px_rgba(245,158,11,0.7)]"
                                : "border-primary/40",
                            ].join(" ")}
                          >
                            {symbol}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Result Message */}
                {result && (
                  <div
                    className={`mt-6 w-full max-w-md text-center p-4 rounded-lg border-2 ${
                      result.win
                        ? "bg-emerald-500/10 border-emerald-500/50"
                        : "bg-red-500/5 border-red-500/40"
                    }`}
                  >
                    <p
                      className={`text-lg font-bold ${
                        result.win ? "text-emerald-300" : "text-red-300"
                      }`}
                    >
                      {result.message}
                    </p>
                    {result.totalWin > 0 && (
                      <p className="text-2xl font-bold text-primary mt-2">
                        +${result.totalWin.toFixed(2)}
                      </p>
                    )}
                    {result.freeSpins > 0 && (
                      <p className="text-sm text-amber-300 mt-1">
                        +{result.freeSpins} basement free spin
                        {result.freeSpins > 1 ? "s" : ""} 🎲
                      </p>
                    )}
                    {result.isFreeSpin && (
                      <p className="text-xs text-amber-200/80 mt-1 uppercase tracking-wide">
                        Free Spin Round
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Spin Button */}
              <button
                onClick={handleSpinClick}
                disabled={spinning || !canSpinPaid}
                className={[
                  "w-full py-4 px-6 rounded-xl transition-all duration-300 text-black font-bold text-lg",
                  "bg-gradient-to-r from-emerald-500 via-cyan-400 to-emerald-500",
                  "hover:from-emerald-400 hover:via-cyan-300 hover:to-emerald-400",
                  "hover:shadow-[0_0_40px_rgba(34,197,94,0.75)]",
                  "transform hover:scale-105 disabled:hover:scale-100",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                {buttonLabel}
              </button>

              {/* Balance + Free Spins Display */}
              <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left">
                <div>
                  <p className="text-muted-foreground text-xs mb-1 uppercase tracking-wide">
                    Your Celler Balance
                  </p>
                  <p className="text-3xl font-bold text-primary drop-shadow-[0_0_20px_rgba(16,185,129,0.6)]">
                    ${effectiveBalance.toFixed(2)}
                  </p>
                  {spinning && !currentSpinIsFree && pendingBet != null && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Bet in play:{" "}
                      <span className="text-emerald-300 font-semibold">
                        -${pendingBet.toFixed(2)}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-center md:items-end gap-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Basement Free Spins
                  </p>
                  <p className="text-xl font-bold text-amber-300">
                    {queuedFreeSpins}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Controls Sidebar */}
          <div className="space-y-6">
            {/* Bet Controls */}
            <div className="rounded-xl bg-card/70 border border-border/70 p-6 backdrop-blur-md">
              <h3 className="text-lg font-bold text-foreground mb-4 flex items-center justify-between">
                Bet Amount
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  1 Chip = $1
                </span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {[0.1, 0.5, 1.0, 5.0].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => handleBetChange(amount)}
                    disabled={amount > virtualBalance || spinning}
                    className={`py-2 px-3 rounded-lg font-semibold transition-all ${
                      bet === amount && !spinning
                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/40"
                        : "bg-card border border-border/50 text-foreground hover:border-primary/50"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    ${amount.toFixed(2)}
                  </button>
                ))}
              </div>

              {/* Custom Bet */}
              <div className="mt-4">
                <label className="text-sm text-muted-foreground block mb-2">
                  Custom Bet
                </label>
                <input
                  type="number"
                  value={bet}
                  onChange={(e) =>
                    handleBetChange(parseFloat(e.target.value) || 0)
                  }
                  min="0.1"
                  step="0.1"
                  disabled={spinning}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-center"
                />
              </div>
            </div>

            {/* Game Info */}
            <div className="rounded-xl bg-card/70 border border-border/70 p-6 backdrop-blur-md">
              <h3 className="text-lg font-bold text-foreground mb-4">
                Game Info
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Grid</span>
                  <span className="text-foreground font-semibold">
                    6×4 (reels × rows)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paylines</span>
                  <span className="text-foreground font-semibold">
                    10 (straights + zig-zags)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Volatility</span>
                  <span className="text-foreground font-semibold">
                    Basement Medium
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Treasury (USDC)</span>
                  <span className="text-foreground font-semibold">
                    ${treasuryUsdcBalance.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    House Reserve (10%)
                  </span>
                  <span className="text-foreground font-semibold">
                    ${houseReserve.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slots Pool</span>
                  <span className="text-foreground font-semibold">
                    ${slotsPool.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Single Win</span>
                  <span className="text-foreground font-semibold">
                    {uiMaxSingleWin != null
                      ? `$${uiMaxSingleWin.toFixed(2)}`
                      : "—"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Celler splits the casino treasury into a house reserve and
                  per-game pools. Slots can never pay more than 90% of its pool
                  on a single spin. Symbols hit off a crypto-grade RNG, not
                  vibes.
                </p>
              </div>
            </div>

            {/* Recent Spins */}
            {history.length > 0 && (
              <div className="rounded-xl bg-card/70 border border-border/70 p-6 backdrop-blur-md">
                <h3 className="text-lg font-bold text-foreground mb-4">
                  Recent Basement Spins
                </h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {history.map((h, idx) => (
                    <div
                      key={idx}
                      className="text-xs p-2 bg-background/80 rounded border border-border/50"
                    >
                      <div className="space-y-1 mb-1">
                        {h.grid.map((row, rIdx) => (
                          <div key={rIdx} className="flex gap-1 justify-center">
                            {row.map((s, cIdx) => (
                              <span key={`${rIdx}-${cIdx}`}>{s}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                      {h.totalWin > 0 ? (
                        <p className="text-emerald-400 font-bold text-center">
                          +${h.totalWin.toFixed(2)}
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-center">
                          No hit
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/80 text-center mt-1">
                        {h.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

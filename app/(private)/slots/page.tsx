"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Volume2, VolumeX, Zap } from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useCasino } from "@/providers/CasinoProvider";

/* ======================= Types matching API ======================= */

type SlotGrid = string[][];
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

const PAYLINES: number[][] = [
  [0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3, 3],
  [0, 1, 2, 3, 2, 1],
  [3, 2, 1, 0, 1, 2],
  [1, 0, 1, 2, 3, 2],
  [2, 3, 2, 1, 0, 1],
  [0, 0, 1, 1, 2, 2],
];

const ANIM_SYMBOLS = ["🍒", "🍋", "🔔", "💎", "7"];
const EMPTY_GRID: SlotGrid = Array.from({ length: 4 }, () =>
  Array(6).fill("❔")
);
const COLS = 6;

interface WindowWithAudioContext extends Window {
  AudioContext:
    | {
        new (contextOptions?: AudioContextOptions): AudioContext;
        prototype: AudioContext;
      }
    | undefined;
  webkitAudioContext?: typeof AudioContext;
}

/* ======================= Enhanced Sound System ======================= */
class VegasSoundEngine {
  private enabled: boolean = true;

  constructor() {
    this.enabled = typeof window !== "undefined";
  }

  private playTone(frequency: number, duration: number, volume: number = 0.15) {
    if (!this.enabled) return;
    const win = window as WindowWithAudioContext;
    const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const ctx = new AudioContextCtor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio context failed", e);
    }
  }

  spinStart() {
    this.playTone(500, 0.15, 0.1);
    setTimeout(() => this.playTone(700, 0.15, 0.1), 80);
  }

  spinStopping(colIndex: number) {
    const freq = 800 + colIndex * 150;
    this.playTone(freq, 0.12, 0.12);
  }

  lineClear() {
    this.playTone(523, 0.1, 0.12);
    setTimeout(() => this.playTone(659, 0.1, 0.12), 60);
    setTimeout(() => this.playTone(784, 0.15, 0.14), 120);
  }

  freeSpin() {
    this.playTone(1047, 0.2, 0.16);
    setTimeout(() => this.playTone(784, 0.25, 0.15), 150);
    setTimeout(() => this.playTone(1047, 0.3, 0.18), 300);
  }

  bigWin() {
    const notes = [523, 659, 784, 1047, 784, 659];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.12, 0.18), i * 80);
    });
  }

  tokenPing() {
    this.playTone(880, 0.08, 0.1);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }
}

/* ======================= Main Component ======================= */

export default function SlotsGame() {
  const { user, virtualBalance, refreshVirtualBalance } = useUser();
  const {
    games,
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
  const soundEngine = useRef(new VegasSoundEngine());

  const [history, setHistory] = useState<
    Array<{ grid: SlotGrid; totalWin: number; timestamp: Date }>
  >([]);
  const [queuedFreeSpins, setQueuedFreeSpins] = useState(0);
  const [pendingBet, setPendingBet] = useState<number | null>(null);
  const [winningCells, setWinningCells] = useState<Set<string>>(new Set());
  const [floatingWins, setFloatingWins] = useState<
    Array<{ id: string; amount: number; x: number; y: number }>
  >([]);

  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reelAnimationRef = useRef<ReturnType<typeof setInterval>[] | null>(
    null
  );

  const slotsGame = games.find((g) => g.id === "slots");
  const slotsPool = slotsGame?.poolAmount ?? 0;

  useEffect(() => {
    soundEngine.current.setEnabled(sound);
  }, [sound]);

  /* =========================== Reel-by-Reel Animation =========================== */

  const revealResultGridAnimated = (finalGrid: SlotGrid) => {
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }

    if (reelAnimationRef.current) {
      reelAnimationRef.current.forEach((i) => clearInterval(i));
    }
    reelAnimationRef.current = [];

    // Reveal each column with staggered timing
    for (let col = 0; col < COLS; col++) {
      setTimeout(() => {
        if (sound) soundEngine.current.spinStopping(col);

        const interval = setInterval(() => {
          setGrid((prev) => {
            const newGrid = prev.map((row) => [...row]);
            // Scroll effect before settling
            const randomRow = Math.floor(Math.random() * 4);
            newGrid[randomRow][col] =
              ANIM_SYMBOLS[Math.floor(Math.random() * ANIM_SYMBOLS.length)];
            return newGrid;
          });
        }, 40);

        setTimeout(() => {
          clearInterval(interval);
          setGrid((prev) =>
            prev.map((row, rIdx) => {
              const newRow = [...row];
              newRow[col] = finalGrid[rIdx][col];
              return newRow;
            })
          );
        }, 280);

        if (reelAnimationRef.current) {
          reelAnimationRef.current.push(interval);
        }
      }, col * 200);
    }
  };

  /* =========================== Core Spin Logic =========================== */

  const performSpin = async (isFreeSpin: boolean) => {
    if (!user?.walletAddress || spinning) return;
    if (!isFreeSpin && virtualBalance < bet) return;

    if (isFreeSpin) {
      setQueuedFreeSpins((prev) => Math.max(0, prev - 1));
    } else {
      setPendingBet(bet);
    }

    setSpinning(true);
    setCurrentSpinIsFree(isFreeSpin);
    setResult(null);
    setWinningCells(new Set());

    // Random spin animation
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
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

    if (sound) soundEngine.current.spinStart();

    try {
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
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
        setSpinning(false);
        setCurrentSpinIsFree(false);
        setPendingBet(null);
        refreshVirtualBalance().catch(console.error);
        return;
      }

      // Animated reel reveal
      revealResultGridAnimated(data.grid);

      // Highlight winning cells
      setTimeout(() => {
        const newWinning = new Set<string>();
        data.lineWins.forEach((lw) => {
          const pattern = PAYLINES[lw.lineIndex];
          if (!pattern) return;
          for (let col = 0; col < lw.length; col++) {
            newWinning.add(`${pattern[col]}-${col}`);
          }
        });
        setWinningCells(newWinning);

        if (data.lineWins.length > 0) {
          if (sound) soundEngine.current.lineClear();
        }
      }, COLS * 200 + 300);

      const totalWin = data.totalWinAfterCap;
      const hasWin = totalWin > 0;

      const message = hasWin
        ? data.freeSpins > 0
          ? `🎉 WON $${totalWin.toFixed(2)} + ${data.freeSpins} FREE SPIN${
              data.freeSpins === 1 ? "" : "S"
            }`
          : `🎉 WON $${totalWin.toFixed(2)} ON ${data.lineWins.length} LINE${
              data.lineWins.length === 1 ? "" : "S"
            }`
        : isFreeSpin
        ? "No Hit. Again!"
        : "No Hit. Spin Again!";

      setTimeout(() => {
        setResult({
          totalWin,
          win: hasWin,
          freeSpins: data.freeSpins,
          isFreeSpin,
          message,
        });

        if (hasWin) {
          if (totalWin > bet * 10) {
            if (sound) soundEngine.current.bigWin();
            // Floating win animation
            const newWins = Array.from({ length: 5 }, (_, i) => ({
              id: `${Date.now()}-${i}`,
              amount: totalWin,
              x: Math.random() * 60 - 30,
              y: 0,
            }));
            setFloatingWins((prev) => [...prev, ...newWins]);
            setTimeout(
              () =>
                setFloatingWins((prev) =>
                  prev.filter((w) => !newWins.find((nw) => nw.id === w.id))
                ),
              1200
            );
          } else {
            if (sound) soundEngine.current.lineClear();
          }
        }

        setHistory((prev) => [
          { grid: data.grid, totalWin, timestamp: new Date() },
          ...prev.slice(0, 3),
        ]);

        setSpinning(false);
        setCurrentSpinIsFree(false);
        setPendingBet(null);
        refreshVirtualBalance().catch(console.error);

        if (data.freeSpins > 0) {
          if (sound) soundEngine.current.freeSpin();
          setQueuedFreeSpins((prev) => prev + data.freeSpins);
        }
      }, COLS * 200 + 600);
    } catch (error) {
      console.error("Spin error:", error);
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
      setSpinning(false);
      setCurrentSpinIsFree(false);
      setPendingBet(null);
      refreshVirtualBalance().catch(console.error);
    }
  };

  /* =========================== Auto Free Spins =========================== */

  useEffect(() => {
    if (!spinning && queuedFreeSpins > 0) {
      const timer = setTimeout(() => performSpin(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [queuedFreeSpins, spinning]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
      if (reelAnimationRef.current)
        reelAnimationRef.current.forEach((i) => clearInterval(i));
    };
  }, []);

  /* =========================== Handlers =========================== */

  const handleBetChange = (newBet: number) => {
    if (newBet > 0 && newBet <= virtualBalance && !spinning) {
      setBet(Number(newBet.toFixed(2)));
      setResult(null);
    }
  };

  const buttonLabel =
    spinning && currentSpinIsFree
      ? "FREE SPINNING..."
      : spinning
      ? "SPINNING..."
      : queuedFreeSpins > 0
      ? `FREE SPIN x${queuedFreeSpins}`
      : `SPIN`;

  const canSpinPaid = !spinning && virtualBalance >= bet;
  const effectiveBalance =
    spinning && !currentSpinIsFree && pendingBet != null
      ? Math.max(0, Number((virtualBalance - pendingBet).toFixed(2)))
      : virtualBalance;

  /* =========================== Render =========================== */

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-black to-background">
      {/* Background glow effect */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-primary/20 via-transparent to-transparent blur-3xl opacity-30" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-secondary/15 via-transparent to-transparent blur-3xl opacity-20" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-primary/20 backdrop-blur-lg bg-background/50">
        <div className="w-full px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm font-semibold hidden sm:inline">
                Back
              </span>
            </Link>

            <div className="text-center flex-1 min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-primary">
                  SLOTS
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {casinoLoading
                  ? "Loading..."
                  : `Pool: $${slotsPool.toFixed(2)}`}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {queuedFreeSpins > 0 && (
                <div className="hidden xs:flex items-center gap-1 px-2 sm:px-3 py-1 rounded-full bg-primary/15 border border-primary/60 shadow-[0_0_18px_rgba(251,191,36,0.5)]">
                  <Zap className="w-3 h-3 sm:w-4 sm:h-4 text-primary" />
                  <span className="text-[10px] sm:text-xs font-semibold text-primary">
                    {queuedFreeSpins}
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
      </header>

      {/* Main Game */}
      <main className="relative z-10 w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-6xl mx-auto">
          {/* Floating Wins */}
          {floatingWins.map((fw) => (
            <div
              key={fw.id}
              className="fixed pointer-events-none font-bold text-primary text-lg sm:text-2xl animate-float-up"
              style={{
                left: `calc(50% + ${fw.x}px)`,
                top: "40%",
                textShadow: "0 0 20px rgba(251, 191, 36, 1)",
              }}
            >
              +${fw.amount.toFixed(2)}
            </div>
          ))}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Slot Machine - Main */}
            <div className="lg:col-span-2 order-1 lg:order-1">
              <div
                className={`rounded-2xl bg-gradient-to-br from-black/80 via-slate-950/90 to-black/90 border p-6 sm:p-8 backdrop-blur-md transition-all duration-300 ${
                  currentSpinIsFree
                    ? "border-primary/70 shadow-[0_0_45px_rgba(251,191,36,0.6)]"
                    : spinning
                    ? "border-primary/50 shadow-[0_0_30px_rgba(251,191,36,0.4)]"
                    : "border-primary/30 shadow-[0_0_20px_rgba(251,191,36,0.2)]"
                }`}
              >
                {/* Reel Display */}
                <div className="mb-6 sm:mb-8 flex flex-col items-center">
                  <div className="inline-flex flex-col gap-2 sm:gap-3 bg-black/55 p-4 sm:p-5 rounded-3xl border border-primary/40 shadow-[0_0_40px_rgba(251,191,36,0.35)] overflow-hidden">
                    {grid.map((row, rIdx) => (
                      <div
                        key={rIdx}
                        className="flex gap-2 sm:gap-3 justify-center"
                      >
                        {row.map((symbol, cIdx) => {
                          const isWinning = winningCells.has(`${rIdx}-${cIdx}`);
                          return (
                            <div
                              key={`${rIdx}-${cIdx}`}
                              className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl md:text-4xl font-bold border-2 sm:border-3 md:border-4 transition-all duration-200 ${
                                isWinning
                                  ? "border-accent ring-2 ring-accent/70 shadow-[0_0_28px_rgba(117,189,143,0.8)] scale-110 animate-win-sparkle"
                                  : currentSpinIsFree
                                  ? "border-primary/70 shadow-[0_0_16px_rgba(251,191,36,0.7)]"
                                  : "border-primary/40"
                              } bg-gradient-to-br from-slate-800 to-slate-900 ${
                                spinning && !isWinning ? "animate-pulse" : ""
                              }`}
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
                          ? "bg-accent/10 border-accent/50"
                          : "bg-destructive/5 border-destructive/40"
                      }`}
                    >
                      <p
                        className={`text-base sm:text-lg font-bold ${
                          result.win ? "text-accent" : "text-destructive"
                        }`}
                      >
                        {result.message}
                      </p>
                      {result.totalWin > 0 && (
                        <p className="text-xl sm:text-2xl font-bold text-primary mt-2">
                          +${result.totalWin.toFixed(2)}
                        </p>
                      )}
                      {result.freeSpins > 0 && (
                        <p className="text-xs sm:text-sm text-primary mt-1 font-semibold">
                          +{result.freeSpins} FREE SPIN
                          {result.freeSpins > 1 ? "S" : ""} 🎲
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Spin Button */}
                <button
                  onClick={() => performSpin(false)}
                  disabled={spinning || !canSpinPaid}
                  className={`w-full py-4 sm:py-5 px-6 rounded-xl transition-all duration-300 text-black font-bold text-base sm:text-lg uppercase tracking-wider ${
                    spinning || !canSpinPaid
                      ? "opacity-60 cursor-not-allowed bg-gradient-to-r from-primary/50 via-secondary/50 to-primary/50"
                      : "bg-gradient-to-r from-primary via-secondary to-primary hover:from-primary hover:via-accent hover:to-primary hover:shadow-[0_0_50px_rgba(251,191,36,0.9)] transform hover:scale-105"
                  }`}
                >
                  {buttonLabel} • ${bet.toFixed(2)}
                </button>

                {/* Balance Display */}
                <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">
                      Balance
                    </p>
                    <p className="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]">
                      ${effectiveBalance.toFixed(2)}
                    </p>
                  </div>
                  {queuedFreeSpins > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/40">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-sm font-bold text-primary">
                        {queuedFreeSpins} Free
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar - Bet & Info */}
            <div className="space-y-4 sm:space-y-6 order-2 lg:order-2">
              {/* Bet Controls */}
              <div className="rounded-xl bg-card/70 border border-border/70 p-4 sm:p-6 backdrop-blur-md">
                <h3 className="text-base sm:text-lg font-bold text-foreground mb-4">
                  Bet Amount
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[0.1, 0.5, 1.0, 5.0].map((amount) => (
                    <button
                      key={amount}
                      onClick={() => handleBetChange(amount)}
                      disabled={amount > virtualBalance || spinning}
                      className={`py-2 px-3 rounded-lg font-semibold text-sm transition-all ${
                        bet === amount && !spinning
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/40"
                          : "bg-card border border-border/50 text-foreground hover:border-primary/50"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      ${amount.toFixed(2)}
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="text-xs text-muted-foreground block mb-2 uppercase tracking-wider">
                    Custom
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
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-center text-sm"
                  />
                </div>
              </div>

              {/* Game Info */}
              <div className="rounded-xl bg-card/70 border border-border/70 p-4 sm:p-6 backdrop-blur-md">
                <h3 className="text-base sm:text-lg font-bold text-foreground mb-4">
                  Game Info
                </h3>
                <div className="space-y-2 text-xs sm:text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Grid</span>
                    <span className="text-foreground font-semibold">6×4</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paylines</span>
                    <span className="text-foreground font-semibold">10</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Pool</span>
                    <span className="text-foreground font-semibold">
                      ${slotsPool.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>House Reserve</span>
                    <span className="text-foreground font-semibold">
                      ${houseReserve.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recent Spins */}
              {history.length > 0 && (
                <div className="rounded-xl bg-card/70 border border-border/70 p-4 sm:p-6 backdrop-blur-md">
                  <h3 className="text-base sm:text-lg font-bold text-foreground mb-3">
                    Recent Spins
                  </h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {history.map((h, idx) => (
                      <div
                        key={idx}
                        className="text-xs p-2 bg-background/80 rounded border border-border/50"
                      >
                        <div className="space-y-1 mb-1 flex justify-center gap-1">
                          {h.grid.map((row, rIdx) => (
                            <div key={rIdx} className="flex gap-0.5">
                              {row.map((s, cIdx) => (
                                <span
                                  key={`${rIdx}-${cIdx}`}
                                  className="text-xs"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                        {h.totalWin > 0 ? (
                          <p className="text-accent font-bold text-center">
                            +${h.totalWin.toFixed(2)}
                          </p>
                        ) : (
                          <p className="text-muted-foreground text-center">—</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { BallManager } from "@/lib/plinko/BallManager";
import { useUser } from "@/providers/UserProvider";

type PlinkoPlayResponse = {
  success?: boolean;
  error?: string;
  walletAddress?: string;
  betAmount?: number;
  sinkIndex?: number;
  multiplier?: number;
  payoutAmount?: number;
  point?: number;
  pattern?: ("L" | "R")[];
};

type PlinkoMode = "manual" | "auto";

const BASE_BET = 1;
const AUTO_DROP_SPACING_MS = 200;

type HitEntry = {
  id: number;
  multiplier: number;
};

type SessionEntry = {
  id: number;
  timestamp: number;
  bet: number;
  multiplier: number;
  payout: number;
  net: number;
};

const SESSION_STORAGE_KEY = "plinko_session_history_v1";

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default function PlinkoPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [ballManager, setBallManager] = useState<BallManager | null>(null);
  const [activeRequests, setActiveRequests] = useState(0);

  const [mode, setMode] = useState<PlinkoMode>("manual");
  const [autoCount, setAutoCount] = useState<number>(10);

  const pendingResultsRef = useRef<PlinkoPlayResponse[]>([]);
  const [pendingBetTotal, setPendingBetTotal] = useState(0);

  const [hits, setHits] = useState<HitEntry[]>([]);
  const nextHitIdRef = useRef(0);

  const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>([]);
  const nextSessionIdRef = useRef(0);

  const [error, setError] = useState<string | null>(null);

  const { isLoggedIn, address, virtualBalance, refreshAll } = useUser();

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
          const parsed: SessionEntry[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setSessionHistory(parsed);
            nextSessionIdRef.current = parsed.length;
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    return () => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    };
  }, []);

  const sessionPnL = useMemo(
    () => sessionHistory.reduce((sum, entry) => sum + entry.net, 0),
    [sessionHistory]
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;

        const scaleX = canvas.width / 800;
        const scaleY = canvas.height / 800;
        const scale = Math.max(scaleX, scaleY);

        const offsetX = (canvas.width - 800 * scale) / 2;
        const offsetY = (canvas.height - 800 * scale) / 2;

        ctx.resetTransform();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    return () => window.removeEventListener("resize", resizeCanvas);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const manager = new BallManager(
      canvasRef.current as HTMLCanvasElement,
      (sinkIndex: number, startX?: number) => {
        const queue = pendingResultsRef.current;
        if (!queue.length) return;

        let matched: PlinkoPlayResponse | undefined;

        if (typeof startX === "number") {
          const idx = queue.findIndex((o) => {
            const samePoint = typeof o.point === "number" && o.point === startX;
            const sameSink =
              typeof o.sinkIndex === "number"
                ? o.sinkIndex === sinkIndex
                : true;
            return samePoint && sameSink;
          });

          if (idx >= 0) {
            matched = queue.splice(idx, 1)[0];
          }
        }

        if (!matched) {
          matched = queue.shift();
        }

        if (!matched) return;

        const resolvedBet = matched.betAmount ?? BASE_BET;
        setPendingBetTotal((curr) => Math.max(0, curr - resolvedBet));

        void refreshAll();

        if (matched.success && typeof matched.multiplier === "number") {
          const id = nextHitIdRef.current++;
          const multiplier = matched.multiplier;

          setHits((prev) => {
            const next = [{ id, multiplier }, ...prev];
            return next.slice(0, 15);
          });

          setTimeout(() => {
            setHits((prev) => prev.filter((h) => h.id !== id));
          }, 5000);
        }

        if (matched.success) {
          const bet = matched.betAmount ?? BASE_BET;
          const payout = matched.payoutAmount ?? 0;
          const multiplier = matched.multiplier ?? 0;
          const net = payout - bet;

          const entryId = nextSessionIdRef.current++;
          const entry: SessionEntry = {
            id: entryId,
            timestamp: Date.now(),
            bet,
            multiplier,
            payout,
            net,
          };

          setSessionHistory((prev) => {
            const next = [entry, ...prev];
            if (typeof window !== "undefined") {
              try {
                window.localStorage.setItem(
                  SESSION_STORAGE_KEY,
                  JSON.stringify(next)
                );
              } catch {
                // ignore quota errors
              }
            }
            return next;
          });
        }
      }
    );

    setBallManager(manager);

    return () => {
      manager.stop();
    };
  }, [refreshAll]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!hits.length) return;

    const visible = hits.slice(0, 15);
    const cardWidth = 80;
    const cardHeight = 26;
    const gap = 6;
    const totalHeight =
      visible.length * cardHeight + (visible.length - 1) * gap;

    const centerX = width - cardWidth * 0.65;
    const startY = height / 2 - totalHeight / 2;

    ctx.font = "bold 13px system-ui, -apple-system, BlinkMacSystemFont";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    visible.forEach((hit, index) => {
      const x = centerX - cardWidth / 2;
      const y = startY + index * (cardHeight + gap);

      const isWin = hit.multiplier >= 1;
      const bg = isWin ? "rgba(52,211,153,0.18)" : "rgba(248,113,113,0.16)";
      const border = isWin ? "rgba(52,211,153,0.8)" : "rgba(248,113,113,0.8)";
      const text = isWin ? "#bbf7d0" : "#fecaca";

      ctx.shadowColor = isWin
        ? "rgba(52,211,153,0.75)"
        : "rgba(248,113,113,0.75)";
      ctx.shadowBlur = 10;

      ctx.fillStyle = bg;
      drawRoundedRect(ctx, x, y, cardWidth, cardHeight, 10);
      ctx.fill();

      ctx.lineWidth = 1;
      ctx.strokeStyle = border;
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = text;
      ctx.fillText(
        `${hit.multiplier.toFixed(2)}x`,
        centerX,
        y + cardHeight / 2
      );
    });
  }, [hits]);

  const placeSingleBet = async (opts?: { skipBalanceCheck?: boolean }) => {
    if (!ballManager) return;

    const betAmount = BASE_BET;
    setError(null);

    if (!isLoggedIn || !address) {
      setError("Connect your wallet to play Plinko.");
      return;
    }

    if (!opts?.skipBalanceCheck) {
      if (virtualBalance - pendingBetTotal < betAmount) {
        setError("Insufficient chips to place this bet.");
        return;
      }
    }

    setActiveRequests((c) => c + 1);

    try {
      const res = await fetch("/api/plinko/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          betAmount,
          walletAddress: address,
        }),
      });

      const data: PlinkoPlayResponse = await res.json();

      if (!res.ok || !data.success) {
        console.error("[Plinko] error:", data.error);
        setError(data.error ?? "Plinko error");
        return;
      }

      const actualBet = data.betAmount ?? betAmount;

      setPendingBetTotal((curr) => curr + actualBet);

      if (typeof data.point === "number") {
        pendingResultsRef.current.push(data);
        ballManager.addBall(data.point);
      }
    } catch (err) {
      console.error("[Plinko] unexpected error:", err);
      setError("Unexpected error. Please try again.");
    } finally {
      setActiveRequests((c) => Math.max(0, c - 1));
    }
  };

  const handleManualPlay = async () => {
    await placeSingleBet();
  };

  const handleAutoPlay = async () => {
    if (!ballManager) return;

    setError(null);

    if (!isLoggedIn || !address) {
      setError("Connect your wallet to play Plinko.");
      return;
    }

    const betAmount = BASE_BET;
    const count = Math.max(1, Math.floor(autoCount || 0));
    const totalBet = betAmount * count;

    if (virtualBalance - pendingBetTotal < totalBet) {
      setError(
        `You need at least ${totalBet.toFixed(
          2
        )} chips to auto-drop ${count} balls.`
      );
      return;
    }

    for (let i = 0; i < count; i++) {
      void placeSingleBet({ skipBalanceCheck: true });

      if (i < count - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTO_DROP_SPACING_MS)
        );
      }
    }
  };

  const buttonDisabled = !ballManager || !isLoggedIn;
  const isBusy = activeRequests > 0;
  const displayBalance = Math.max(0, virtualBalance - pendingBetTotal);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] w-full bg-[radial-gradient(circle_at_top,_#1f2933,_#020308)] text-white flex justify-center px-3 py-4 sm:py-6">
      <div className="w-full max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-200/90 shadow-[0_0_20px_rgba(16,185,129,0.35)]">
              <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
              Live Game
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-wide text-emerald-100 drop-shadow-[0_0_18px_rgba(52,211,153,0.6)]">
              Celler Plinko
            </h1>
            <p className="mt-1 text-[11px] sm:text-xs text-zinc-400 max-w-xs">
              Drop the ball, hit the high multipliers, and watch your chips pop.
            </p>
          </div>

          <div className="text-right text-[11px] sm:text-xs">
            <div className="rounded-xl border border-white/10 bg-black/60 px-3 py-2 shadow-[0_0_15px_rgba(0,0,0,0.8)]">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">
                Chip balance
              </div>
              <div className="mt-0.5 text-lg font-semibold text-emerald-300">
                {displayBalance.toFixed(2)}
              </div>
              {pendingBetTotal > 0 && (
                <div className="mt-0.5 text-[10px] text-amber-300">
                  −{pendingBetTotal.toFixed(2)} pending
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main layout */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Game board - takes more space on desktop */}
          <div className="flex-1 flex flex-col items-center">
            <div className="relative w-full">
              {/* Neon frame */}
              <div className="pointer-events-none absolute -inset-[1px] rounded-[32px] bg-[conic-gradient(from_140deg_at_50%_0%,#22c55e,#22d3ee,#eab308,#22c55e)] opacity-60 blur-sm" />
              <div className="relative rounded-[28px] bg-gradient-to-b from-black/80 via-[#020814]/95 to-black/90 border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.45)] px-2.5 py-3 sm:px-3 sm:py-4">
                {/* Label */}
                <div className="mb-2 flex items-center justify-center gap-2">
                  <span className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
                  <span className="text-[10px] sm:text-[11px] tracking-[0.18em] uppercase text-emerald-200/90">
                    Plinko Board
                  </span>
                  <span className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-emerald-500/50 to-transparent" />
                </div>

                {/* Canvas */}
                <div className="relative mx-auto w-full">
                  <canvas
                    ref={canvasRef}
                    width={800}
                    height={800}
                    className="block w-full h-auto rounded-[22px] bg-[#050a12] border border-white/5 shadow-[0_0_40px_rgba(15,23,42,0.9)]"
                  />
                  <canvas
                    ref={overlayRef}
                    width={800}
                    height={800}
                    className="pointer-events-none absolute inset-0 block w-full h-auto rounded-[22px]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Controls panel - sidebar on desktop, below on mobile */}
          <div className="w-full lg:w-80 flex flex-col gap-4">
            {/* Mode toggle */}
            <div className="rounded-2xl bg-black/75 border border-white/10 px-4 py-4 shadow-[0_0_24px_rgba(0,0,0,0.9)]">
              <div className="flex items-center justify-center gap-2 text-[11px] sm:text-xs mb-4">
                <div className="inline-flex rounded-full bg-black/60 p-1 border border-white/10">
                  <button
                    onClick={() => setMode("manual")}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      mode === "manual"
                        ? "bg-emerald-500 text-black shadow-[0_0_12px_rgba(16,185,129,0.7)]"
                        : "bg-transparent text-zinc-200"
                    }`}
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => setMode("auto")}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      mode === "auto"
                        ? "bg-emerald-500 text-black shadow-[0_0_12px_rgba(16,185,129,0.7)]"
                        : "bg-transparent text-zinc-200"
                    }`}
                  >
                    Auto
                  </button>
                </div>
              </div>

              {/* Play buttons */}
              {mode === "manual" ? (
                <button
                  onClick={handleManualPlay}
                  disabled={buttonDisabled}
                  className="w-full inline-flex items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-500 text-black font-semibold text-sm sm:text-base py-2.5 shadow-[0_0_25px_rgba(52,211,153,0.9)] disabled:from-zinc-700 disabled:via-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400 disabled:shadow-none transition-transform active:scale-[0.97]"
                >
                  {!isLoggedIn ? "Connect wallet to play" : "Drop ball"}
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[11px] sm:text-xs text-zinc-200 bg-black/60 border border-white/10 rounded-full px-2.5 py-1.5">
                    <span className="text-zinc-400 uppercase tracking-wide">
                      Balls
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={autoCount}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        setAutoCount(Math.min(500, Math.max(1, Math.floor(v))));
                      }}
                      className="w-16 bg-transparent border-none outline-none text-center text-emerald-200 text-[11px] sm:text-xs"
                    />
                  </div>
                  <button
                    onClick={handleAutoPlay}
                    disabled={buttonDisabled}
                    className="w-full inline-flex items-center justify-center rounded-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-500 text-black font-semibold text-sm sm:text-base py-2.5 shadow-[0_0_25px_rgba(52,211,153,0.9)] disabled:from-zinc-700 disabled:via-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400 disabled:shadow-none transition-transform active:scale-[0.97]"
                  >
                    {!isLoggedIn
                      ? "Connect wallet to play"
                      : `Auto drop ${Math.max(1, Math.floor(autoCount || 0))}`}
                  </button>
                </div>
              )}

              {/* Status */}
              <div className="mt-3 text-[10px] sm:text-[11px] text-zinc-400 text-center">
                {isBusy ? (
                  <span className="flex items-center justify-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Processing bets…</span>
                  </span>
                ) : (
                  <span>Ready to drop.</span>
                )}
              </div>

              {error && (
                <p className="mt-2 text-[11px] text-red-300 text-center bg-red-500/10 border border-red-500/40 rounded-full px-3 py-1">
                  {error}
                </p>
              )}
            </div>

            {/* Session stats */}
            <div className="rounded-2xl bg-black/75 border border-white/10 px-4 py-4 shadow-[0_0_24px_rgba(0,0,0,0.9)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Session P&L</h3>
                <div
                  className={`text-sm font-semibold ${
                    sessionPnL >= 0 ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {sessionPnL >= 0 ? "+" : ""}
                  {sessionPnL.toFixed(2)}
                </div>
              </div>
              <p className="text-[11px] text-zinc-400">
                {sessionHistory.length} bet
                {sessionHistory.length !== 1 ? "s" : ""} resolved
              </p>
            </div>

            {/* Recent results */}
            {sessionHistory.length > 0 && (
              <div className="rounded-2xl bg-black/75 border border-white/10 px-4 py-4 shadow-[0_0_24px_rgba(0,0,0,0.9)]">
                <h3 className="text-sm font-semibold mb-2">Recent Results</h3>
                <div className="max-h-48 overflow-y-auto text-[10px] divide-y divide-white/5">
                  {sessionHistory.slice(0, 8).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-zinc-200">
                        {entry.multiplier.toFixed(2)}x
                      </span>
                      <span
                        className={
                          entry.net >= 0 ? "text-emerald-300" : "text-red-300"
                        }
                      >
                        {entry.net >= 0 ? "+" : ""}
                        {entry.net.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-[10px] text-zinc-500 text-center">
          Visuals are for entertainment — all outcomes are provably fair from
          the Plinko engine.
        </p>
      </div>
    </div>
  );
}

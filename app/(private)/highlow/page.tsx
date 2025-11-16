// app/(pages)/highlow/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Flame,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  Coins,
  Zap,
  Trophy,
  History,
  Info,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useUser } from "@/providers/UserProvider";

type HighLowDirection = "higher" | "lower";

type HighLowApiResponse = {
  success?: boolean;
  error?: string;
  walletAddress?: string;
  betAmount?: number;
  direction?: HighLowDirection;
  feeForTreasury?: number;
  initialNumber?: number;
  nextNumber?: number;
  isWin?: boolean;
  isLoss?: boolean;
  isPush?: boolean;
  rawPayout?: number;
  totalWinAfterCap?: number;
  maxWinCap?: number;
  cappedByPool?: boolean;
  userVirtualBalance?: number;
  treasuryVirtualBalance?: number;

  // optionally from lib/highlow
  potBefore?: number;
  potAfter?: number;
};

type HighLowStartResponse = {
  success?: boolean;
  error?: string;
  walletAddress?: string;
  initialNumber?: number;
  userVirtualBalance?: number;
};

type HighLowCashoutResponse = {
  success?: boolean;
  error?: string;
  walletAddress?: string;
  requestedPot?: number;
  payablePot?: number;
  cappedByPool?: boolean;
  maxWinCap?: number;
  userVirtualBalance?: number;
};

type RoundResult = {
  id: number;
  time: string;
  direction: HighLowDirection;
  fromNumber: number;
  toNumber: number;
  potBefore: number;
  potAfter: number;
  isWin: boolean;
  isLoss: boolean;
  isPush: boolean;
  balanceAfter: number;
};

const BET_PRESETS = [0.25, 0.5, 1, 2];

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

const HighLowPage: React.FC = () => {
  const { isLoggedIn, address, user, virtualBalance, refreshVirtualBalance } =
    useUser();

  const walletAddress = address ?? user?.walletAddress ?? null;

  // Base bet (what they choose before starting a ladder)
  const [betAmount, setBetAmount] = useState<number>(0.5);

  // Ladder pot (what they’re building & can cash out)
  const [ladderPot, setLadderPot] = useState<number>(0);
  const [runActive, setRunActive] = useState(false);

  const [direction, setDirection] = useState<HighLowDirection | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  const [currentNumber, setCurrentNumber] = useState<number | null>(null);
  const [nextNumber, setNextNumber] = useState<number | null>(null);

  // 0 = idle, 1 = current revealed, 2 = current + next revealed
  const [revealStep, setRevealStep] = useState<0 | 1 | 2>(0);

  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [history, setHistory] = useState<RoundResult[]>([]);

  const [roundCounter, setRoundCounter] = useState(0);

  const [winStreak, setWinStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0); // soft, session-only stat

  const [turboMode, setTurboMode] = useState(false);

  // 🔥 Track whether we've already made the first guess in this ladder run
  const [hasMadeFirstGuess, setHasMadeFirstGuess] = useState(false);

  const hasCurrentCard = currentNumber !== null;

  /* ===========================================================================
     SOUND EFFECTS
     =========================================================================== */

  const flipSoundRef = useRef<HTMLAudioElement | null>(null);
  const clickSoundRef = useRef<HTMLAudioElement | null>(null);
  const winSoundRef = useRef<HTMLAudioElement | null>(null);
  const lossSoundRef = useRef<HTMLAudioElement | null>(null);
  const cashoutSoundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    flipSoundRef.current = new Audio("/sounds/highlow-flip.mp3");
    clickSoundRef.current = new Audio("/sounds/highlow-click.mp3");
    winSoundRef.current = new Audio("/sounds/highlow-win.mp3");
    lossSoundRef.current = new Audio("/sounds/highlow-loss.mp3");
    cashoutSoundRef.current = new Audio("/sounds/highlow-cashout.mp3");

    if (flipSoundRef.current) flipSoundRef.current.volume = 0.45;
    if (clickSoundRef.current) clickSoundRef.current.volume = 0.4;
    if (winSoundRef.current) winSoundRef.current.volume = 0.7;
    if (lossSoundRef.current) lossSoundRef.current.volume = 0.75;
    if (cashoutSoundRef.current) cashoutSoundRef.current.volume = 0.7;
  }, []);

  const playSound = (audio: HTMLAudioElement | null) => {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // ignore autoplay issues
    }
  };

  const canGuess = useMemo(
    () =>
      !!walletAddress &&
      runActive &&
      ladderPot > 0 &&
      !!direction &&
      hasCurrentCard &&
      !isPlaying &&
      !isRevealing,
    [
      walletAddress,
      runActive,
      ladderPot,
      direction,
      hasCurrentCard,
      isPlaying,
      isRevealing,
    ]
  );

  const canStartRun = useMemo(
    () =>
      !!walletAddress &&
      !runActive &&
      betAmount > 0 &&
      !isPlaying &&
      !isRevealing,
    [walletAddress, runActive, betAmount, isPlaying, isRevealing]
  );

  const canCashout = useMemo(
    () =>
      !!walletAddress &&
      runActive &&
      ladderPot > 0 &&
      !isPlaying &&
      !isRevealing,
    [walletAddress, runActive, ladderPot, isPlaying, isRevealing]
  );

  /* ===========================================================================
     START RUN: take bet (server-side rake) & deal first number (45–65)
     =========================================================================== */

  const handleStartRun = useCallback(async () => {
    if (!walletAddress) {
      toast.error("Connect your wallet to play.");
      return;
    }

    if (betAmount <= 0) {
      toast.error("Bet amount must be greater than 0.");
      return;
    }

    if (virtualBalance < betAmount) {
      toast.error("Not enough chips for that bet.");
      return;
    }

    try {
      // click sound on start
      playSound(clickSoundRef.current);

      setIsPlaying(true);
      setIsRevealing(false);
      setRunActive(false);
      setLadderPot(0);
      setCurrentNumber(null);
      setNextNumber(null);
      setRevealStep(0);
      setDirection(null);

      const res = await fetch("/api/highlow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // We send betAmount now so the API can apply rake once.
        body: JSON.stringify({ walletAddress, betAmount }),
      });

      const data: HighLowStartResponse = await res.json();

      if (!res.ok || !data.success) {
        const msg = data.error || "Failed to start High / Low run";
        toast.error(msg);
        return;
      }

      const init = data.initialNumber;
      if (typeof init !== "number") {
        toast.error("No starting number received from server.");
        return;
      }

      // Starting ladder pot: treat as full bet; backend enforces caps & rake.
      setLadderPot(roundToCents(betAmount));
      setCurrentNumber(init);
      setRevealStep(1);
      setRunActive(true);

      // fresh run: no guesses yet
      setHasMadeFirstGuess(false);

      // flip sound when first card shows
      playSound(flipSoundRef.current);

      // Sync chips with backend
      refreshVirtualBalance().catch((err) =>
        console.warn("[HighLow] refreshVirtualBalance error (start)", err)
      );
    } catch (err) {
      console.error("[HighLow] start run error", err);
      toast.error("Something went wrong starting the run.");
    } finally {
      setIsPlaying(false);
    }
  }, [
    walletAddress,
    betAmount,
    virtualBalance,
    refreshVirtualBalance,
    playSound,
  ]);

  /* ===========================================================================
     GUESS STEP: use current ladderPot as "pot" for this guess.
     =========================================================================== */

  const handleGuess = useCallback(async () => {
    if (!walletAddress) {
      toast.error("Connect your wallet to play.");
      return;
    }
    if (!runActive) {
      toast.error("Start a run first.");
      return;
    }
    if (currentNumber === null) {
      toast.error("No current card. Start a new run.");
      return;
    }
    if (!direction) {
      toast.error("Choose Higher or Lower first.");
      return;
    }
    if (ladderPot <= 0) {
      toast.error("Nothing in the ladder pot.");
      return;
    }

    const potBefore = roundToCents(ladderPot);

    // 🔥 first guess in this run → tell backend to constrain to 45–65
    const isFirstFlip = !hasMadeFirstGuess;

    try {
      // click sound when locking guess
      playSound(clickSoundRef.current);

      setIsPlaying(true);
      setIsRevealing(true);

      // Keep current card visible, clear NEXT while we resolve
      setRevealStep(1);
      setNextNumber(null);

      const res = await fetch("/api/highlow/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          betAmount: potBefore, // treat ladder pot as the stake for this step
          direction,
          initialNumber: currentNumber,
          isFirstFlip, // 👈 backend forwards this into playHighLow(...)
        }),
      });

      const data: HighLowApiResponse = await res.json();

      if (!res.ok || !data.success) {
        const msg = data.error || "Failed to play High / Lower";
        if (msg.toLowerCase().includes("insufficient")) {
          toast.error("Not enough chips. Buy more to keep playing.");
        } else {
          toast.error(msg);
        }
        setIsRevealing(false);
        return;
      }

      // After a successful guess, we've used up the "first flip" for this run
      if (!hasMadeFirstGuess) {
        setHasMadeFirstGuess(true);
      }

      const initFromServer =
        typeof data.initialNumber === "number"
          ? data.initialNumber
          : currentNumber;
      const nextFromServer =
        typeof data.nextNumber === "number" ? data.nextNumber : null;

      const isWin = !!data.isWin;
      const isLoss = !!data.isLoss;
      const isPush = !!data.isPush;

      const potAfter =
        typeof data.potAfter === "number"
          ? roundToCents(data.potAfter)
          : roundToCents(data.totalWinAfterCap ?? 0);

      const balanceAfter = roundToCents(data.userVirtualBalance ?? 0);

      // Immediately show the next card on the right
      setCurrentNumber(initFromServer);
      setNextNumber(nextFromServer);
      setRevealStep(2);

      // flip sound as next card appears
      playSound(flipSoundRef.current);

      // Update stats
      setTotalRounds((prev) => prev + 1);

      // Session profit (roughly)
      const profitDelta = potAfter - potBefore;
      setTotalProfit((prev) => roundToCents(prev + profitDelta));

      if (isWin) {
        // win sound
        playSound(winSoundRef.current);
        setWinStreak((prev) => {
          const newStreak = prev + 1;
          setBestStreak((best) => Math.max(best, newStreak));
          return newStreak;
        });
      } else if (isLoss) {
        // loss sound
        playSound(lossSoundRef.current);
        setWinStreak(0);
      }

      const now = new Date();
      const round: RoundResult = {
        id: roundCounter + 1,
        time: now.toLocaleTimeString(),
        direction: (data.direction as HighLowDirection) ?? direction,
        fromNumber: initFromServer,
        toNumber: nextFromServer ?? initFromServer,
        potBefore,
        potAfter,
        isWin,
        isLoss,
        isPush,
        balanceAfter,
      };

      setRoundCounter((prev) => prev + 1);
      setLastResult(round);
      setHistory((prev) => [round, ...prev].slice(0, 12));

      if (isPush) {
        toast("Push. Ladder pot stays the same.", { icon: "↔️" });
      } else if (isWin) {
        toast.success(`You climbed to ${potAfter.toFixed(2)} chips!`);
      } else {
        toast.error("You busted the ladder. Run over.");
      }

      // Sync chips
      refreshVirtualBalance().catch((err) =>
        console.warn("[HighLow] refreshVirtualBalance error (guess)", err)
      );

      // Slide timing
      const slideDelay = turboMode ? 200 : 900;

      const afterReveal = () => {
        setIsRevealing(false);

        if (isLoss || potAfter <= 0 || !nextFromServer) {
          // Run is dead → clear board
          setRunActive(false);
          setLadderPot(0);
          setCurrentNumber(null);
          setNextNumber(null);
          setRevealStep(0);
          setDirection(null);
          return;
        }

        // Still alive → NEXT card slides into CURRENT spot,
        // NEXT slot opens up with "?"
        setCurrentNumber(nextFromServer);
        setNextNumber(null);
        setLadderPot(potAfter);
        setRevealStep(1);
      };

      setTimeout(afterReveal, slideDelay);
    } catch (err) {
      console.error("[HighLow] guess error", err);
      toast.error("Something went wrong. Please try again.");
      setIsRevealing(false);
    } finally {
      setIsPlaying(false);
    }
  }, [
    walletAddress,
    runActive,
    currentNumber,
    direction,
    ladderPot,
    turboMode,
    roundCounter,
    refreshVirtualBalance,
    playSound,
    hasMadeFirstGuess,
  ]);

  /* ===========================================================================
     CASHOUT: take current ladderPot and reset the run
     =========================================================================== */

  const handleCashout = useCallback(async () => {
    if (!walletAddress) {
      toast.error("Connect your wallet to play.");
      return;
    }
    if (!runActive || ladderPot <= 0) {
      toast.error("No active ladder to cash out.");
      return;
    }

    try {
      // click sound on cashout press
      playSound(clickSoundRef.current);

      setIsPlaying(true);

      const res = await fetch("/api/highlow/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          potAmount: ladderPot,
        }),
      });

      const data: HighLowCashoutResponse = await res.json();

      if (!res.ok || !data.success) {
        const msg = data.error || "Failed to cash out";
        toast.error(msg);
        return;
      }

      const paid = roundToCents(data.payablePot ?? ladderPot);

      toast.success(`You cashed out ${paid.toFixed(2)} chips 💰`);

      // cashout sound after success
      playSound(cashoutSoundRef.current);

      // Update profit stat (approx: payout - base bet)
      setTotalProfit((prev) =>
        roundToCents(prev + (paid - betAmount > 0 ? paid - betAmount : 0))
      );

      // Reset ladder state
      setRunActive(false);
      setLadderPot(0);
      setCurrentNumber(null);
      setNextNumber(null);
      setRevealStep(0);
      setDirection(null);
      setHasMadeFirstGuess(false);

      // Sync chips
      refreshVirtualBalance().catch((err) =>
        console.warn("[HighLow] refreshVirtualBalance error (cashout)", err)
      );
    } catch (err) {
      console.error("[HighLow] cashout error", err);
      toast.error("Something went wrong cashing out.");
    } finally {
      setIsPlaying(false);
    }
  }, [
    walletAddress,
    runActive,
    ladderPot,
    betAmount,
    refreshVirtualBalance,
    playSound,
  ]);

  /* ===========================================================================
     Keyboard shortcuts
     =========================================================================== */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") {
        setDirection("higher");
      }
      if (e.key === "l" || e.key === "L") {
        setDirection("lower");
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!walletAddress || isPlaying || isRevealing) return;

        if (!runActive) {
          if (canStartRun) {
            handleStartRun();
          }
        } else if (canGuess) {
          handleGuess();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    walletAddress,
    isPlaying,
    isRevealing,
    runActive,
    canStartRun,
    canGuess,
    handleStartRun,
    handleGuess,
  ]);

  /* ===========================================================================
     UI Helpers
     =========================================================================== */

  const resultLabel = useMemo(() => {
    if (!lastResult) return null;
    if (lastResult.isPush) return "Push";
    if (lastResult.isWin) return "Win";
    if (lastResult.isLoss) return "Loss";
    return null;
  }, [lastResult]);

  const resultColor = useMemo(() => {
    if (!lastResult) return "";
    if (lastResult.isPush) return "text-sky-400";
    if (lastResult.isWin) return "text-emerald-400";
    if (lastResult.isLoss) return "text-red-400";
    return "";
  }, [lastResult]);

  const profitColor =
    totalProfit > 0
      ? "text-emerald-400"
      : totalProfit < 0
      ? "text-red-400"
      : "text-zinc-200";

  /* ===========================================================================
     Render
     =========================================================================== */

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0a0a0f,_#020308)] text-zinc-100 flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 sm:px-8 pt-4 sm:pt-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <div className="flex flex-col">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
              Celler High / Lower
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
                <Flame className="w-3 h-3 text-emerald-400" />
                Ladder
              </span>
            </h1>
            <p className="text-xs text-zinc-500">
              First card is mid-range (45–65). Guess higher or lower, build your
              ladder, and cash out before you bust.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1">
            <Coins className="w-3 h-3" />
            <span>Chips</span>
          </div>
          <div className="text-lg font-mono">
            {isLoggedIn ? virtualBalance.toFixed(2) : "—"}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 pb-8">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[2fr,1.2fr] gap-6 sm:gap-8 mt-6">
          {/* Left: Game arena */}
          <motion.div
            className="relative overflow-hidden rounded-3xl border border-zinc-800/70 bg-gradient-to-b from-zinc-900/60 via-zinc-950 to-black shadow-[0_0_80px_rgba(0,0,0,0.9)] backdrop-blur-xl p-4 sm:p-6 flex flex-col gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Glowy border accent */}
            <div className="pointer-events-none absolute inset-0 rounded-3xl border border-emerald-500/10 shadow-[0_0_45px_rgba(16,185,129,0.25)]" />

            {/* Bet & ladder info */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  Base Bet
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={betAmount}
                      disabled={runActive}
                      onChange={(e) =>
                        setBetAmount(
                          e.target.value === ""
                            ? 0
                            : roundToCents(Number(e.target.value))
                        )
                      }
                      className="w-28 bg-black/40 border border-zinc-700/80 rounded-xl px-3 py-2 text-sm font-mono outline-none disabled:opacity-60 disabled:cursor-not-allowed focus-visible:border-emerald-400/80 focus-visible:ring-1 focus-visible:ring-emerald-500/60"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Chips
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {BET_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={runActive}
                        onClick={() => setBetAmount(preset)}
                        className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition ${
                          betAmount === preset
                            ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                            : "border-zinc-700/70 bg-zinc-900/60 text-zinc-300 hover:border-emerald-400/70 hover:text-emerald-200"
                        } ${
                          runActive
                            ? "opacity-50 cursor-not-allowed hover:border-zinc-700/70 hover:text-zinc-300"
                            : ""
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ladder pot + turbo */}
              <div className="flex flex-col items-start sm:items-end gap-2">
                <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/70 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 flex items-center justify-between gap-4">
                    <span>Current Ladder Pot</span>
                    <span className="font-mono text-xs text-emerald-300">
                      {ladderPot > 0 ? ladderPot.toFixed(2) : "0.00"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTurboMode((x) => !x)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition ${
                      turboMode
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.5)]"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-400/80 hover:text-emerald-200"
                    }`}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Turbo Reveal
                  </button>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <Info className="w-3 h-3" />
                  <span>Space: Start / Guess · H / L to choose</span>
                </div>
              </div>
            </div>

            {/* Center: Numbers + buttons */}
            <div className="flex flex-col md:flex-row gap-6 md:gap-8 mt-2">
              {/* Numbers Display */}
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <div className="flex items-center justify-center gap-6">
                  {/* Current card */}
                  <motion.div
                    className="relative w-28 h-36 sm:w-32 sm:h-44 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-950 to-black border border-zinc-700/80 shadow-[0_20px_45px_rgba(0,0,0,0.85)] flex flex-col items-center justify-center overflow-hidden"
                    animate={{
                      boxShadow:
                        revealStep >= 1
                          ? "0 0 40px rgba(52,211,153,0.45)"
                          : "0 20px 45px rgba(0,0,0,0.85)",
                    }}
                    transition={{ type: "spring", stiffness: 80, damping: 15 }}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.1),_transparent)]" />
                    <span className="absolute top-2 left-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Current
                    </span>
                    <span className="absolute bottom-2 right-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      1–100
                    </span>

                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={revealStep >= 1 ? currentNumber ?? "?" : "?"}
                        initial={{ scale: 0.4, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.6, opacity: 0, y: -20 }}
                        transition={{
                          type: "spring",
                          stiffness: 200,
                          damping: 14,
                        }}
                        className="text-5xl sm:text-6xl font-semibold text-emerald-300 drop-shadow-[0_0_18px_rgba(16,185,129,0.8)]"
                      >
                        {revealStep >= 1 && currentNumber !== null
                          ? currentNumber
                          : "?"}
                      </motion.span>
                    </AnimatePresence>
                  </motion.div>

                  {/* Next card */}
                  <motion.div
                    className="relative w-28 h-36 sm:w-32 sm:h-44 rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-950 to-black border border-zinc-700/80 shadow-[0_20px_45px_rgba(0,0,0,0.85)] flex flex-col items-center justify-center overflow-hidden"
                    animate={{
                      boxShadow:
                        revealStep === 2 && nextNumber !== null
                          ? lastResult?.isWin
                            ? "0 0 50px rgba(52,211,153,0.75)"
                            : lastResult?.isLoss
                            ? "0 0 50px rgba(248,113,113,0.7)"
                            : "0 0 40px rgba(56,189,248,0.6)"
                          : "0 20px 45px rgba(0,0,0,0.85)",
                    }}
                    transition={{ type: "spring", stiffness: 80, damping: 15 }}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(250,250,250,0.06),_transparent)]" />
                    <span className="absolute top-2 left-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Next
                    </span>
                    <span className="absolute bottom-2 right-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      1–100
                    </span>

                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={revealStep === 2 ? nextNumber ?? "?" : "?"}
                        initial={{ scale: 0.2, opacity: 0, y: 30 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.6, opacity: 0, y: -30 }}
                        transition={{
                          type: "spring",
                          stiffness: 260,
                          damping: 18,
                        }}
                        className={`text-5xl sm:text-6xl font-semibold ${
                          lastResult?.isWin
                            ? "text-emerald-300"
                            : lastResult?.isLoss
                            ? "text-red-300"
                            : "text-sky-300"
                        } drop-shadow-[0_0_18px_rgba(0,0,0,0.9)]`}
                      >
                        {revealStep === 2 && nextNumber !== null
                          ? nextNumber
                          : "?"}
                      </motion.span>
                    </AnimatePresence>
                  </motion.div>
                </div>

                {/* Result label */}
                <div className="h-6 flex items-center justify-center">
                  {lastResult && revealStep === 2 && (
                    <motion.div
                      key={lastResult.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${
                        lastResult.isWin
                          ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-100"
                          : lastResult.isLoss
                          ? "border-red-400/70 bg-red-500/10 text-red-100"
                          : "border-sky-400/70 bg-sky-500/10 text-sky-100"
                      }`}
                    >
                      {lastResult.isWin && (
                        <>
                          <Trophy className="w-3.5 h-3.5" />
                          <span>
                            WIN · Pot {lastResult.potBefore.toFixed(2)} →{" "}
                            {lastResult.potAfter.toFixed(2)}
                          </span>
                        </>
                      )}
                      {lastResult.isLoss && (
                        <>
                          <Flame className="w-3.5 h-3.5" />
                          <span>
                            LOSS · Lost {lastResult.potBefore.toFixed(2)} chips
                          </span>
                        </>
                      )}
                      {lastResult.isPush && (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>PUSH · Pot unchanged</span>
                        </>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="w-full md:w-60 flex flex-col gap-4">
                <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-4 py-4 flex flex-col gap-3 shadow-[0_18px_40px_rgba(0,0,0,0.8)]">
                  <div className="flex items-center justify-between text-xs text-zinc-500 uppercase tracking-[0.18em]">
                    <span>Choose</span>
                    <span>Direction</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDirection("higher")}
                      className={`group relative overflow-hidden rounded-xl border px-3 py-3 flex flex-col items-center justify-center gap-1.5 transition ${
                        direction === "higher"
                          ? "border-emerald-400 bg-emerald-500/15 shadow-[0_0_30px_rgba(16,185,129,0.6)]"
                          : "border-zinc-700/80 bg-zinc-900/70 hover:border-emerald-400/60 hover:bg-zinc-900"
                      }`}
                    >
                      <ArrowUpCircle
                        className={`w-7 h-7 transition ${
                          direction === "higher"
                            ? "text-emerald-400"
                            : "text-zinc-300 group-hover:text-emerald-300"
                        }`}
                      />
                      <span className="text-xs font-semibold tracking-wide">
                        Higher
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        Next &gt; current
                      </span>
                      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.25),_transparent)] transition" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDirection("lower")}
                      className={`group relative overflow-hidden rounded-xl border px-3 py-3 flex flex-col items-center justify-center gap-1.5 transition ${
                        direction === "lower"
                          ? "border-red-400 bg-red-500/15 shadow-[0_0_30px_rgba(248,113,113,0.6)]"
                          : "border-zinc-700/80 bg-zinc-900/70 hover:border-red-400/60 hover:bg-zinc-900"
                      }`}
                    >
                      <ArrowDownCircle
                        className={`w-7 h-7 transition ${
                          direction === "lower"
                            ? "text-red-400"
                            : "text-zinc-300 group-hover:text-red-300"
                        }`}
                      />
                      <span className="text-xs font-semibold tracking-wide">
                        Lower
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        Next &lt; current
                      </span>
                      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 bg-[radial-gradient(circle_at_bottom,_rgba(248,113,113,0.25),_transparent)] transition" />
                    </button>
                  </div>

                  {/* Primary button: Start Run vs Guess */}
                  <button
                    type="button"
                    onClick={runActive ? handleGuess : handleStartRun}
                    disabled={runActive ? !canGuess : !canStartRun}
                    className={`mt-1 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold tracking-wide transition ${
                      runActive
                        ? canGuess
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-50 shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:bg-emerald-500/30 active:scale-[0.98]"
                          : "border-zinc-700 bg-zinc-900 text-zinc-500 cursor-not-allowed"
                        : canStartRun
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-50 shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:bg-emerald-500/30 active:scale-[0.98]"
                        : "border-zinc-700 bg-zinc-900 text-zinc-500 cursor-not-allowed"
                    }`}
                  >
                    {isPlaying || isRevealing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {runActive ? "Dealing..." : "Starting..."}
                      </>
                    ) : runActive ? (
                      <>
                        <Flame className="w-4 h-4" />
                        Lock Guess & Draw
                      </>
                    ) : (
                      <>
                        <Flame className="w-4 h-4" />
                        Start Ladder Run
                      </>
                    )}
                  </button>

                  {/* Cashout button */}
                  <button
                    type="button"
                    onClick={handleCashout}
                    disabled={!canCashout}
                    className={`mt-2 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold tracking-wide transition ${
                      canCashout
                        ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 active:scale-[0.98]"
                        : "border-zinc-800 bg-zinc-950 text-zinc-600 cursor-not-allowed"
                    }`}
                  >
                    💰 Cashout & Reset
                  </button>

                  {resultLabel && (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Last result:{" "}
                      <span className={resultColor + " font-semibold"}>
                        {resultLabel}
                      </span>
                    </div>
                  )}
                </div>

                {/* Stats card */}
                <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-4 py-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500 uppercase tracking-[0.18em]">
                    <span>Session Stats</span>
                    <Trophy className="w-3 h-3" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div>
                      <div className="text-[11px] text-zinc-500">Guesses</div>
                      <div className="text-sm font-mono">{totalRounds}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">
                        Win Streak
                      </div>
                      <div className="text-sm font-mono">
                        {winStreak}{" "}
                        {bestStreak > 0 && (
                          <span className="text-[10px] text-emerald-400/80 ml-1">
                            (Best {bestStreak})
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">
                        Session PnL
                      </div>
                      <div className={`text-sm font-mono ${profitColor}`}>
                        {totalProfit >= 0 ? "+" : ""}
                        {totalProfit.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">
                        Ladder Pot
                      </div>
                      <div className="text-sm font-mono">
                        {ladderPot.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right: History / vibe panel */}
          <motion.div
            className="rounded-3xl border border-zinc-800/80 bg-gradient-to-b from-zinc-950/80 via-black to-black/90 p-4 sm:p-5 flex flex-col gap-4 shadow-[0_18px_50px_rgba(0,0,0,0.9)]"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-zinc-900/70 border border-zinc-700/80 p-1.5">
                  <History className="w-4 h-4 text-zinc-300" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Ladder History
                  </div>
                  <div className="text-sm text-zinc-300">
                    See how far your runs went.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setHistory([])}
                className="text-[11px] text-zinc-500 hover:text-zinc-200 underline decoration-dotted underline-offset-2"
              >
                Clear
              </button>
            </div>

            <div className="relative mt-1 flex-1">
              <div className="max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                {history.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-xs text-zinc-600 italic">
                    No guesses yet. Start a ladder run and take the first shot.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {history.map((round) => (
                      <motion.div
                        key={round.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-3 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-zinc-500">
                              #{round.id}
                            </span>
                            <span className="text-[11px] text-zinc-600">
                              {round.time}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">
                              {round.fromNumber} → {round.toNumber}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              (
                              {round.direction === "higher"
                                ? "Higher"
                                : "Lower"}
                              )
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span
                            className={`text-[11px] font-semibold ${
                              round.isWin
                                ? "text-emerald-400"
                                : round.isLoss
                                ? "text-red-400"
                                : "text-sky-400"
                            }`}
                          >
                            {round.isPush
                              ? "Push"
                              : round.isWin
                              ? `${round.potBefore.toFixed(
                                  2
                                )} → ${round.potAfter.toFixed(2)}`
                              : `Lost ${round.potBefore.toFixed(2)}`}
                          </span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            Bal: {round.balanceAfter.toFixed(2)}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Neon footer banner */}
              <div className="mt-4 rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-cyan-500/15 px-3 py-2.5 flex items-center justify-between text-[11px] text-emerald-100 shadow-[0_0_35px_rgba(16,185,129,0.6)]">
                <div className="flex items-center gap-2">
                  <Flame className="w-3.5 h-3.5" />
                  <span>
                    Built for late-night grinders. Ladder up, cash out,
                    don&apos;t get greedy.
                  </span>
                </div>
                <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-emerald-300/80">
                  Celler · Basement Edition
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default HighLowPage;

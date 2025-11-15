// app/(private)/dashboard/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { PiggyBank, Dices } from "lucide-react";

import { useCasino } from "@/providers/CasinoProvider";
import { CASINO_GAMES, type CasinoGameId } from "@/lib/casinoConfig";

/* ========= Local visuals for each game ========= */

const GAME_VISUALS: Record<
  CasinoGameId,
  {
    icon: string;
    gradient: string;
  }
> = {
  slots: {
    icon: "🎰",
    gradient: "from-red-700 to-amber-500",
  },
  linebreaker: {
    icon: "🎲",
    gradient: "from-emerald-700 to-teal-500",
  },
  roulette: {
    icon: "🎡",
    gradient: "from-rose-700 to-orange-500",
  },
  cointoss: {
    icon: "🪙",
    gradient: "from-slate-700 to-slate-900",
  },

  crash: {
    icon: "📈",
    gradient: "from-purple-700 to-fuchsia-500",
  },
  highlow: {
    icon: "📊",
    gradient: "from-sky-700 to-cyan-500",
  },
};

export default function Dashboard() {
  const {
    loading,
    error,
    // treasuryUsdcBalance,  // no longer used
    games,
    gamesTotalPool,
    refreshCasino,
  } = useCasino();

  // Merge config with runtime pool data by id
  const enabledGames = CASINO_GAMES.filter((g) => g.enabled);
  const gameCards = enabledGames.map((configGame) => {
    const runtime = games.find((g) => g.id === configGame.id);
    const visual = GAME_VISUALS[configGame.id];

    const poolAmount = runtime?.poolAmount ?? 0;
    const pctOfGamePool =
      gamesTotalPool > 0 ? (poolAmount / gamesTotalPool) * 100 : 0;

    return {
      ...configGame,
      icon: visual?.icon ?? "🎮",
      gradient: visual?.gradient ?? "from-zinc-700 to-zinc-900",
      poolAmount,
      pctOfGamePool,
    };
  });

  // We don’t currently surface treasuryUsdcBalance in the UI,
  // so we only format the game pool total.
  const formattedGamePool = gamesTotalPool.toFixed(2);

  return (
    <div className="max-h-[500px] bg-background">
      {/* HERO SECTION */}
      <section className="relative w-full min-h-[460px] sm:min-h-[500px] lg:min-h-[560px] overflow-hidden">
        {/* Hero image background */}
        <div className="absolute inset-0">
          <Image
            src="/hero.png"
            alt="Celler Saturday Night Games"
            fill
            priority
            className="object-cover"
          />

          {/* Dark left-side overlay so text is always readable */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/15" />
          {/* Warm Sailor Jerry vibe glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(248,180,0,0.35),_transparent_60%),radial-gradient(circle_at_top_right,_rgba(220,38,38,0.35),_transparent_55%)]" />
        </div>

        {/* Hero content */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-10 flex flex-col md:flex-row items-center justify-between gap-10">
          {/* Left: text */}
          <div className="max-w-xl">
            <p className="inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300 bg-black/40 px-3 py-1 rounded-full border border-amber-500/60 mb-4">
              Saturday Night Games
            </p>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-amber-50 tracking-tight leading-tight mb-4 drop-shadow-[0_0_18px_rgba(0,0,0,0.8)]">
              Celler
              <span className="block text-2xl sm:text-3xl lg:text-4xl mt-2 text-amber-300">
                Basement Casino With The Boys
              </span>
            </h1>

            <p className="text-sm sm:text-base text-zinc-100/85 max-w-lg mb-6 drop-shadow-[0_0_12px_rgba(0,0,0,0.7)]">
              Spin, roll, and call your shots. Celler is your underground
              basement casino for legendary Saturday nights with the crew.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Link href="#games">
                <button className="px-5 py-2.5 rounded-full bg-amber-500 text-zinc-900 text-sm font-semibold shadow-lg shadow-amber-500/40 hover:bg-amber-400 transition">
                  Start Playing
                </button>
              </Link>
            </div>
          </div>

          {/* Right: Pool / treasury card */}
          <div className="w-full max-w-sm">
            <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-amber-500/40 shadow-[0_0_45px_rgba(0,0,0,0.9)] p-4 sm:p-5 space-y-3">
              {/* Header + refresh */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] text-zinc-300/80 mb-0.5">
                    Casino Game Pool
                  </p>
                  <p className="text-sm font-semibold text-amber-50">
                    On-chain payout capacity
                  </p>
                </div>
                <button
                  onClick={refreshCasino}
                  disabled={loading}
                  className="text-[10px] px-2 py-1 rounded-full border border-amber-500/60 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {error && (
                <p className="text-[10px] text-rose-300 bg-rose-900/40 border border-rose-500/40 rounded-lg px-2 py-1.5">
                  {error}
                </p>
              )}

              {/* Total pool */}
              <div className="rounded-xl bg-zinc-950/80 border border-zinc-700/70 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PiggyBank className="w-4 h-4 text-emerald-300" />
                  <div>
                    <p className="text-[10px] text-zinc-400">Total game pool</p>
                    <p className="text-lg font-semibold text-amber-50">
                      {formattedGamePool} USDC
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400 text-right max-w-[90px]">
                  Max combined payouts across all games.
                </p>
              </div>

              {/* Per-game compact grid */}
              <div className="rounded-xl bg-zinc-950/70 border border-zinc-700/70 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] text-zinc-200 font-semibold">
                    Game limits
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    Per-game max payout
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {gameCards.map((game) => (
                    <div
                      key={game.id}
                      className="rounded-lg bg-zinc-900/80 border border-zinc-700/70 px-2.5 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-base shrink-0">{game.icon}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] text-zinc-100 truncate">
                            {game.name}
                          </p>
                          <p className="text-[10px] text-zinc-400">
                            {game.pctOfGamePool.toFixed(1)}% of pool
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-semibold text-amber-200">
                          {game.poolAmount.toFixed(2)}
                        </p>
                        <p className="text-[10px] text-zinc-400">USDC max</p>
                      </div>
                    </div>
                  ))}

                  {gameCards.length === 0 && (
                    <p className="text-[11px] text-zinc-400 col-span-2">
                      No games configured yet.
                    </p>
                  )}
                </div>
              </div>

              <p className="text-[10px] text-zinc-300/80">
                These limits cap how much each game can pay out from the shared
                pool. House reserves are kept separate and hidden.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN CONTENT: Games + Pool Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {/* Games Section */}
        <section id="games" className="mt-10 sm:mt-14 mb-12">
          <div className="mb-8 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-amber-50 mb-2">
              Pick Your Game
            </h2>
            <p className="text-sm sm:text-base text-zinc-300/90">
              Each game has its own pool cap for payouts, based on a slice of
              the main casino wallet.
            </p>
          </div>

          {/* Games Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gameCards.map((game) => (
              <Link key={game.id} href={game.route}>
                <div className="group relative h-72 rounded-xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-[1.03]">
                  {/* Gradient Accent */}
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${game.gradient} opacity-40 group-hover:opacity-60 transition-opacity duration-300`}
                  />

                  {/* Card Background */}
                  <div className="absolute inset-0 bg-zinc-950/85 backdrop-blur-md border border-zinc-700/70 group-hover:border-amber-500/60 transition-colors duration-300" />

                  {/* Image Placeholder Area */}
                  <div className="absolute inset-4 rounded-lg bg-zinc-900/70 border-2 border-dashed border-amber-500/50 group-hover:border-amber-400 flex items-center justify-center transition-all duration-300">
                    <div className="text-center">
                      <div className="text-6xl mb-2 drop-shadow-[0_0_12px_rgba(0,0,0,0.8)]">
                        {game.icon}
                      </div>
                      <p className="text-[11px] text-zinc-300/80">
                        Game art goes here
                      </p>
                    </div>
                  </div>

                  {/* Content Overlay */}
                  <div className="absolute inset-0 flex flex-col justify-end p-6 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
                    <h3 className="text-xl font-bold text-amber-50 mb-1">
                      {game.name}
                    </h3>
                    <p className="text-zinc-300/90 text-sm mb-2">
                      {game.description || "Saturday night special."}
                    </p>

                    {/* Pool snippet */}
                    <div className="flex items-center justify-between text-[11px] mb-2">
                      <span className="text-zinc-300/80">
                        Game pool cap (payouts)
                      </span>
                      <span className="text-amber-300 font-semibold">
                        {game.poolAmount.toFixed(2)} USDC
                      </span>
                    </div>

                    <button className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-amber-500/40 group-hover:translate-y-0 transform translate-y-2">
                      Play Now
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Game Pool Breakdown Section (instead of “players live stats”) */}
        <section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Total game pool */}
          <div className="p-6 rounded-lg bg-zinc-950/80 backdrop-blur-md border border-emerald-500/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-400 text-sm mb-2">Total Game Pool</p>
                <p className="text-2xl font-bold text-amber-50">
                  {formattedGamePool} USDC
                </p>
              </div>
              <Dices className="w-8 h-8 text-emerald-400/60" />
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              This is the combined amount all games can pay out across all
              active sessions, excluding the house reserve.
            </p>
          </div>

          {/* Top game by pool */}
          <div className="p-6 rounded-lg bg-zinc-950/80 backdrop-blur-md border border-rose-500/40">
            {gameCards.length > 0 ? (
              <>
                {(() => {
                  const topGame = [...gameCards].sort(
                    (a, b) => b.poolAmount - a.poolAmount
                  )[0];
                  return (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-zinc-400 text-sm mb-2">
                          Hottest Game Pool
                        </p>
                        <p className="text-base font-semibold text-amber-50 flex items-center gap-2">
                          <span className="text-xl">{topGame.icon}</span>
                          {topGame.name}
                        </p>
                        <p className="text-2xl font-bold text-amber-50 mt-2">
                          {topGame.poolAmount.toFixed(2)} USDC
                        </p>
                      </div>
                      <div className="text-right text-xs text-zinc-400">
                        <p>Share of game pool:</p>
                        <p className="text-rose-300 font-semibold mt-1">
                          {topGame.pctOfGamePool.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                Configure at least one enabled game in{" "}
                <code className="text-amber-300">casinoConfig.ts</code> to see
                pool stats here.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

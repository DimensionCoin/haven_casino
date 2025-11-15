// app/(public)/page.tsx
"use client";

"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import WalletButton from "@/components/web3/ConnectWallet";
import { Sparkles } from "lucide-react";

type Game = {
  id: number;
  name: string;
  description: string;
  vibe: string;
  icon: string;
};

const games: Game[] = [
  {
    id: 1,
    name: "Slots",
    description: "Classic machines with that perfect spin feeling.",
    vibe: "Chill",
    icon: "🎰",
  },
  {
    id: 2,
    name: "Dice Roll",
    description: "Roll high, roll low, pure luck and banter.",
    vibe: "Quick",
    icon: "🎲",
  },
  {
    id: 3,
    name: "Roulette",
    description: "Spin the wheel and call your number.",
    vibe: "Intense",
    icon: "🎡",
  },
  {
    id: 4,
    name: "High/Low",
    description: "Higher or lower – trust your gut.",
    vibe: "Fast",
    icon: "📊",
  },
  {
    id: 5,
    name: "Coin Toss",
    description: "Heads or tails, double or nothing.",
    vibe: "50 / 50",
    icon: "🪙",
  },
  {
    id: 6,
    name: "Mystery Game",
    description: "The wild card of the night.",
    vibe: "Wild",
    icon: "❓",
  },
];


export default function Home() {
  return (
    <main className="min-h-screen bg-[#050608] text-amber-50">
      {/* HERO SECTION */}
      <section className="relative w-full min-h-[520px] sm:min-h-[560px] lg:min-h-[620px] overflow-hidden">
        {/* Hero image */}
        <div className="absolute inset-0">
          <Image
            src="/landing.jpg" // your casino tattoo girl image
            alt="Celler Saturday Night Games"
            fill
            priority
            className="object-cover"
          />
          {/* Dark + warm overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/75 to-[#050608]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(248,250,252,0.12),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(251,191,36,0.30),_transparent_60%)]" />
        </div>

        {/* Content */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-10 sm:pb-16 flex flex-col">
          {/* Top bar (logo + wallet) */}
          <header className="flex items-center justify-between h-14 mb-6 sm:mb-10">
            <Link
              href="/"
              className="flex items-center gap-3 hover:opacity-95 transition-opacity"
            >
              <div className="relative h-9 w-9 sm:h-11 sm:w-11">
                <Image
                  src="/logo.png"
                  alt="Celler logo"
                  fill
                  className="object-contain drop-shadow-[0_0_12px_rgba(0,0,0,0.6)]"
                  priority
                />
              </div>
              <div className="flex flex-col">
                <span className="text-xl sm:text-2xl font-semibold tracking-tight">
                  Celler
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em] text-amber-200/80">
                  Saturday Night Games
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <WalletButton />
            </div>
          </header>

          {/* Hero copy */}
          <div className="flex-1 flex flex-col md:flex-row items-center justify-between gap-8 sm:gap-10">
            {/* Left side – text */}
            <div className="max-w-xl">
              <p className="inline-flex items-center text-[10px] sm:text-xs font-semibold uppercase tracking-[0.25em] text-amber-200/90 bg-black/40 px-3 py-1 rounded-full border border-amber-500/60 mb-4">
                <Sparkles className="w-3 h-3 mr-2 text-amber-300" />
                Basement Casino With The Boys
              </p>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
                Welcome to
                <span className="block text-amber-400 drop-shadow-[0_0_22px_rgba(251,191,36,0.45)]">
                  Celler Nights
                </span>
              </h1>

              <div className="flex flex-wrap items-center gap-3">
                <a href="#games">
                  <Button className="px-6 py-2.5 rounded-full bg-amber-500 text-zinc-900 text-sm font-semibold shadow-lg shadow-amber-500/40 hover:bg-amber-400 transition">
                    Peek the Games
                  </Button>
                </a>
                <span className="text-[11px] sm:text-xs text-zinc-200/80">
                  Sign in with your wallet to start playing.
                </span>
              </div>
            </div>

            {/* Right – house rules / disclaimer card */}
            <div className="w-full max-w-sm">
              <div className="rounded-2xl bg-black/75 backdrop-blur-xl border border-rose-700/70 shadow-[0_0_40px_rgba(0,0,0,0.9)] p-5">
                {/* Title row */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-rose-300/80">
                      House Rules
                    </p>
                    <p className="text-lg font-semibold text-amber-50">
                      Celler Basement Casino
                    </p>
                  </div>
                  <div className="flex items-center justify-center h-8 w-8 rounded-full border border-rose-700/70 bg-black/60 text-sm">
                    🎲
                  </div>
                </div>

                {/* Rules list */}
                <ul className="space-y-2 text-[11px] sm:text-xs text-zinc-100/90">
                  <li>
                    • We play with real money. Every bet is your responsibility.
                  </li>
                  <li>
                    • Celler isn&apos;t responsible for any losses — this is
                    between you and the boys.
                  </li>
                  <li>
                    • Play to have fun, not to chase. Wins are a bonus, not a
                    promise.
                  </li>
                  <li>
                    • Know your limit, play within it. Take breaks. Walk away if
                    it&apos;s not fun.
                  </li>
                </ul>

                {/* Fine print */}
                <p className="mt-4 text-[10px] text-zinc-400 leading-relaxed border-t border-zinc-700/60 pt-3">
                  By hanging out in the Celler and playing these games,
                  you&apos;re agreeing you understand the risks and are cool
                  with them. No tilt, no drama — just good vibes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GAMES SECTION */}
      <section
        id="games"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16"
      >
        <div className="mb-8 sm:mb-10 text-center sm:text-left">
          <h2 className="text-2xl sm:text-3xl font-bold text-amber-50 mb-2">
            Pick Your Poison
          </h2>
          <p className="text-sm sm:text-base text-zinc-300/90 max-w-xl mx-auto sm:mx-0">
            Warm up the crew and pick a table. Every game tells a different
            Saturday story.
          </p>
        </div>

        {/* Games grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {games.map((game) => (
            <div
              key={game.id}
              className="group relative h-64 rounded-xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-[1.02]"
            >
              {/* Gradient accent */}
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/25 via-rose-600/25 to-emerald-500/25 opacity-50 group-hover:opacity-70 transition-opacity duration-300" />

              {/* Card bg */}
              <div className="absolute inset-0 bg-zinc-950/90 backdrop-blur-lg border border-zinc-800/80 group-hover:border-amber-500/70 transition-colors duration-300" />

              {/* Emoji / placeholder art */}
              <div className="absolute inset-4 rounded-lg bg-zinc-900/70 border border-dashed border-amber-500/50 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-5xl mb-2 drop-shadow-[0_0_15px_rgba(0,0,0,0.9)]">
                    {game.icon}
                  </div>
                  <p className="text-[11px] text-zinc-300/85">
                    Custom art coming soon
                  </p>
                </div>
              </div>

              {/* Text overlay */}
              <div className="absolute inset-0 flex flex-col justify-end p-5 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
                <h3 className="text-lg font-semibold text-amber-50 mb-1">
                  {game.name}
                </h3>
                <p className="text-xs text-zinc-300/90 mb-2">
                  {game.description}
                </p>
                <p className="text-[11px] text-amber-300/90 mb-3">
                  Vibe: {game.vibe}
                </p>

                <WalletButton />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative px-4 sm:px-6 lg:px-8 py-12 sm:py-16 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-amber-500/20 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-amber-50">
            Ready for Saturday Night?
          </h2>
          <p className="text-sm sm:text-base text-zinc-200/90 mb-8">
            Connect your wallet, grab your spot at the table, and let Celler
            turn a normal night into a story the boys won&apos;t shut up about.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <WalletButton />
            <Button
              size="lg"
              variant="outline"
              className="border-zinc-600 text-sm h-11 text-zinc-100 hover:bg-zinc-900/80"
            >
              Just Browsing the Vibes
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

// providers/CasinoProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import {
  CASINO_GAMES,
  HOUSE_POOL_PCT,
  ROULETTE_POOL_PCT,
  type CasinoGameConfig,
} from "@/lib/casinoConfig";

/* ========= Types ========= */

export type CasinoGameRuntime = CasinoGameConfig & {
  poolPct: number; // fraction of casino virtual balance (0–1)
  poolAmount: number; // chips this game may touch (1 chip = 1 USDC)
};

type CasinoContextValue = {
  loading: boolean;
  error: string | null;

  // 🔥 Interpreted as "casino virtual chip float" (1 chip = 1 USDC)
  treasuryUsdcBalance: number; // actually: casino virtual balance

  houseReserve: number; // chips reserved for house, not exposed to games
  gamesTotalPool: number; // sum of all game pool amounts (in chips)

  games: CasinoGameRuntime[];

  // Extra stats
  chipsInCirculation: number; // global minted chips (users + house)
  backingUsdcBalance: number; // real on-chain USDC in CASINO_WALLET

  refreshCasino: () => Promise<void>;
};

const CasinoContext = createContext<CasinoContextValue | undefined>(undefined);

/* ========= Provider ========= */

export const CasinoProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [treasuryUsdcBalance, setTreasuryUsdcBalance] = useState<number>(0);
  const [houseReserve, setHouseReserve] = useState<number>(0);
  const [gamesTotalPool, setGamesTotalPool] = useState<number>(0);
  const [games, setGames] = useState<CasinoGameRuntime[]>([]);

  const [chipsInCirculation, setChipsInCirculation] = useState<number>(0);
  const [backingUsdcBalance, setBackingUsdcBalance] = useState<number>(0);

  const fetchCasino = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/admin/casino/overview", {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        throw new Error(data?.error || "Failed to load casino overview");
      }

      // ---------------- Raw numbers from API ----------------
      // casino virtual chips (house float)
      const casinoVirtualBalance = Number(
        data.vault?.casinoVirtualBalance ?? data.casino?.virtualChips ?? 0
      );

      // on-chain USDC in the casino wallet
      const backingUsdcVal = Number(data.casino?.usdcOnChain ?? 0);

      // global chip supply (users + house)
      const chipsInCircVal = Number(data.vault?.chipsInCirculation ?? 0);

      // ---------------- Pool math (based on casino virtual balance) ----------------
      // 1) House reserve: fixed HOUSE_POOL_PCT of total casino float
      const houseReserveVal = casinoVirtualBalance * HOUSE_POOL_PCT;

      // 2) Enabled games
      const enabledGames = CASINO_GAMES.filter((g) => g.enabled);
      const rouletteEnabled = enabledGames.some((g) => g.id === "roulette");

      // 3) Roulette gets ROULETTE_POOL_PCT of total float if enabled
      const roulettePoolPct = rouletteEnabled ? ROULETTE_POOL_PCT : 0;

      // 4) Remaining % to distribute across non-roulette games
      const remainingPct = Math.max(0, 1 - HOUSE_POOL_PCT - roulettePoolPct);

      const nonRouletteGames = enabledGames.filter((g) => g.id !== "roulette");
      const perGamePct =
        nonRouletteGames.length > 0
          ? remainingPct / nonRouletteGames.length
          : 0;

      // 5) Build runtime game objects
      const runtimeGames: CasinoGameRuntime[] = enabledGames.map((g) => {
        let poolPct: number;

        if (g.id === "roulette" && rouletteEnabled) {
          poolPct = roulettePoolPct;
        } else {
          poolPct = perGamePct;
        }

        const poolAmount = casinoVirtualBalance * poolPct;

        return {
          ...g,
          poolPct,
          poolAmount,
        };
      });

      const totalGamePool = runtimeGames.reduce(
        (sum, g) => sum + g.poolAmount,
        0
      );

      // ---------------- Commit to state ----------------
      setTreasuryUsdcBalance(casinoVirtualBalance); // house float
      setHouseReserve(houseReserveVal);
      setGamesTotalPool(totalGamePool);
      setGames(runtimeGames);
      setChipsInCirculation(chipsInCircVal);
      setBackingUsdcBalance(backingUsdcVal);
    } catch (err) {
      console.error("[CasinoProvider] fetchCasino error:", err);
      setError("Failed to load casino pools.");
      setTreasuryUsdcBalance(0);
      setHouseReserve(0);
      setGamesTotalPool(0);
      setGames([]);
      setChipsInCirculation(0);
      setBackingUsdcBalance(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCasino();
  }, [fetchCasino]);

  const value: CasinoContextValue = useMemo(
    () => ({
      loading,
      error,
      treasuryUsdcBalance,
      houseReserve,
      gamesTotalPool,
      games,
      chipsInCirculation,
      backingUsdcBalance,
      refreshCasino: fetchCasino,
    }),
    [
      loading,
      error,
      treasuryUsdcBalance,
      houseReserve,
      gamesTotalPool,
      games,
      chipsInCirculation,
      backingUsdcBalance,
      fetchCasino,
    ]
  );

  return (
    <CasinoContext.Provider value={value}>{children}</CasinoContext.Provider>
  );
};

/* ========= Hook ========= */

export const useCasino = (): CasinoContextValue => {
  const ctx = useContext(CasinoContext);
  if (!ctx) {
    throw new Error("useCasino must be used within a CasinoProvider");
  }
  return ctx;
};

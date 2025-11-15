// providers/UserProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Cluster,
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { usePathname, useRouter } from "next/navigation";

/* ========= Types ========= */

export type CasinoUser = {
  _id?: string;
  walletAddress: string;
  name?: string;

  // casino balance (virtual USDC / chips)
  virtualBalance?: number;

  // Backend fields you already have or may use soon
  email?: string;
  phone?: string;
  referralCode?: string;
  referredBy?: string | null;
  notificationsEnabled?: boolean;

  // Optional future stats/rewards etc.
  credits?: number;
  totalWinnings?: number;
  totalLosses?: number;
  notifications?: Array<{
    _id?: string;
    type: string;
    message: string;
    read?: boolean;
    createdAt?: string;
  }>;
  rewards?: Array<{
    _id?: string;
    type: string;
    amount?: number;
    description?: string;
    createdAt?: string;
  }>;

  createdAt?: string;
  updatedAt?: string;
};

type UserContextValue = {
  // wallet auth state
  isLoggedIn: boolean;
  address: string | null;

  // chain balances
  solBalance: number | null;
  usdcBalance: number | null;
  loadingBalances: boolean;
  refreshBalances: () => Promise<void>;

  // db user
  user: CasinoUser | null;
  userLoading: boolean;
  userError: string | null;
  refreshUser: () => Promise<void>;

  // casino virtual USDC
  virtualBalance: number; // always a number (0 if no account)
  refreshVirtualBalance: () => Promise<void>;

  // 🔥 NEW: refresh everything (SOL, USDC, virtual chips, user)
  refreshAll: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

/* ========= ENV / RPC ========= */

const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(NETWORK);
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "";

/* ========= Provider ========= */

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { publicKey, connected, connecting } = useWallet();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [user, setUser] = useState<CasinoUser | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  // virtual casino USDC
  const [virtualBalance, setVirtualBalance] = useState<number>(0);

  const router = useRouter();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);

  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);

  const address = publicKey?.toBase58() ?? null;
  const isLoggedIn = connected && !!publicKey;

  /* ========= Balances (SOL + USDC) ========= */

  const fetchBalances = useCallback(async () => {
    if (!isLoggedIn || !publicKey) {
      setSolBalance(null);
      setUsdcBalance(null);
      return;
    }

    try {
      setLoadingBalances(true);

      // Native SOL
      const lamports = await connection.getBalance(publicKey);
      setSolBalance(lamports / LAMPORTS_PER_SOL);

      // USDC (if configured)
      if (USDC_MINT) {
        try {
          const mintPk = new PublicKey(USDC_MINT);
          const ata = await getAssociatedTokenAddress(mintPk, publicKey);
          const { value } = await connection.getTokenAccountBalance(ata);
          const amount = value.uiAmount ?? 0;
          setUsdcBalance(amount);
        } catch (err) {
          console.warn("USDC balance fetch issue:", err);
          setUsdcBalance(0);
        }
      } else {
        setUsdcBalance(null);
      }
    } catch (err) {
      console.error("Error fetching balances:", err);
    } finally {
      setLoadingBalances(false);
    }
  }, [isLoggedIn, publicKey, connection]);

  /* ========= User from MongoDB (includes virtualBalance) ========= */

  const fetchUser = useCallback(async () => {
    if (!isLoggedIn || !address) {
      setUser(null);
      setUserError(null);
      setUserLoading(false);
      setVirtualBalance(0);
      return;
    }

    try {
      setUserLoading(true);
      setUserError(null);

      const res = await fetch(`/api/user/get?walletAddress=${address}`, {
        method: "GET",
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        setUser(null);
        setVirtualBalance(0);
        setUserError(data?.error || "Failed to load user");
        return;
      }

      const apiUser: CasinoUser | null = data.user ?? null;

      // Prefer API-level balance, fall back to user.virtualBalance, else 0
      const balanceFromApi: number =
        typeof data.balance === "number"
          ? data.balance
          : typeof apiUser?.virtualBalance === "number"
          ? apiUser.virtualBalance
          : 0;

      setUser(apiUser);
      setVirtualBalance(balanceFromApi);
    } catch (err) {
      console.error("Error fetching user:", err);
      setUser(null);
      setVirtualBalance(0);
      setUserError("Failed to load user");
    } finally {
      setUserLoading(false);
    }
  }, [isLoggedIn, address]);

  /* ========= Combined refresh (SOL + USDC + user + virtualBalance) ========= */

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchBalances(), fetchUser()]);
  }, [fetchBalances, fetchUser]);

  /* ========= Hydration guard ========= */

  useEffect(() => {
    setHydrated(true);
  }, []);

  /* ========= React to login / address changes ========= */

  useEffect(() => {
    if (!isLoggedIn) {
      setSolBalance(null);
      setUsdcBalance(null);
      setUser(null);
      setUserError(null);
      setVirtualBalance(0);
      return;
    }

    fetchBalances();
    fetchUser();
  }, [isLoggedIn, address, fetchBalances, fetchUser]);

  /* ========= Global route guard ========= */

  useEffect(() => {
    if (!hydrated) return;
    if (connecting) return;

    if (!isLoggedIn) {
      if (pathname !== "/") {
        router.replace("/");
      }
      return;
    }

    if (pathname === "/") {
      router.replace("/dashboard");
    }
  }, [hydrated, connecting, isLoggedIn, pathname, router]);

  /* ========= Context value ========= */

  const value = useMemo(
    () => ({
      isLoggedIn,
      address,

      solBalance,
      usdcBalance,
      loadingBalances,
      refreshBalances: fetchBalances,

      user,
      userLoading,
      userError,
      refreshUser: fetchUser,

      virtualBalance,
      refreshVirtualBalance: fetchUser,

      // 🔥 expose combined refresher
      refreshAll,
    }),
    [
      isLoggedIn,
      address,
      solBalance,
      usdcBalance,
      loadingBalances,
      user,
      userLoading,
      userError,
      virtualBalance,
      fetchBalances,
      fetchUser,
      refreshAll,
    ]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

/* ========= Hook ========= */

export const useUser = (): UserContextValue => {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return ctx;
};

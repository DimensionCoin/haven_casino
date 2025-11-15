// components/web3/ConnectWallet.tsx
"use client";

import React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletName } from "@solana/wallet-adapter-base";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import Image from "next/image";
import { useUser } from "@/providers/UserProvider";
import { useRouter } from "next/navigation";

const truncateAddress = (address: string, chars = 4): string => {
  if (!address) return "";
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
};

const ConnectWallet: React.FC = () => {
  const { publicKey, connected, connect, wallets, select } = useWallet();
  const { usdcBalance, virtualBalance, loadingBalances } = useUser();
  const router = useRouter();

  const handleConnect = async () => {
    try {
      const first = wallets[0];
      if (first) {
        select(first.adapter.name as WalletName);
      }
      await connect();
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    }
  };

  // DISCONNECTED STATE
  if (!connected || !publicKey) {
    return (
      <Button
        onClick={handleConnect}
        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-2 transition-all duration-200 hover:shadow-lg hover:shadow-primary/40 px-4 py-2 rounded-full text-sm"
      >
        <Wallet className="w-4 h-4" />
        <span>Sign In to Play</span>
      </Button>
    );
  }

  // CONNECTED STATE
  const address = publicKey.toBase58();

  return (
    <Button
      type="button"
      variant="outline"
      className="flex items-center gap-2 rounded-full px-3 py-2 text-xs sm:text-sm bg-card/60 border border-border/60 shadow-sm hover:bg-card/80 transition-all duration-200"
    >
      {/* Status + address (hide address on very small screens) */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="hidden sm:inline text-muted-foreground">
          {truncateAddress(address, 4)}
        </span>
      </div>

      {/* Divider */}
      <span className="h-4 w-px bg-border/60 mx-1" />

      {/* On-chain USDC balance */}
      <div className="flex items-center gap-1">
        <Image
          src="/usdc.png"
          alt="USDC"
          width={16}
          height={16}
          className="h-6 w-6 rounded-full"
        />
        <span className="text-foreground font-medium">
          {loadingBalances || usdcBalance === null
            ? "--"
            : usdcBalance.toFixed(2)}
        </span>
      </div>

      {/* Divider */}
      <span className="h-4 w-px bg-border/60 mx-1" />

      {/* Casino coin balance (virtual USDC) – CLICKABLE → /buy */}
      <div
        className="flex items-center gap-1 cursor-pointer hover:bg-muted/40 rounded-full px-2 py-1 -mr-1"
        onClick={(e) => {
          e.stopPropagation(); // don’t trigger parent button click
          router.push("/buy");
        }}
      >
        <Image
          src="/chipslogo.png"
          alt="USDC"
          width={16}
          height={16}
          className="h-8 w-8 rounded-full"
        />
        <span className="text-foreground font-medium">
          {loadingBalances ? "--" : virtualBalance.toFixed(2)}
        </span>
      </div>
    </Button>
  );
};

export default ConnectWallet;

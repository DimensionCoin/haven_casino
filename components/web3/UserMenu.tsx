"use client";

import React, { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Copy, User2, ShieldCheck } from "lucide-react";
import WalletAvatar from "@/components/ui/WalletAvatar";
import QuickCreateUserButton from "@/components/user/QuickCreateUserButton";
import { useUser } from "@/providers/UserProvider";
import { isAdminWallet } from "@/lib/admin";

const truncateAddress = (address: string, chars = 4): string => {
  if (!address) return "";
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
};

const UserMenu: React.FC = () => {
  const { publicKey, connected, disconnect } = useWallet();
  const { user } = useUser();

  // Safe address + connected flag
  const address = useMemo(
    () => (publicKey ? publicKey.toBase58() : ""),
    [publicKey]
  );
  const isConnected = connected && !!address;

  // Account is only considered "finalized" if it has a name
  const hasFinalizedAccount = useMemo(() => {
    const name = user?.name;
    if (!name || typeof name !== "string") return false;
    return name.trim().length > 0;
  }, [user]);

  const isAdmin = useMemo(
    () => (address ? isAdminWallet(address) : false),
    [address]
  );

  // ⬇️ early return AFTER all hooks have run – this is safe
  if (!isConnected) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch (err) {
      console.error("Failed to copy address:", err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (err) {
      console.error("Failed to disconnect wallet:", err);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full p-0 w-9 h-9 shrink-0"
          aria-label="User menu"
        >
          <WalletAvatar address={address} size={32} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {truncateAddress(address, 4)}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleCopy}
          className="cursor-pointer flex items-center gap-2"
        >
          <Copy className="w-3 h-3" />
          <span className="text-sm">Copy address</span>
        </DropdownMenuItem>

        <QuickCreateUserButton
          renderTrigger={(open /* hasAccount */) => (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                open();
              }}
              className="cursor-pointer flex items-center gap-2"
            >
              <User2 className="w-3 h-3" />
              <span className="text-sm">
                {hasFinalizedAccount ? "Open settings" : "Make account"}
              </span>
            </DropdownMenuItem>
          )}
        />

        {isAdmin && (
          <DropdownMenuItem
            asChild
            className="cursor-pointer flex items-center gap-2"
          >
            <Link href="/admin">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" />
                <span className="text-sm">Admin panel</span>
              </span>
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleDisconnect}
          className="cursor-pointer flex items-center gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="w-3 h-3" />
          <span className="text-sm">Disconnect</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;

// components/shared/Header.tsx
"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import ConnectWallet from "@/components/web3/ConnectWallet";
import UserMenu from "@/components/web3/UserMenu";

const Header: React.FC = () => {
  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur">
      <div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-3 sm:px-6 lg:px-8">
        {/* Left: Logo + Name */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 sm:gap-3 hover:opacity-95 transition-opacity"
        >
          <div className="relative h-10 w-10 sm:h-12 sm:w-12 shrink-0">
            <Image
              src="/logo.png"
              alt="Celler logo"
              fill
              className="object-contain drop-shadow-[0_0_12px_rgba(0,0,0,0.6)]"
              priority
            />
          </div>
          {/* Hide text on tiny screens to leave room for wallet + avatar */}
          <span className="hidden xs:inline text-lg sm:text-2xl font-semibold tracking-tight">
            Celler
          </span>
        </Link>

        {/* Right: Wallet + User avatar */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <ConnectWallet />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default Header;

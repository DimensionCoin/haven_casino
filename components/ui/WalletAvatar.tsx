// components/ui/WalletAvatar.tsx
"use client";

import React, { useMemo } from "react";
import clsx from "clsx";

type WalletAvatarProps = {
  address: string;
  size?: number; // px
  className?: string;
};

function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Keep it 32-bit
  }
  return Math.abs(hash);
}

const WalletAvatar: React.FC<WalletAvatarProps> = ({
  address,
  size = 32,
  className,
}) => {
  const { background, initials } = useMemo(() => {
    const hash = hashStringToNumber(address);

    const hue1 = hash % 360;
    const hue2 = (hash * 7) % 360;

    const bg = `linear-gradient(135deg, hsl(${hue1}, 70%, 50%), hsl(${hue2}, 70%, 40%))`;

    const clean = address.replace(/[^a-zA-Z0-9]/g, "");
    const first = clean.slice(0, 2).toUpperCase();

    return { background: bg, initials: first || "??" };
  }, [address]);

  return (
    <div
      className={clsx(
        "flex items-center justify-center rounded-full text-[0.6rem] font-semibold text-white shadow-sm",
        className
      )}
      style={{
        width: size,
        height: size,
        background,
      }}
      aria-label={`Avatar for wallet ${address}`}
    >
      {initials}
    </div>
  );
};

export default WalletAvatar;

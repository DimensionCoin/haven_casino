// lib/admin.ts

// Read once at build/runtime
const ADMIN_WALLETS: string[] = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || "")
  .split(",")
  .map((w) => w.trim())
  .filter(Boolean); // remove empty strings

export function isAdminWallet(walletAddress?: string | null): boolean {
  if (!walletAddress) return false;
  return ADMIN_WALLETS.includes(walletAddress);
}

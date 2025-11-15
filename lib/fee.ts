// lib/fee.ts

// Raw percent value from env, e.g. "1" => 1%
export const RAW_FEE_PERCENT = Number(
  process.env.NEXT_PUBLIC_CASINO_FEE_PERCENT ?? "0.1"
);

// Normalized rate (0.01 for 1%, 0.001 for 0.1%)
export const FEE_RATE = RAW_FEE_PERCENT / 100;

// Label for UI
export const FEE_LABEL =
  RAW_FEE_PERCENT % 1 === 0
    ? `${RAW_FEE_PERCENT.toFixed(0)}%`
    : `${RAW_FEE_PERCENT.toFixed(2)}%`;

// app/api/plinko/play/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  applyBetWithRake,
  applyPayout,
  getOrCreateVault,
} from "@/lib/chipVault";
import {
  PLINKO_RAKE_RATE,
  PLINKO_MAX_POOL_PCT_PER_BET,
} from "@/lib/plinko/config";
import { generatePlinkoOutcome } from "@/lib/plinko/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const walletAddressRaw = body?.walletAddress;
    const walletAddress =
      typeof walletAddressRaw === "string" ? walletAddressRaw.trim() : "";

    const betAmount = Number(body?.betAmount ?? 0);

    if (!walletAddress) {
      return NextResponse.json(
        { success: false, error: "Not authenticated: missing walletAddress" },
        { status: 401 }
      );
    }

    if (!Number.isFinite(betAmount) || betAmount <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid bet amount" },
        { status: 400 }
      );
    }

    // 1) Charge bet with rake: USER → casino + treasury
    await applyBetWithRake(walletAddress, betAmount, PLINKO_RAKE_RATE);

    // 2) Get current casino float to enforce a max payout cap
    const vault = await getOrCreateVault();
    const casinoFloat = Number(vault.casinoVirtualBalance ?? 0);

    // Max payout for a single Plinko win (chips)
    const maxPayoutForThisBet = casinoFloat * PLINKO_MAX_POOL_PCT_PER_BET;

    // 3) Generate random Plinko outcome (server-side)
    const outcome = generatePlinkoOutcome(betAmount);
    const { sinkIndex, multiplier, payoutAmount, point, pattern } = outcome;

    if (payoutAmount <= 0) {
      // Pure loss (if you ever add 0x rows)
      return NextResponse.json({
        success: true,
        walletAddress,
        betAmount,
        sinkIndex,
        multiplier,
        payoutAmount: 0,
        point,
        pattern,
      });
    }

    // 4) Enforce max payout cap for risk control
    if (payoutAmount > maxPayoutForThisBet) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Bet too large for current Plinko pool. Lower your stake or try again later.",
          details: {
            betAmount,
            requestedPayout: payoutAmount,
            maxPayoutForThisBet,
          },
        },
        { status: 400 }
      );
    }

    // 5) Pay out: CASINO → USER
    await applyPayout(walletAddress, payoutAmount);

    return NextResponse.json({
      success: true,
      walletAddress,
      betAmount,
      sinkIndex,
      multiplier,
      payoutAmount,
      point,
      pattern,
    });
  } catch (err: unknown) {
    console.error("[/api/plinko/play] error:", err);

    const message =
      err instanceof Error ? err.message : "Internal Plinko error";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

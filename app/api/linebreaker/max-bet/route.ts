// app/api/dice/max-bet/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getDiceMaxWinCap,
  computeDiceOdds,
  computeMaxBetForConfig,
} from "@/lib/dice";

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const targetStr = searchParams.get("target");
    const directionStr = searchParams.get("direction") as
      | "over"
      | "under"
      | null;

    if (!targetStr) {
      return NextResponse.json(
        { error: "target query param is required" },
        { status: 400 }
      );
    }

    const targetRaw = Number(targetStr);
    if (!Number.isFinite(targetRaw)) {
      return NextResponse.json(
        { error: "target must be a number" },
        { status: 400 }
      );
    }

    if (directionStr !== "over" && directionStr !== "under") {
      return NextResponse.json(
        { error: 'direction must be "over" or "under"' },
        { status: 400 }
      );
    }

    const target = Math.floor(targetRaw);
    if (target <= 0 || target >= 100) {
      return NextResponse.json(
        { error: "target must be between 1 and 99" },
        { status: 400 }
      );
    }

    // 1) Pool cap
    const maxWinCap = await getDiceMaxWinCap();
    if (maxWinCap <= 0) {
      return NextResponse.json(
        {
          error: "Dice pool is unavailable right now.",
        },
        { status: 503 }
      );
    }

    // 2) Odds + multiplier
    const odds = computeDiceOdds(target, directionStr);
    const maxBet = computeMaxBetForConfig({
      target: odds.target,
      direction: odds.direction,
      houseEdgePct: odds.houseEdgePct,
      maxWinCap,
    });

    return NextResponse.json(
      {
        success: true,
        target: odds.target,
        direction: odds.direction,
        winChance: odds.winChance,
        houseEdgePct: odds.houseEdgePct,
        multiplier: odds.multiplier, // payout (stake + profit) per 1 chip
        maxBet: roundToCents(maxBet),
        maxWinCap: roundToCents(maxWinCap),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[dice] GET /api/dice/max-bet error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

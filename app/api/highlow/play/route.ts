// app/api/highlow/play/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import UserModel, { type IUser } from "@/models/User";
import { playHighLow, type HighLowDirection } from "@/lib/highlow";

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function isValidDirection(value: unknown): value is HighLowDirection {
  return value === "higher" || value === "lower";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const walletAddress = body?.walletAddress as string | undefined;
    const betAmountRaw = body?.betAmount as number | undefined; // current ladder pot
    const rawDirection = body?.direction as string | undefined;
    const initialNumberBody = body?.initialNumber as number | undefined;

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    if (
      betAmountRaw === undefined ||
      typeof betAmountRaw !== "number" ||
      betAmountRaw <= 0
    ) {
      return NextResponse.json(
        { error: "betAmount must be a positive number" },
        { status: 400 }
      );
    }

    if (!isValidDirection(rawDirection)) {
      return NextResponse.json(
        { error: 'direction must be "higher" or "lower"' },
        { status: 400 }
      );
    }

    if (typeof initialNumberBody !== "number") {
      return NextResponse.json(
        { error: "initialNumber is required to resolve the round" },
        { status: 400 }
      );
    }

    const direction: HighLowDirection = rawDirection;
    const betAmount = roundToCents(betAmountRaw);

    // 🔥 NO BET/Rake HERE – that already happened in /start.
    // This just computes the ladder outcome for the current pot.
    const outcome = await playHighLow(betAmount, direction, initialNumberBody);

    await connectDb();
    const userAfter = await UserModel.findOne({ walletAddress })
      .lean<IUser>()
      .exec();

    if (!userAfter) {
      return NextResponse.json({ error: "User not found" }, { status: 500 });
    }

    const userVirtualBalance =
      typeof userAfter.virtualBalance === "number"
        ? roundToCents(userAfter.virtualBalance)
        : 0;

    return NextResponse.json(
      {
        success: true,
        walletAddress,
        betAmount, // pot used for this guess
        direction,
        // Game outcome
        initialNumber: outcome.initialNumber,
        nextNumber: outcome.nextNumber,
        isWin: outcome.isWin,
        isLoss: outcome.isLoss,
        isPush: outcome.isPush,
        rawPayout: outcome.rawPayout,
        totalWinAfterCap: outcome.finalPayout,
        maxWinCap: outcome.maxWinCap,
        cappedByPool: outcome.cappedByPool,

        // Ladder info (for frontend)
        potBefore: outcome.potBefore,
        potAfter: outcome.potAfter,

        // Balance (unchanged during ladder)
        userVirtualBalance,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[highlow/play] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

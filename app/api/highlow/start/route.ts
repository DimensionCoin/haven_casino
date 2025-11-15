// app/api/highlow/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import UserModel, { type IUser } from "@/models/User";
import { applyBetWithRake } from "@/lib/chipVault";
import { getHighLowInitialNumber } from "@/lib/highlow";

const HIGHLOW_TREASURY_FEE_RATE = 0.01; // ✅ 1% to Treasury, 99% to casino

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const walletAddress = body?.walletAddress as string | undefined;
    const betAmountRaw = body?.betAmount as number | undefined;

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

    const betAmount = roundToCents(betAmountRaw);

    await connectDb();

    // 1) TAKE THE BET ONCE (WITH 1% TREASURY RAKE)
    try {
      await applyBetWithRake(
        walletAddress,
        betAmount,
        HIGHLOW_TREASURY_FEE_RATE
      );
    } catch (err) {
      console.error("[highlow/start] applyBetWithRake error:", err);
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("User not found")) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      if (msg.includes("Insufficient chips")) {
        const user = await UserModel.findOne({ walletAddress })
          .lean<IUser>()
          .exec();

        return NextResponse.json(
          {
            error: "Insufficient virtual balance",
            virtualBalance:
              typeof user?.virtualBalance === "number"
                ? roundToCents(user.virtualBalance)
                : 0,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "Failed to apply bet" },
        { status: 500 }
      );
    }

    // 2) GENERATE FIRST NUMBER FOR THE LADDER (1–100)
    const initialNumber = getHighLowInitialNumber();

    // 3) FETCH UPDATED USER BALANCE FOR UI
    const user = await UserModel.findOne({ walletAddress })
      .lean<IUser>()
      .exec();

    const userVirtualBalance =
      typeof user?.virtualBalance === "number"
        ? roundToCents(user.virtualBalance)
        : 0;

    return NextResponse.json(
      {
        success: true,
        walletAddress,
        baseBet: betAmount,
        initialNumber,
        userVirtualBalance,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[highlow/start] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// app/api/highlow/cashout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import UserModel, { type IUser } from "@/models/User";
import { applyPayout } from "@/lib/chipVault";
import { getHighLowMaxWinCap } from "@/lib/highlow";

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const walletAddress = body?.walletAddress as string | undefined;
    const potAmountRaw = body?.potAmount as number | undefined; // current ladder pot the user wants to cash out

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    if (
      potAmountRaw === undefined ||
      typeof potAmountRaw !== "number" ||
      potAmountRaw <= 0
    ) {
      return NextResponse.json(
        { error: "potAmount must be a positive number" },
        { status: 400 }
      );
    }

    const requestedPot = roundToCents(potAmountRaw);

    // 🔥 Check High/Low pool cap again at cashout time
    const maxWinCapRaw = await getHighLowMaxWinCap();
    const maxWinCap = roundToCents(maxWinCapRaw);

    if (maxWinCap <= 0) {
      return NextResponse.json(
        {
          error: "High/Low pool is currently unavailable. Try again later.",
        },
        { status: 503 }
      );
    }

    const payablePot = Math.min(requestedPot, maxWinCap);
    const cappedByPool = payablePot < requestedPot;

    if (payablePot <= 0) {
      return NextResponse.json(
        {
          error: "Nothing to cash out.",
        },
        { status: 400 }
      );
    }

    await connectDb();

    // 1) PAY THE USER FROM CASINO POOL
    try {
      await applyPayout(walletAddress, payablePot);
    } catch (err) {
      console.error("[highlow/cashout] applyPayout error:", err);
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("User not found")) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json(
        { error: "Failed to apply payout" },
        { status: 500 }
      );
    }

    // 2) FETCH UPDATED USER BALANCE FOR UI
    const userAfter = await UserModel.findOne({ walletAddress })
      .lean<IUser>()
      .exec();

    if (!userAfter) {
      return NextResponse.json(
        { error: "User not found after cashout" },
        { status: 500 }
      );
    }

    const userVirtualBalance =
      typeof userAfter.virtualBalance === "number"
        ? roundToCents(userAfter.virtualBalance)
        : 0;

    return NextResponse.json(
      {
        success: true,
        walletAddress,

        // Requested vs actual payout
        requestedPot,
        payablePot,
        cappedByPool,
        maxWinCap,

        // Updated user balance
        userVirtualBalance,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[highlow/cashout] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

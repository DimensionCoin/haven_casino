// app/api/cointoss/play/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import UserModel, { type IUser } from "@/models/User";
import { applyBetWithRake, applyPayout } from "@/lib/chipVault";
import { playCoinToss, type CoinSide } from "@/lib/cointoss";

const COIN_TOSS_RAKE_RATE = 0.01;

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function isValidCoinSide(value: unknown): value is CoinSide {
  return value === "heads" || value === "tails";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const walletAddress = body?.walletAddress as string | undefined;
    const betAmountRaw = body?.betAmount as number | undefined;
    const rawChoice = body?.choice as string | undefined;

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

    if (!isValidCoinSide(rawChoice)) {
      return NextResponse.json(
        { error: 'choice must be "heads" or "tails"' },
        { status: 400 }
      );
    }

    const betAmount = roundToCents(betAmountRaw);
    const userChoice: CoinSide = rawChoice;

    // 1) Apply bet with rake (1%)
    //    - Debits the user
    //    - Splits bet between casino & treasury
    //    - Does NOT change chipsInCirculation
    const { casinoPortion, treasuryPortion } = await applyBetWithRake(
      walletAddress,
      betAmount,
      COIN_TOSS_RAKE_RATE
    );

    // If for some reason rake consumed everything (shouldn't happen), block game
    if (casinoPortion <= 0) {
      return NextResponse.json(
        { error: "Effective stake is zero after rake" },
        { status: 500 }
      );
    }

    // 2) Run coin toss on the casinoPortion (effective stake)
    const outcome = await playCoinToss({
      betAmount, // 👈 original user wager (pre-rake)
      effectiveStake: casinoPortion,
      userChoice,
    });

    // 3) On win, pay out from casino to user
    if (outcome.payoutAfterCap > 0 && outcome.isWin) {
      await applyPayout(walletAddress, outcome.payoutAfterCap);
    }

    // 4) Fetch updated user balance
    await connectDb();
    const userAfter = await UserModel.findOne({ walletAddress })
      .lean<IUser>()
      .exec();

    if (!userAfter) {
      return NextResponse.json(
        { error: "User not found after coin toss" },
        { status: 500 }
      );
    }

    const userVirtualBalance =
      typeof userAfter.virtualBalance === "number"
        ? roundToCents(userAfter.virtualBalance)
        : 0;

    // 5) Response payload for frontend
    return NextResponse.json(
      {
        success: true,
        walletAddress,
        betAmount, // what user wagered (pre-rake)
        rakeRate: COIN_TOSS_RAKE_RATE,
        feeForTreasury: treasuryPortion,
        effectiveStake: outcome.effectiveStake, // casinoPortion

        userChoice: outcome.userChoice,
        coinResult: outcome.landedSide,
        isWin: outcome.isWin,

        rawPayout: outcome.rawPayout,
        payoutAfterCap: outcome.payoutAfterCap,
        maxWinCap: outcome.maxWinCap,
        cappedByPool: outcome.cappedByPool,

        userVirtualBalance,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[cointoss/play] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

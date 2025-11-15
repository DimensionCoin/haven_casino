// app/api/dice/roll/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import UserModel, { type IUser } from "@/models/User";
import Treasury from "@/models/Treasury";
import {
  rollDice,
  getDiceMaxWinCap,
  computeDiceOdds,
  computeMaxBetForConfig,
} from "@/lib/dice";
import { applyBetWithRake, applyPayout } from "@/lib/chipVault";

// 10% of each bet goes to Treasury virtual wallet, 90% to casino virtual balance
const DICE_TREASURY_FEE_RATE = 0.1;

const TREASURY_WALLET = process.env.NEXT_PUBLIC_CASINO_TREASURY_WALLET;

if (!TREASURY_WALLET) {
  console.warn(
    "[dice] NEXT_PUBLIC_CASINO_TREASURY_WALLET not set. Treasury doc will not be identifiable."
  );
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const walletAddress = body?.walletAddress as string | undefined;
    const betAmountRaw = body?.betAmount as number | undefined;
    const targetRaw = body?.target as number | undefined;
    const direction = body?.direction as "over" | "under" | undefined;

    /* =========================================================================
       0) BASIC VALIDATION
       ========================================================================= */

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

    if (
      targetRaw === undefined ||
      typeof targetRaw !== "number" ||
      !Number.isFinite(targetRaw)
    ) {
      return NextResponse.json(
        { error: "target must be a number between 1 and 99" },
        { status: 400 }
      );
    }

    if (direction !== "over" && direction !== "under") {
      return NextResponse.json(
        { error: 'direction must be "over" or "under"' },
        { status: 400 }
      );
    }

    // Clamp / sanitize
    const betAmount = roundToCents(betAmountRaw);
    const target = Math.floor(targetRaw);

    if (target <= 0 || target >= 100) {
      return NextResponse.json(
        { error: "target must be between 1 and 99" },
        { status: 400 }
      );
    }

    /* =========================================================================
       0.5) MAX-BET GUARD (POOL-SAFE)
       ========================================================================= */

    let maxBetForConfig = 0;
    let maxWinCap = 0;

    try {
      maxWinCap = await getDiceMaxWinCap();

      if (maxWinCap <= 0) {
        // Pool is empty or RPC failed → safest is to block betting
        return NextResponse.json(
          {
            error:
              "Dice pool is unavailable right now. Please try again later.",
          },
          { status: 503 }
        );
      }

      const odds = computeDiceOdds(target, direction);
      maxBetForConfig = computeMaxBetForConfig({
        target: odds.target,
        direction: odds.direction,
        houseEdgePct: odds.houseEdgePct,
        maxWinCap,
      });

      if (betAmount > maxBetForConfig && maxBetForConfig > 0) {
        return NextResponse.json(
          {
            error: "Bet exceeds max allowed for current dice pool",
            maxBet: maxBetForConfig,
            maxWinCap,
          },
          { status: 400 }
        );
      }
    } catch (err) {
      console.error("[dice] maxBet guard check failed", err);
      return NextResponse.json(
        { error: "Dice pool check failed. Please try again." },
        { status: 503 }
      );
    }

    await connectDb();

    /* =========================================================================
       1) APPLY BET WITH RAKE (USER -> CASINO + TREASURY)
       ========================================================================= */

    let feeForTreasury = 0;

    try {
      const { treasuryPortion } = await applyBetWithRake(
        walletAddress,
        betAmount,
        DICE_TREASURY_FEE_RATE
      );
      feeForTreasury = treasuryPortion;
    } catch (err) {
      console.error("[dice] applyBetWithRake error:", err);
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

    /* =========================================================================
       2) RUN DICE RNG + POOL CAPPING
       ========================================================================= */

    let outcome;
    try {
      outcome = await rollDice({
        betAmount,
        target,
        direction,
      });
    } catch (err) {
      console.error("[dice] rollDice error:", err);
      return NextResponse.json(
        { error: "Failed to roll dice" },
        { status: 500 }
      );
    }

    const winAmount = roundToCents(outcome.payoutAfterCap);

    /* =========================================================================
       3) APPLY PAYOUT (CASINO -> USER) IF WIN > 0
       ========================================================================= */

    if (outcome.win && winAmount > 0) {
      try {
        await applyPayout(walletAddress, winAmount);
      } catch (err) {
        console.error("[dice] applyPayout error:", err);
        // Serious issue: casino couldn't pay a valid win.
        return NextResponse.json(
          { error: "Failed to apply payout" },
          { status: 500 }
        );
      }
    }

    /* =========================================================================
       4) FETCH FINAL USER BALANCE + TREASURY BALANCE FOR UI
       ========================================================================= */

    type TreasuryDoc = { virtualBalance?: number } | null;

    const [userAfter, treasuryDoc] = await Promise.all([
      UserModel.findOne({ walletAddress }).lean<IUser>().exec(),
      TREASURY_WALLET
        ? (Treasury.findOne({ walletAddress: TREASURY_WALLET })
            .lean<TreasuryDoc>()
            .exec() as Promise<TreasuryDoc>)
        : Promise.resolve(null),
    ]);

    if (!userAfter) {
      // Should never happen if bet/payout succeeded
      return NextResponse.json(
        { error: "User not found after roll" },
        { status: 500 }
      );
    }

    const userVirtualBalance =
      typeof userAfter.virtualBalance === "number"
        ? roundToCents(userAfter.virtualBalance)
        : 0;

    const treasuryVirtualBalance =
      treasuryDoc && typeof treasuryDoc.virtualBalance === "number"
        ? roundToCents(treasuryDoc.virtualBalance)
        : 0;

    /* =========================================================================
       5) RESPOND WITH OUTCOME + UPDATED BALANCES
       ========================================================================= */

    return NextResponse.json(
      {
        success: true,
        walletAddress,
        betAmount,
        feeForTreasury, // 10% rake in chips that went to Treasury

        // Game inputs
        target: outcome.target,
        direction: outcome.direction,

        // RNG + odds
        roll: outcome.roll,
        winChance: outcome.winChance,
        houseEdgePct: outcome.houseEdgePct,
        multiplierBeforeCap: outcome.multiplierBeforeCap,

        // Result
        win: outcome.win,
        payoutBeforeCap: outcome.payoutBeforeCap,
        payoutAfterCap: winAmount,
        profitBeforeCap: outcome.profitBeforeCap,
        profitAfterCap: outcome.profitAfterCap,
        cappedByPool: outcome.cappedByPool,
        maxWinCap: outcome.maxWinCap,

        // Updated balances
        userVirtualBalance,
        treasuryVirtualBalance,
        // For UX you also already know maxBetForConfig here if you want to echo it:
        maxBetForConfig,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[dice] roll error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// app/api/slots/spin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import UserModel, { type IUser } from "@/models/User";
import Treasury from "@/models/Treasury";
import { spinSlots } from "@/lib/slots";
import { applyBetWithRake, applyPayout } from "@/lib/chipVault";

// 10% of each bet goes to Treasury virtual wallet, 90% to casino virtual balance
const SLOT_TREASURY_FEE_RATE = 0.1;

const TREASURY_WALLET = process.env.NEXT_PUBLIC_CASINO_TREASURY_WALLET;

if (!TREASURY_WALLET) {
  console.warn(
    "[slots] NEXT_PUBLIC_CASINO_TREASURY_WALLET not set. Treasury doc will not be identifiable."
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
    const isFreeSpin = body?.isFreeSpin === true; // 🔥 NEW

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

    // Round to 2 decimals (USDC style)
    const betAmount = roundToCents(betAmountRaw);

    await connectDb();

    /* =========================================================================
       1) APPLY BET WITH RAKE (USER -> CASINO + TREASURY) FOR PAID SPINS ONLY
       ========================================================================= */

    let feeForTreasury = 0;

    if (!isFreeSpin) {
      try {
        const { treasuryPortion } = await applyBetWithRake(
          walletAddress,
          betAmount,
          SLOT_TREASURY_FEE_RATE
        );
        feeForTreasury = treasuryPortion;
      } catch (err) {
        console.error("[slots] applyBetWithRake error:", err);
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("User not found")) {
          return NextResponse.json(
            { error: "User not found" },
            { status: 404 }
          );
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
                  ? user.virtualBalance
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
    } else {
      // Free spin: we still make sure the user exists, but do NOT charge them.
      const user = await UserModel.findOne({ walletAddress })
        .lean<IUser>()
        .exec();

      if (!user) {
        return NextResponse.json(
          { error: "User not found for free spin" },
          { status: 404 }
        );
      }

      feeForTreasury = 0;
    }

    /* =========================================================================
       2) RUN SLOTS RNG + POOL CAPPING
       ========================================================================= */

    const outcome = await spinSlots(betAmount);
    const winAmount = roundToCents(outcome.totalWinAfterCap);

    /* =========================================================================
       3) APPLY PAYOUT (CASINO -> USER) IF WIN > 0
       ========================================================================= */

    if (winAmount > 0) {
      try {
        await applyPayout(walletAddress, winAmount);
      } catch (err) {
        console.error("[slots] applyPayout error:", err);
        // If this fails, that's serious: casino couldn't pay a valid win.
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
      // This should never happen if bet/payout succeeded
      return NextResponse.json(
        { error: "User not found after spin" },
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

    return NextResponse.json(
      {
        success: true,
        walletAddress,
        betAmount,
        isFreeSpin, // 🔥 NEW: tells the client what this spin was
        feeForTreasury,
        // Game outcome
        grid: outcome.grid,
        lineWins: outcome.lineWins,
        totalWinBeforeCap: outcome.totalWinBeforeCap,
        totalWinAfterCap: winAmount,
        cappedByPool: outcome.cappedByPool,
        maxWinCap: outcome.maxWinCap,
        freeSpins: outcome.freeSpins, // 🔥 NEW: number of bonus spins awarded
        // Updated balances
        userVirtualBalance,
        treasuryVirtualBalance,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[slots] spin error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

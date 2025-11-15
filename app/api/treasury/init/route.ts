// app/api/treasury/init/route.ts
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import Treasury, { type ITreasury } from "@/models/Treasury";

export async function GET() {
  try {
    // Optional: lock this to dev only for now
    // if (process.env.NODE_ENV !== "development") {
    //   return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    // }

    const wallet = process.env.CASINO_TREASURY_WALLET;
    if (!wallet) {
      return NextResponse.json(
        { error: "CASINO_TREASURY_WALLET is not set in env" },
        { status: 400 }
      );
    }

    await connectDb();

    const treasuryDoc: ITreasury = (await Treasury.findOneAndUpdate(
      { walletAddress: wallet },
      {
        $setOnInsert: {
          walletAddress: wallet,
          virtualBalance: 0,
          totalFeesCollected: 0,
          notes: "Primary casino treasury wallet",
        },
      },
      { new: true, upsert: true }
    ).lean<ITreasury>()) as ITreasury;

    return NextResponse.json(
      {
        ok: true,
        treasury: {
          walletAddress: treasuryDoc.walletAddress,
          virtualBalance: treasuryDoc.virtualBalance,
          totalFeesCollected: treasuryDoc.totalFeesCollected,
          createdAt: treasuryDoc.createdAt,
          updatedAt: treasuryDoc.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[/api/treasury/init] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

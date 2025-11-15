// app/api/user/get/route.ts
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import User from "@/models/User";
import type { Types } from "mongoose";

// This matches what we care about from Mongo,
// but with a concrete _id + Date types.
type UserLeanMongo = {
  _id: Types.ObjectId;
  walletAddress: string;
  name?: string;
  virtualBalance?: number;

  email?: string;
  phone?: string;
  referralCode?: string;
  referredBy?: string;
  notificationsEnabled?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
};

// What we actually send to the client (string IDs, ISO dates)
type UserResponse = {
  _id: string;
  walletAddress: string;
  name?: string;
  virtualBalance: number;

  email?: string;
  phone?: string;
  referralCode?: string;
  referredBy?: string;
  notificationsEnabled: boolean;

  createdAt?: string;
  updatedAt?: string;
};

export async function GET(req: Request) {
  try {
    await connectDb();

    const url = new URL(req.url);
    const searchParams = url.searchParams;

    // Support both ?walletAddress= and ?address=
    const walletAddress =
      searchParams.get("walletAddress") || searchParams.get("address");

    if (!walletAddress) {
      return NextResponse.json(
        { error: "walletAddress query param is required" },
        { status: 400 }
      );
    }

    const normalizedWallet = walletAddress.trim();

    const doc = await User.findOne({
      walletAddress: normalizedWallet,
    })
      .lean<UserLeanMongo>()
      .exec();

    // No user yet → null + balance 0 so frontend can show "Make account"
    if (!doc) {
      return NextResponse.json(
        {
          user: null,
          balance: 0,
        },
        { status: 200 }
      );
    }

    // Ensure virtualBalance is always a safe number
    const virtualBalance =
      typeof doc.virtualBalance === "number" && doc.virtualBalance >= 0
        ? doc.virtualBalance
        : 0;

    const user: UserResponse = {
      _id: doc._id.toString(),
      walletAddress: doc.walletAddress,
      name: doc.name,

      virtualBalance,

      email: doc.email ?? undefined,
      phone: doc.phone ?? undefined,
      referralCode: doc.referralCode ?? undefined,
      referredBy: doc.referredBy ?? undefined,
      notificationsEnabled:
        typeof doc.notificationsEnabled === "boolean"
          ? doc.notificationsEnabled
          : true,

      createdAt:
        doc.createdAt instanceof Date ? doc.createdAt.toISOString() : undefined,
      updatedAt:
        doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : undefined,
    };

    return NextResponse.json(
      {
        user,
        balance: virtualBalance, // casino USDC balance (chips)
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/user/get error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

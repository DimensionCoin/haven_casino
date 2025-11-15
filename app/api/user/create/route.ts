// app/api/user/create/route.ts
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import User, { type IUser } from "@/models/User";

/* ===================== Helpers ===================== */

const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const REFERRAL_LENGTH = 8;

function generateReferralCodeString(): string {
  let out = "";
  for (let i = 0; i < REFERRAL_LENGTH; i++) {
    const idx = Math.floor(Math.random() * REFERRAL_ALPHABET.length);
    out += REFERRAL_ALPHABET[idx];
  }
  return out;
}

async function generateUniqueReferralCode(): Promise<string> {
  // Try a few times before giving up
  for (let i = 0; i < 10; i++) {
    const candidate = generateReferralCodeString();
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;
  }
  throw new Error("Failed to generate unique referral code");
}

/* ===================== Route ===================== */

export async function POST(req: Request) {
  try {
    await connectDb();

    const body = await req.json().catch(() => null);

    const walletAddress = body?.walletAddress as string | undefined;
    const name = body?.name as string | undefined;
    // In the future you can accept an inviter's referral code here:
    // const usedReferralCode = body?.referralCode as string | undefined;

    if (!walletAddress || typeof walletAddress !== "string") {
      return NextResponse.json(
        { error: "walletAddress is required" },
        { status: 400 }
      );
    }

    const normalizedWallet = walletAddress.trim();

    // Very basic sanity – you can tighten this if you want
    if (normalizedWallet.length < 32) {
      return NextResponse.json(
        { error: "walletAddress looks invalid" },
        { status: 400 }
      );
    }

    /* ----- See if user already exists ----- */

    let user = (await User.findOne({
      walletAddress: normalizedWallet,
    }).lean<IUser>()) as IUser | null;

    const now = new Date();

    if (user) {
      // Existing user: patch missing fields

      const update: Record<string, unknown> = {
        lastSeenAt: now,
      };

      if (typeof name === "string" && name.trim().length > 0) {
        update.name = name.trim();
      }

      // Backfill virtualBalance if missing
      if (typeof user.virtualBalance !== "number") {
        update.virtualBalance = 0;
      }

      // Backfill referralCode if missing
      if (!user.referralCode) {
        const newCode = await generateUniqueReferralCode();
        update.referralCode = newCode;
      }

      // Only hit DB if we actually have something to update
      if (Object.keys(update).length > 0) {
        user = (await User.findOneAndUpdate(
          { _id: user._id },
          { $set: update },
          { new: true }
        ).lean<IUser>()) as IUser;
      }
    } else {
      // New user: create with fresh referralCode
      const referralCode = await generateUniqueReferralCode();

      user = (await User.create({
        walletAddress: normalizedWallet,
        avatarSeed: normalizedWallet, // if you use this in WalletAvatar
        name: name?.trim() || undefined,
        virtualBalance: 0,
        referralCode,
        notificationsEnabled: true,
        lastSeenAt: now,
      })) as IUser;

      // `.create()` returns a Mongoose document; make it plain-ish
      user = user.toObject() as IUser;
    }

    return NextResponse.json(
      {
        user,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[API] /api/user/create error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

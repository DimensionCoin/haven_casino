// models/User.ts
import { Schema, model, models, type Document } from "mongoose";

export interface IUser extends Document {
  walletAddress: string;
  name?: string;
  virtualBalance: number; // virtual USDC balance for the casino

  email?: string;
  phone?: string;
  referralCode?: string;
  referredBy?: string;
  notificationsEnabled: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },

    virtualBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },

    // 🔹 Unique referral code that others can use
    referralCode: {
      type: String,
      trim: true,
      index: true,
      unique: true,
      sparse: true,
    },

    // 🔹 Who referred this user (you can store walletAddress or code; using code is fine for now)
    referredBy: {
      type: String,
      trim: true,
    },

    notificationsEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const UserModel = models.User || model<IUser>("User", UserSchema);

export default UserModel;

// models/ChipVault.ts
import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IChipVault extends Document {
  token: "USDC";
  casinoWallet: string;

  // total chips that exist (users + casino)
  chipsInCirculation: number;

  // 🔥 NEW: chips currently held by the casino (house float)
  casinoVirtualBalance: number;

  // optional on-chain sanity snapshot
  lastUsdcBalance?: number;

  createdAt: Date;
  updatedAt: Date;
}

const ChipVaultSchema = new Schema<IChipVault>(
  {
    token: {
      type: String,
      required: true,
      default: "USDC",
      enum: ["USDC"],
      unique: true, // only one vault per token
    },
    casinoWallet: {
      type: String,
      required: true,
    },
    chipsInCirculation: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    casinoVirtualBalance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lastUsdcBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

const ChipVault =
  (models.ChipVault as mongoose.Model<IChipVault>) ||
  model<IChipVault>("ChipVault", ChipVaultSchema);

export default ChipVault;

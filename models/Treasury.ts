// models/Treasury.ts
import mongoose, { type Document, type Model } from "mongoose";

export interface ITreasury extends Document {
  walletAddress: string;
  virtualBalance: number; // off-chain credits
  totalFeesCollected: number; // lifetime fees
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TreasurySchema = new mongoose.Schema<ITreasury>(
  {
    walletAddress: { type: String, required: true, unique: true, index: true },
    virtualBalance: { type: Number, default: 0, min: 0 },
    totalFeesCollected: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

const Treasury: Model<ITreasury> =
  (mongoose.models.Treasury as Model<ITreasury> | undefined) ||
  mongoose.model<ITreasury>("Treasury", TreasurySchema);

export default Treasury;

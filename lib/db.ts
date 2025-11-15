// lib/db.ts
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGO_DB_URL;

if (!MONGODB_URI) {
  throw new Error("MONGO_DB_URL is not set in environment variables");
}

// In Next.js we cache the connection across hot reloads in dev
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cached = (global as any).mongoose as MongooseCache | undefined;

if (!cached) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).mongoose = cached = {
    conn: null,
    promise: null,
  };
}

export async function connectDb() {
  if (cached!.conn) {
    return cached!.conn;
  }

  if (!cached!.promise) {
    cached!.promise = mongoose
      .connect(MONGODB_URI!, {
        bufferCommands: false,
      })
      .then((mongooseInstance) => mongooseInstance);
  }

  cached!.conn = await cached!.promise;
  return cached!.conn;
}

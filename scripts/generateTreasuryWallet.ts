// scripts/generateTreasuryWallet.ts
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Small helper to upsert a key=value line into an env file string.
 */
function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, "m");

  if (regex.test(content)) {
    // Replace existing line
    return content.replace(regex, line);
  }

  // Append new line
  const needsNewline = content.length > 0 && !content.endsWith("\n");
  return content + (needsNewline ? "\n" : "") + line + "\n";
}

async function main() {
  // For treasury you said you want .env (not .env.local)
  const envPath = path.join(process.cwd(), ".env");

  let envContent = "";
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
  } else {
    console.warn(".env not found, creating a new one.");
  }

  // 1) Generate a new Solana keypair
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const secretKeyArray = Array.from(keypair.secretKey); // number[]

  // 2) Log it to the console so you can copy it somewhere safe if you want
  console.log("=== Generated Treasury Wallet ===");
  console.log("Public key:", publicKey);
  console.log("Secret key (JSON array):", JSON.stringify(secretKeyArray));
  console.log("");

  // 3) Upsert into env content (same style as casino wallet secret)
  envContent = upsertEnvVar(envContent, "CASINO_TREASURY_WALLET", publicKey);
  envContent = upsertEnvVar(
    envContent,
    "CASINO_TREASURY_SECRET_KEY",
    JSON.stringify(secretKeyArray)
  );

  // 4) Write back to file
  fs.writeFileSync(envPath, envContent, { encoding: "utf8" });

  console.log(`✅ Updated ${envPath} with:`);
  console.log("  CASINO_TREASURY_WALLET");
  console.log("  CASINO_TREASURY_SECRET_KEY");
  console.log("");
  console.log(
    "⚠️ Make sure .env is in your .gitignore so you don't commit the private key."
  );
}

main().catch((err) => {
  console.error("Error generating treasury wallet:", err);
  process.exit(1);
});

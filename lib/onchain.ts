// lib/onchain.ts
import { Cluster, clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const NETWORK: Cluster =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as Cluster) || "devnet";

const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  clusterApiUrl(NETWORK);

const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT!;
const CASINO_WALLET = process.env.NEXT_PUBLIC_CASINO_WALLET!;

let _connection: Connection | null = null;

function getConnection() {
  if (!_connection) {
    _connection = new Connection(RPC, "confirmed");
  }
  return _connection;
}

/**
 * On-chain USDC in the casino wallet (the real backing for all chips).
 * Returns 0 if the casino ATA does not exist yet.
 */
export async function getOnChainCasinoUsdcBalance(): Promise<number> {
  const conn = getConnection();
  const mintPk = new PublicKey(USDC_MINT);
  const walletPk = new PublicKey(CASINO_WALLET);
  const ata = await getAssociatedTokenAddress(mintPk, walletPk);

  // 👇 First check if the ATA exists at all
  const info = await conn.getAccountInfo(ata);
  if (!info) {
    // No token account yet → treat as 0 USDC
    return 0;
  }

  const bal = await conn.getTokenAccountBalance(ata);
  return bal.value.uiAmount ?? 0;
}

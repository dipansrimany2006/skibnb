// Per-user BSC agent wallet — generation, encryption, and signing
// Each user gets their own isolated BSC wallet. Private key is encrypted
// with AES-256-GCM using the server-side AGENT_ENCRYPTION_KEY.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ── Encryption helpers ─────────────────────────────────────────────────────────

function getEncKey(): Buffer {
  const hex = process.env.AGENT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error("AGENT_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(hex, "hex");
}

export function encryptPrivateKey(privateKeyHex: string): string {
  const key = getEncKey();
  const iv  = randomBytes(12); // 96-bit nonce for AES-256-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(privateKeyHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag
  // Layout: 12-byte IV | 16-byte tag | ciphertext
  return Buffer.concat([iv, tag, enc]).toString("hex");
}

export function decryptPrivateKey(cipherHex: string): `0x${string}` {
  const key  = getEncKey();
  const data = Buffer.from(cipherHex, "hex");
  const iv   = data.subarray(0, 12);
  const tag  = data.subarray(12, 28);
  const enc  = data.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  return plain as `0x${string}`;
}

// ── Wallet generation ──────────────────────────────────────────────────────────

export interface AgentWallet {
  address: `0x${string}`;
  encryptedKey: string; // store this in DB — never the raw key
}

export function generateAgentWallet(): AgentWallet {
  const privateKey = generatePrivateKey();        // 0x + 64 hex
  const account    = privateKeyToAccount(privateKey);
  return {
    address:      account.address,
    encryptedKey: encryptPrivateKey(privateKey),
  };
}

// ── Signing client from encrypted key ────────────────────────────────────────

import { createPublicClient, createWalletClient, http } from "viem";

const bsc = {
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.BSC_RPC_URL ?? "https://bsc-dataseed1.binance.org/"] },
    public:  { http: [process.env.BSC_RPC_URL ?? "https://bsc-dataseed1.binance.org/"] },
  },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
} as const;

export function getWalletContext(encryptedKey: string) {
  const privateKey = decryptPrivateKey(encryptedKey);
  const account    = privateKeyToAccount(privateKey);
  return {
    account,
    wallet: createWalletClient({ account, chain: bsc, transport: http() }),
    public: createPublicClient({ chain: bsc, transport: http() }),
  };
}

export async function getWalletBNBBalance(encryptedKey: string): Promise<number> {
  try {
    const ctx = getWalletContext(encryptedKey);
    const bal = await ctx.public.getBalance({ address: ctx.account.address });
    return Number(bal) / 1e18;
  } catch {
    return 0;
  }
}

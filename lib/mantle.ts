// Mantle blockchain integration — chain config, MNT price, and conversion helpers.

export const MANTLE_SEPOLIA = {
  chainId:     5003,
  chainIdHex:  "0x138B",
  name:        "Mantle Sepolia",
  rpcUrl:      "https://rpc.sepolia.mantle.xyz",
  explorerUrl: "https://explorer.sepolia.mantle.xyz",
  symbol:      "MNT",
  decimals:    18,
};

// Address of the CFO vault on Mantle Sepolia.
// Deposits are sent here — represents funds "under CFO management".
// Falls back to a well-known zero-value burn address for demo purposes.
export const CFO_VAULT_ADDRESS =
  process.env.NEXT_PUBLIC_CFO_VAULT_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";

// ── MNT price ────────────────────────────────────────────────────────────────

let _cachedPrice: number | null = null;
let _cachedAt    = 0;
const CACHE_TTL  = 60_000; // 1 min

export async function getMntPriceUsd(): Promise<number> {
  if (_cachedPrice && Date.now() - _cachedAt < CACHE_TTL) return _cachedPrice;
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=mantle&vs_currencies=usd",
      { next: { revalidate: 60 } },
    );
    const d = await r.json() as { mantle?: { usd?: number } };
    const price = d.mantle?.usd ?? 0.80;
    _cachedPrice = price;
    _cachedAt    = Date.now();
    return price;
  } catch {
    return _cachedPrice ?? 0.80; // fallback to ~$0.80
  }
}

// Convert USD → MNT (for display)
export function usdToMnt(usd: number, mntPrice: number): number {
  if (!mntPrice || mntPrice <= 0) return usd / 0.80;
  return usd / mntPrice;
}

// Convert MNT → USD (for crediting deposits into the internal USD balance)
export function mntToUsd(mnt: number, mntPrice: number): number {
  if (!mntPrice || mntPrice <= 0) return mnt * 0.80;
  return mnt * mntPrice;
}

// Format MNT for display
export function fmtMnt(mnt: number, decimals = 4): string {
  if (!Number.isFinite(mnt)) return "0 MNT";
  if (mnt >= 1_000_000) return `${(mnt / 1_000_000).toFixed(2)}M MNT`;
  if (mnt >= 1_000)     return `${(mnt / 1_000).toFixed(2)}K MNT`;
  return `${mnt.toFixed(decimals)} MNT`;
}

// Encode MNT amount (human-readable) → hex wei string for eth_sendTransaction
export function mntToHexWei(amount: number): string {
  // MNT has 18 decimals — multiply by 1e18
  // Use BigInt to avoid floating point precision issues
  const whole   = Math.floor(amount);
  const frac    = amount - whole;
  const weiBI   = BigInt(whole) * BigInt("1000000000000000000")
                + BigInt(Math.round(frac * 1e9)) * BigInt("1000000000");
  return "0x" + weiBI.toString(16);
}

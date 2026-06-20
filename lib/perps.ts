// Binance Futures public API — no API key required
// Provides funding rates, open interest, and long/short ratios
// Used as perps signals in the CFO engine and CMC Strategy Skills

const FAPI = "https://fapi.binance.com";

export interface PerpsContext {
  symbol: string;
  fundingRate: number | null;       // e.g. 0.0001 = 0.01%
  openInterest: number | null;      // USD-denominated OI
  longShortRatio: number | null;    // longPct / shortPct
  longPct: number | null;           // fraction of accounts that are long, e.g. 0.55
  shortPct: number | null;
}

// 5-min in-memory cache per perp symbol
const cache = new Map<string, { data: PerpsContext; ts: number }>();
const CACHE_TTL = 300_000;

// Convert a CFO display symbol (e.g. "BTC/USD") or plain symbol to a Binance perp pair
export function toPerPairSymbol(symbol: string): string {
  return symbol.replace(/\/USD[T]?$/, "").toUpperCase() + "USDT";
}

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchFundingRate(perpSymbol: string): Promise<number | null> {
  const data = await safeFetch<Array<{ fundingRate: string }>>(
    `${FAPI}/fapi/v1/fundingRate?symbol=${perpSymbol}&limit=1`,
  );
  return data?.length ? parseFloat(data[0].fundingRate) : null;
}

async function fetchOpenInterest(perpSymbol: string): Promise<number | null> {
  const data = await safeFetch<{ openInterest: string }>(
    `${FAPI}/fapi/v1/openInterest?symbol=${perpSymbol}`,
  );
  return data ? parseFloat(data.openInterest) : null;
}

async function fetchLongShortRatio(
  perpSymbol: string,
): Promise<{ ratio: number; longPct: number; shortPct: number } | null> {
  const data = await safeFetch<
    Array<{ longShortRatio: string; longAccount: string; shortAccount: string }>
  >(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${perpSymbol}&period=5m&limit=1`);
  if (!data?.length) return null;
  return {
    ratio:    parseFloat(data[0].longShortRatio),
    longPct:  parseFloat(data[0].longAccount),
    shortPct: parseFloat(data[0].shortAccount),
  };
}

export async function fetchPerpsContext(symbol: string): Promise<PerpsContext> {
  const perpSymbol = toPerPairSymbol(symbol);
  const cached = cache.get(perpSymbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const [fundingRate, openInterest, ls] = await Promise.all([
    fetchFundingRate(perpSymbol),
    fetchOpenInterest(perpSymbol),
    fetchLongShortRatio(perpSymbol),
  ]);

  const data: PerpsContext = {
    symbol: perpSymbol,
    fundingRate,
    openInterest,
    longShortRatio: ls?.ratio ?? null,
    longPct:        ls?.longPct ?? null,
    shortPct:       ls?.shortPct ?? null,
  };

  cache.set(perpSymbol, { data, ts: Date.now() });
  return data;
}

export async function fetchBulkPerpsContext(
  symbols: string[],
): Promise<Map<string, PerpsContext>> {
  const results = await Promise.allSettled(
    symbols.map(async (sym) => ({ sym, ctx: await fetchPerpsContext(sym) })),
  );
  const map = new Map<string, PerpsContext>();
  for (const r of results) {
    if (r.status === "fulfilled") map.set(r.value.sym, r.value.ctx);
  }
  return map;
}

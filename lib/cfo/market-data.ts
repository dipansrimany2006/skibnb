// OHLCV candle fetching
// Spot candles: Binance public API (no key) — supports any USDT pair
// Fallback:     Pyth Benchmark TradingView shim
// Historical:   Binance paginated klines (for backtesting)

import type { Candle } from "./types";

const BENCHMARK   = "https://benchmarks.pyth.network/v1/shims/tradingview/history";
const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
];
const BINANCE_API = `${BINANCE_HOSTS[0]}/api/v3/klines`;

// Derive a Binance USDT spot pair from a Pyth display symbol ("BTC/USD") or plain symbol ("BTC")
function toBinancePair(symbol: string): string {
  const base = symbol.replace(/\/USD[T]?$/, "").toUpperCase();
  return `${base}USDT`;
}

async function fetchBinanceCandles(pair: string, limit = 200, interval = "5m"): Promise<Candle[]> {
  const url = `${BINANCE_API}?symbol=${pair}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = await res.json() as [number, string, string, string, string, string, ...unknown[]][];
    return data.map(k => ({
      time:   Math.floor(k[0] / 1000),
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch {
    return [];
  }
}

async function fetchPythCandles(pythSymbol: string, resolution = "5", lookbackSeconds = 86400): Promise<Candle[]> {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - lookbackSeconds;
  const url  = `${BENCHMARK}?symbol=${encodeURIComponent(pythSymbol)}&resolution=${resolution}&from=${from}&to=${now}`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = await res.json() as {
      s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[];
    };
    if (data.s !== "ok" || !data.t || !data.c) return [];
    return data.t.map((t, i) => ({
      time:   t,
      open:   data.o?.[i] ?? data.c![i],
      high:   data.h?.[i] ?? data.c![i],
      low:    data.l?.[i] ?? data.c![i],
      close:  data.c![i],
      volume: data.v?.[i] ?? 0,
    }));
  } catch {
    return [];
  }
}

// For CFO engine: ~200 5-min candles.
// pythSymbol can be a full Pyth symbol ("Crypto.BTC/USD") or display symbol ("BTC/USD").
export async function fetchCFOCandles(pythSymbol: string): Promise<Candle[]> {
  const pair = toBinancePair(pythSymbol);
  const candles = await fetchBinanceCandles(pair, 200, "5m");
  if (candles.length >= 30) return candles;
  return fetchPythCandles(pythSymbol, "5", 200 * 5 * 60);
}

// Generic candle fetch (used by chart API)
export async function fetchCandles(pythSymbol: string, resolution = "5", lookbackSeconds = 86400): Promise<Candle[]> {
  const pair = toBinancePair(pythSymbol);
  const interval = resolution === "60" ? "1h" : resolution === "240" ? "4h" : resolution === "D" ? "1d" : "5m";
  const limit = Math.ceil(lookbackSeconds / (parseInt(resolution) * 60) || 200);
  const candles = await fetchBinanceCandles(pair, Math.min(limit, 1000), interval);
  if (candles.length >= 30) return candles;
  return fetchPythCandles(pythSymbol, resolution, lookbackSeconds);
}

// Historical paginated candles — for backtesting
// Fetches up to `limit` bars per request, paginates to cover the full range.
// Tries multiple Binance API hosts in order — some regions block the primary host.
export async function fetchHistoricalCandles(
  symbol: string,        // e.g. "BTC/USD" or "ETH/USD"
  interval: "1h" | "4h" | "1d",
  fromMs: number,        // unix milliseconds
  toMs: number,
): Promise<Candle[]> {
  const pair = toBinancePair(symbol);

  for (const host of BINANCE_HOSTS) {
    const all: Candle[] = [];
    let startTime = fromMs;
    let failed = false;

    while (startTime < toMs) {
      const url = `${host}/api/v3/klines?symbol=${pair}&interval=${interval}&startTime=${startTime}&endTime=${toMs}&limit=1000`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
          console.warn(`[market-data] ${host} returned ${res.status} for ${pair}`, await res.text().catch(() => ""));
          failed = true;
          break;
        }
        const data = await res.json() as [number, string, string, string, string, string, ...unknown[]][];
        if (!data.length) break;

        const batch: Candle[] = data.map(k => ({
          time:   Math.floor(k[0] / 1000),
          open:   parseFloat(k[1]),
          high:   parseFloat(k[2]),
          low:    parseFloat(k[3]),
          close:  parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        all.push(...batch);

        const lastMs = data[data.length - 1][0] as number;
        if (lastMs <= startTime) break;
        startTime = lastMs + 1;

        if (data.length < 1000) break;
      } catch (err) {
        console.warn(`[market-data] ${host} fetch error for ${pair}:`, err);
        failed = true;
        break;
      }
    }

    if (!failed && all.length > 0) return all;
    if (failed) continue; // try next host
    return all; // completed without error (possibly 0 bars for empty range)
  }

  console.error(`[market-data] All Binance hosts failed for ${pair} ${interval}`);
  return [];
}

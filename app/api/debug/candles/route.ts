import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
];
const BENCHMARK = "https://benchmarks.pyth.network/v1/shims/tradingview/history";

export async function GET() {
  const results: Record<string, unknown> = {};

  // Test each Binance host
  for (const host of BINANCE_HOSTS) {
    const url = `${host}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
      const text = await res.text();
      results[host] = { status: res.status, bodyPreview: text.slice(0, 120) };
    } catch (err) {
      results[host] = { error: String(err) };
    }
  }

  // Test Pyth
  const now = Math.floor(Date.now() / 1000);
  const pythUrl = `${BENCHMARK}?symbol=BTC%2FUSD&resolution=60&from=${now - 5 * 3600}&to=${now}`;
  try {
    const res = await fetch(pythUrl, { signal: AbortSignal.timeout(8_000) });
    const json = await res.json() as { s?: string; t?: unknown[] };
    results["pyth"] = { status: res.status, s: json.s, bars: json.t?.length ?? 0 };
  } catch (err) {
    results["pyth"] = { error: String(err) };
  }

  return NextResponse.json(results);
}

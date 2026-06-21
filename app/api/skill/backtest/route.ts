// POST /api/skill/backtest
// Run a historical backtest against a StrategySpec.
// Returns equity curve, trade log, and performance metrics.

import { NextRequest, NextResponse } from "next/server";
import { runBacktest } from "@/lib/skill/backtest";
import type { StrategySpec } from "@/lib/skill/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — allow time for multi-symbol paginated Binance fetches

const VALID_INTERVALS = ["1h", "4h", "1d"] as const;
const MAX_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000; // 1 year max

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    spec,
    symbols,
    interval = "1h",
    fromMs,
    toMs,
    initialCapital = 10_000,
  } = body as {
    spec?: StrategySpec;
    symbols?: string[];
    interval?: string;
    fromMs?: number;
    toMs?: number;
    initialCapital?: number;
  };

  if (!spec || typeof spec !== "object") {
    return NextResponse.json({ error: "spec is required." }, { status: 400 });
  }

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json(
      { error: "symbols must be a non-empty array, e.g. [\"BTC/USD\"]" },
      { status: 400 },
    );
  }

  if (!VALID_INTERVALS.includes(interval as typeof VALID_INTERVALS[number])) {
    return NextResponse.json(
      { error: `interval must be one of: ${VALID_INTERVALS.join(", ")}` },
      { status: 400 },
    );
  }

  const now = Date.now();
  const resolvedTo  = typeof toMs   === "number" ? Math.min(toMs, now)        : now;
  const resolvedFrom = typeof fromMs === "number"
    ? Math.max(fromMs, resolvedTo - MAX_LOOKBACK_MS)
    : resolvedTo - 90 * 24 * 60 * 60 * 1000; // default: 90 days

  if (resolvedFrom >= resolvedTo) {
    return NextResponse.json({ error: "fromMs must be before toMs." }, { status: 400 });
  }

  try {
    const result = await runBacktest({
      spec,
      symbols: symbols.slice(0, 5),  // cap at 5 symbols per backtest
      interval: interval as "1h" | "4h" | "1d",
      fromMs:   resolvedFrom,
      toMs:     resolvedTo,
      initialCapital: Math.max(100, Math.min(initialCapital, 1_000_000)),
    });

    return NextResponse.json({ result });
  } catch (err) {
    console.error("[skill/backtest]", err);
    return NextResponse.json({ error: "Backtest failed." }, { status: 500 });
  }
}

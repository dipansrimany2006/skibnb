// Perps signal family — derived from Binance Futures public API
// Funding rate, open interest change, and long/short ratio
// All signals: [-1, 1]. Positive = bullish, negative = bearish.

import type { Signal } from "../types";
import type { PerpsContext } from "@/lib/perps";

// Funding rate signal (contrarian)
// Very negative funding → shorts paying → bullish (short squeeze pressure)
// Very positive funding → longs paying → bearish (long squeeze pressure)
function fundingRateSignal(rate: number): Signal {
  const EXTREME = 0.0008;   // 0.08% per 8h — extreme crowding
  const MODERATE = 0.0002;  // 0.02% per 8h — notable bias

  let value: number;
  let detail: string;

  if (rate < -EXTREME) {
    value = 0.75;
    detail = `Funding ${(rate * 100).toFixed(4)}% — extreme negative, shorts paying; short-squeeze risk`;
  } else if (rate < -MODERATE) {
    value = 0.35;
    detail = `Funding ${(rate * 100).toFixed(4)}% — negative; bearish crowding not confirmed`;
  } else if (rate > EXTREME) {
    value = -0.75;
    detail = `Funding ${(rate * 100).toFixed(4)}% — extreme positive, longs paying; long-squeeze risk`;
  } else if (rate > MODERATE) {
    value = -0.35;
    detail = `Funding ${(rate * 100).toFixed(4)}% — positive; bullish crowding, elevated`;
  } else {
    value = 0;
    detail = `Funding ${(rate * 100).toFixed(4)}% — neutral, no strong positioning bias`;
  }

  return { value, detail, name: "funding_rate", family: "perps" };
}

// Long/Short ratio signal (contrarian)
// Crowd very long → contrarian bearish; crowd very short → contrarian bullish
function lsRatioSignal(ratio: number, longPct: number): Signal {
  let value: number;
  let detail: string;

  if (ratio > 1.6) {
    value = -0.65;
    detail = `L/S ratio ${ratio.toFixed(2)} (${(longPct * 100).toFixed(1)}% long) — extreme long crowding, contrarian bearish`;
  } else if (ratio > 1.25) {
    value = -0.3;
    detail = `L/S ratio ${ratio.toFixed(2)} (${(longPct * 100).toFixed(1)}% long) — mild long bias`;
  } else if (ratio < 0.65) {
    value = 0.65;
    detail = `L/S ratio ${ratio.toFixed(2)} (${(longPct * 100).toFixed(1)}% long) — extreme short crowding, contrarian bullish`;
  } else if (ratio < 0.85) {
    value = 0.3;
    detail = `L/S ratio ${ratio.toFixed(2)} (${(longPct * 100).toFixed(1)}% long) — mild short bias`;
  } else {
    value = 0;
    detail = `L/S ratio ${ratio.toFixed(2)} — balanced positioning`;
  }

  return { value, detail, name: "ls_ratio", family: "perps" };
}

export function runPerpsStrategies(ctx: PerpsContext): Signal[] {
  const signals: Signal[] = [];

  if (ctx.fundingRate !== null) {
    signals.push(fundingRateSignal(ctx.fundingRate));
  }

  if (ctx.longShortRatio !== null && ctx.longPct !== null) {
    signals.push(lsRatioSignal(ctx.longShortRatio, ctx.longPct));
  }

  return signals;
}

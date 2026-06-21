// Momentum strategy family — ported from Python momentum_algos.py
// All EMA calculations use full-series emaSeries() to avoid the _ema reseeding bug.

import type { Candle, Signal } from "../types";

// ── Math helpers ────────────────────────────────────────────────────────────

function sma(prices: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { out.push(NaN); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += prices[j];
    out.push(s / period);
  }
  return out;
}

// Full-series EMA — seeds on first valid value, rolls forward
export function emaSeries(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(prices.length).fill(NaN);
  let started = false;
  for (let i = 0; i < prices.length; i++) {
    if (!started) {
      if (i >= period - 1) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += prices[j];
        out[i] = s / period;
        started = true;
      }
    } else {
      out[i] = prices[i] * k + out[i - 1] * (1 - k);
    }
  }
  return out;
}

function lastValid(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!isNaN(arr[i])) return arr[i];
  }
  return NaN;
}

function closes(candles: Candle[]): number[] {
  return candles.map(c => c.close);
}

function highs(candles: Candle[]): number[] {
  return candles.map(c => c.high);
}

function lows(candles: Candle[]): number[] {
  return candles.map(c => c.low);
}

// ── 1. Simple Momentum ──────────────────────────────────────────────────────

export function simpleMomentum(candles: Candle[], period = 14): Signal {
  const cl = closes(candles);
  if (cl.length < period + 1) return { value: 0, detail: "insufficient data", name: "simple_momentum", family: "momentum" };
  const momentum = cl[cl.length - 1] - cl[cl.length - 1 - period];
  const pctChange = cl[cl.length - 1 - period] !== 0 ? momentum / cl[cl.length - 1 - period] : 0;
  const signal = Math.max(-1, Math.min(1, pctChange * 10));
  return {
    value: signal,
    detail: `price_change_${period}p=${pctChange.toFixed(4)}`,
    name: "simple_momentum",
    family: "momentum",
  };
}

// ── 2. Dual Momentum ────────────────────────────────────────────────────────

export function dualMomentum(candles: Candle[], shortPeriod = 10, longPeriod = 30): Signal {
  const cl = closes(candles);
  if (cl.length < longPeriod + 1) return { value: 0, detail: "insufficient data", name: "dual_momentum", family: "momentum" };
  const shortMom = (cl[cl.length - 1] - cl[cl.length - 1 - shortPeriod]) / (cl[cl.length - 1 - shortPeriod] || 1);
  const longMom  = (cl[cl.length - 1] - cl[cl.length - 1 - longPeriod])  / (cl[cl.length - 1 - longPeriod]  || 1);
  const signal = shortMom > 0 && longMom > 0 ? 1 : shortMom < 0 && longMom < 0 ? -1 : 0;
  return {
    value: signal,
    detail: `short_mom=${shortMom.toFixed(4)},long_mom=${longMom.toFixed(4)}`,
    name: "dual_momentum",
    family: "momentum",
  };
}

// ── 3. Breakout ─────────────────────────────────────────────────────────────

export function breakout(candles: Candle[], period = 20): Signal {
  if (candles.length < period + 1) return { value: 0, detail: "insufficient data", name: "breakout", family: "momentum" };
  const hi = highs(candles);
  const lo = lows(candles);
  const cl = closes(candles);
  const recentHi = Math.max(...hi.slice(-period - 1, -1));
  const recentLo = Math.min(...lo.slice(-period - 1, -1));
  const current = cl[cl.length - 1];
  let signal = 0;
  let detail = "no_breakout";
  if (current > recentHi) { signal = 1; detail = `breakout_up price=${current.toFixed(4)} high=${recentHi.toFixed(4)}`; }
  else if (current < recentLo) { signal = -1; detail = `breakout_down price=${current.toFixed(4)} low=${recentLo.toFixed(4)}`; }
  return { value: signal, detail, name: "breakout", family: "momentum" };
}

// ── 4. Donchian Channel ─────────────────────────────────────────────────────

export function donchianChannel(candles: Candle[], period = 20): Signal {
  if (candles.length < period) return { value: 0, detail: "insufficient data", name: "donchian_channel", family: "momentum" };
  const hi = highs(candles);
  const lo = lows(candles);
  const cl = closes(candles);
  const upperBand = Math.max(...hi.slice(-period));
  const lowerBand = Math.min(...lo.slice(-period));
  const midBand   = (upperBand + lowerBand) / 2;
  const current   = cl[cl.length - 1];
  const range     = upperBand - lowerBand;
  const signal    = range > 0 ? Math.max(-1, Math.min(1, (current - midBand) / (range / 2))) : 0;
  return {
    value: signal,
    detail: `price=${current.toFixed(4)},upper=${upperBand.toFixed(4)},lower=${lowerBand.toFixed(4)},mid=${midBand.toFixed(4)}`,
    name: "donchian_channel",
    family: "momentum",
  };
}

// ── 5. MA Crossover ─────────────────────────────────────────────────────────

export function maCrossover(candles: Candle[], shortPeriod = 10, longPeriod = 30): Signal {
  const cl = closes(candles);
  if (cl.length < longPeriod) return { value: 0, detail: "insufficient data", name: "ma_crossover", family: "momentum" };
  const shortSMA = sma(cl, shortPeriod);
  const longSMA  = sma(cl, longPeriod);
  const prevShort = shortSMA[shortSMA.length - 2];
  const prevLong  = longSMA[longSMA.length - 2];
  const curShort  = shortSMA[shortSMA.length - 1];
  const curLong   = longSMA[longSMA.length - 1];
  let signal = 0;
  let detail = "no_crossover";
  if (!isNaN(prevShort) && !isNaN(prevLong) && !isNaN(curShort) && !isNaN(curLong)) {
    if (prevShort <= prevLong && curShort > curLong) { signal = 1; detail = `golden_cross sma${shortPeriod}=${curShort.toFixed(4)},sma${longPeriod}=${curLong.toFixed(4)}`; }
    else if (prevShort >= prevLong && curShort < curLong) { signal = -1; detail = `death_cross sma${shortPeriod}=${curShort.toFixed(4)},sma${longPeriod}=${curLong.toFixed(4)}`; }
    else { detail = `no_cross gap=${((curShort - curLong) / (curLong || 1)).toFixed(4)}`; }
  }
  return { value: signal, detail, name: "ma_crossover", family: "momentum" };
}

// ── 6. EMA Crossover ────────────────────────────────────────────────────────

export function emaCrossover(candles: Candle[], shortPeriod = 12, longPeriod = 26): Signal {
  const cl = closes(candles);
  if (cl.length < longPeriod) return { value: 0, detail: "insufficient data", name: "ema_crossover", family: "momentum" };
  const shortEMA = emaSeries(cl, shortPeriod);
  const longEMA  = emaSeries(cl, longPeriod);
  const n = cl.length;
  const prevShort = shortEMA[n - 2];
  const prevLong  = longEMA[n - 2];
  const curShort  = shortEMA[n - 1];
  const curLong   = longEMA[n - 1];
  let signal = 0;
  let detail = "no_crossover";
  if (!isNaN(prevShort) && !isNaN(prevLong) && !isNaN(curShort) && !isNaN(curLong)) {
    if (prevShort <= prevLong && curShort > curLong) { signal = 1; detail = `ema_golden_cross ema${shortPeriod}=${curShort.toFixed(4)}`; }
    else if (prevShort >= prevLong && curShort < curLong) { signal = -1; detail = `ema_death_cross ema${shortPeriod}=${curShort.toFixed(4)}`; }
    else { detail = `ema_no_cross spread=${((curShort - curLong) / (curLong || 1)).toFixed(4)}`; }
  }
  return { value: signal, detail, name: "ema_crossover", family: "momentum" };
}

// ── 7. MACD Signal ──────────────────────────────────────────────────────────

export function macdSignal(candles: Candle[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): Signal {
  const cl = closes(candles);
  if (cl.length < slowPeriod + signalPeriod) return { value: 0, detail: "insufficient data", name: "macd_signal", family: "momentum" };
  const fastEMA  = emaSeries(cl, fastPeriod);
  const slowEMA  = emaSeries(cl, slowPeriod);
  const macdLine = fastEMA.map((v, i) => isNaN(v) || isNaN(slowEMA[i]) ? NaN : v - slowEMA[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  if (validMacd.length < signalPeriod) return { value: 0, detail: "insufficient data", name: "macd_signal", family: "momentum" };
  // Compute signal line EMA on macd values
  const signalLine = emaSeries(validMacd, signalPeriod);
  const lastMacd = validMacd[validMacd.length - 1];
  const lastSig  = signalLine[signalLine.length - 1];
  const histogram = lastMacd - lastSig;
  const signal = histogram > 0 ? Math.min(1, histogram / (Math.abs(lastSig) || 1)) : Math.max(-1, histogram / (Math.abs(lastSig) || 1));
  return {
    value: Math.max(-1, Math.min(1, signal)),
    detail: `macd=${lastMacd.toFixed(6)},signal=${lastSig.toFixed(6)},hist=${histogram.toFixed(6)}`,
    name: "macd_signal",
    family: "momentum",
  };
}

// ── 8. ADX Filter (also used in Step 2 gates) ───────────────────────────────

export function adxFilter(candles: Candle[], period = 14): { signal: Signal; adxValue: number; isTrending: boolean } {
  if (candles.length < period * 2) {
    return {
      signal: { value: 0, detail: "insufficient data", name: "adx_filter", family: "momentum" },
      adxValue: 0,
      isTrending: false,
    };
  }
  const hi = highs(candles);
  const lo = lows(candles);
  const cl = closes(candles);

  const trArr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const hl = hi[i] - lo[i];
    const hc = Math.abs(hi[i] - cl[i - 1]);
    const lc = Math.abs(lo[i] - cl[i - 1]);
    trArr.push(Math.max(hl, hc, lc));
    const upMove   = hi[i] - hi[i - 1];
    const downMove = lo[i - 1] - lo[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing
  function wilderSmooth(arr: number[], p: number): number[] {
    const out: number[] = [];
    let sum = arr.slice(0, p).reduce((a, b) => a + b, 0);
    out.push(sum);
    for (let i = p; i < arr.length; i++) {
      sum = sum - sum / p + arr[i];
      out.push(sum);
    }
    return out;
  }

  const smoothTR    = wilderSmooth(trArr, period);
  const smoothPlus  = wilderSmooth(plusDM, period);
  const smoothMinus = wilderSmooth(minusDM, period);

  const adxArr: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    const tr = smoothTR[i];
    if (tr === 0) continue;
    const plusDI  = (smoothPlus[i]  / tr) * 100;
    const minusDI = (smoothMinus[i] / tr) * 100;
    const dx = Math.abs(plusDI - minusDI) / ((plusDI + minusDI) || 1) * 100;
    adxArr.push(dx);
  }

  if (adxArr.length < period) {
    return {
      signal: { value: 0, detail: "insufficient adx data", name: "adx_filter", family: "momentum" },
      adxValue: 0,
      isTrending: false,
    };
  }

  const adxValue = adxArr.slice(-period).reduce((a, b) => a + b, 0) / period;
  const isTrending = adxValue > 25;
  const sigValue = isTrending ? 1 : 0;

  return {
    signal: {
      value: sigValue,
      detail: `adx=${adxValue.toFixed(2)},trending=${isTrending}`,
      name: "adx_filter",
      family: "momentum",
    },
    adxValue,
    isTrending,
  };
}

// ── 9. Supertrend — stateful trailing stop computed over full candle series ──

export function supertrend(candles: Candle[], period = 10, multiplier = 3): Signal {
  if (candles.length < period + 2) return { value: 0, detail: "insufficient data", name: "supertrend", family: "momentum" };
  const hi = highs(candles);
  const lo = lows(candles);
  const cl = closes(candles);

  // Compute ATR for each bar
  const tr: number[] = [hi[0] - lo[0]];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])));
  }

  // Smoothed ATR (Wilder's)
  const atr: number[] = new Array(candles.length).fill(0);
  atr[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  // Track direction state across bars
  let direction = 1; // 1 = bullish, -1 = bearish
  let upperBand = 0;
  let lowerBand = 0;

  for (let i = period; i < candles.length; i++) {
    const hl2 = (hi[i] + lo[i]) / 2;
    const newUpper = hl2 + multiplier * atr[i];
    const newLower = hl2 - multiplier * atr[i];

    upperBand = (i === period || newUpper < upperBand || cl[i - 1] > upperBand) ? newUpper : upperBand;
    lowerBand = (i === period || newLower > lowerBand || cl[i - 1] < lowerBand) ? newLower : lowerBand;

    if (direction === 1 && cl[i] < lowerBand) direction = -1;
    else if (direction === -1 && cl[i] > upperBand) direction = 1;
  }

  const price = cl[cl.length - 1];
  return {
    value: direction as -1 | 1,
    detail: `direction=${direction},price=${price.toFixed(2)},upper=${upperBand.toFixed(2)},lower=${lowerBand.toFixed(2)}`,
    name: "supertrend",
    family: "momentum",
  };
}

// ── 10. Ichimoku Signal ─────────────────────────────────────────────────────

export function ichimokuSignal(candles: Candle[], conversionPeriod = 9, basePeriod = 26): Signal {
  if (candles.length < basePeriod) return { value: 0, detail: "insufficient data", name: "ichimoku_signal", family: "momentum" };
  const hi = highs(candles);
  const lo = lows(candles);
  const cl = closes(candles);

  const hiConv  = Math.max(...hi.slice(-conversionPeriod));
  const loConv  = Math.min(...lo.slice(-conversionPeriod));
  const hiBase  = Math.max(...hi.slice(-basePeriod));
  const loBase  = Math.min(...lo.slice(-basePeriod));
  const tenkan  = (hiConv + loConv) / 2;
  const kijun   = (hiBase + loBase) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const price   = cl[cl.length - 1];

  let signal = 0;
  let detail = `price=${price.toFixed(4)},tenkan=${tenkan.toFixed(4)},kijun=${kijun.toFixed(4)},senkou_a=${senkouA.toFixed(4)}`;

  if (price > senkouA && tenkan > kijun) { signal = 1; detail = "bullish_cloud " + detail; }
  else if (price < senkouA && tenkan < kijun) { signal = -1; detail = "bearish_cloud " + detail; }

  return { value: signal, detail, name: "ichimoku_signal", family: "momentum" };
}

// ── Run all momentum strategies ─────────────────────────────────────────────

export function runMomentumStrategies(candles: Candle[]): Signal[] {
  return [
    simpleMomentum(candles),
    dualMomentum(candles),
    breakout(candles),
    donchianChannel(candles),
    maCrossover(candles),
    emaCrossover(candles),
    macdSignal(candles),
    supertrend(candles),
    ichimokuSignal(candles),
  ];
}

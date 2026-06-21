// CMC Strategy Skill Generator
// Takes current market context (CMC data + perps) and generates a backtestable StrategySpec via LLM.
// This is the core Track 2 deliverable — an LLM Skill powered by CMC.

import Groq from "groq-sdk";
import type { StrategySpec, SkillType, MarketContext } from "./types";
import { fetchFearGreed, fetchGlobalMetrics, fetchTopCMCTokens } from "@/lib/cmc";
import { fetchBulkPerpsContext } from "@/lib/perps";

const MODEL = "llama-3.3-70b-versatile";

const CORE_PERPS_SYMBOLS = ["BTC/USD", "ETH/USD", "BNB/USD", "SOL/USD"];

// ── Skill system prompts ────────────────────────────────────────────────────

const SKILL_PROMPTS: Record<SkillType, string> = {
  momentum: `You are a quantitative strategist building a momentum-based crypto trading skill.
Your strategy blends RSI, MACD, dual-momentum, and CMC Fear & Greed into precise entry and exit rules.
- In trending markets: require blended_signal > entry threshold and Fear & Greed confirmation
- In ranging markets: tighten thresholds significantly, reduce position size
- Entry: multiple momentum signals must agree before entry
- Exit: use ATR-based take profit (2.5× ATR) and stop loss (1.5× ATR), plus signal reversal failsafe
- Generate entry thresholds calibrated to current Fear & Greed level`,

  sentiment_divergence: `You are a quantitative strategist specialising in sentiment divergence.
Your strategy flags when CMC Fear & Greed index disagrees with technical momentum signals.
- Divergence bullish: Fear & Greed < 30 (fear) but technical signals turning positive → strong buy
- Divergence bearish: Fear & Greed > 70 (greed) but technical signals negative → strong sell
- No divergence: skip the trade (alignment = no edge)
- Entry only fires on confirmed divergence; position size scales with divergence magnitude
- Exit: time-limited (hold max 48 bars) or signal convergence`,

  regime_detection: `You are a quantitative strategist who uses perpetuals market data to detect macro regime.
Your strategy switches between momentum and mean-reversion based on perps positioning:
- If funding rate is extreme positive AND crowd is >60% long → regime = overheated_bull → use mean reversion
- If funding rate extreme negative AND crowd <40% long → regime = overheated_bear → use mean reversion
- Otherwise → follow momentum signals
- Regime detection has priority over technical signals when perps data conflicts
- Scale position size inversely with crowdedness (more crowded = smaller bet)`,

  perps_divergence: `You are a quantitative strategist who exploits divergence between spot and perpetuals markets.
Your strategy detects when perps positioning (funding + L/S ratio) contradicts spot price momentum.
- Spot rising + extreme positive funding + >65% longs → short squeeze setup (contrarian bearish)
- Spot falling + extreme negative funding + <35% longs → long squeeze setup (contrarian bullish)
- No divergence: pass
- Entry: only on confirmed divergence (both funding AND L/S ratio agree)
- Exit: faster than momentum trades — 24-48 bar time limit, tight stop`,
};

// ── Market context builder ──────────────────────────────────────────────────

async function buildMarketContext(universe: string[]): Promise<MarketContext & {
  perpsData: Record<string, { fundingRate: number | null; longShortRatio: number | null }>;
  topTokens: Array<{ symbol: string; priceUsd: number; change24h: number; volume24hUsd: number }>;
}> {
  const [fg, gm, topTokens, perpsMap] = await Promise.all([
    fetchFearGreed().catch(() => null),
    fetchGlobalMetrics().catch(() => null),
    fetchTopCMCTokens(20).catch(() => []),
    fetchBulkPerpsContext(CORE_PERPS_SYMBOLS).catch(() => new Map()),
  ]);

  const top10 = topTokens.slice(0, 10);
  const topMover = [...top10].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))[0];

  // Simple regime detection from Fear & Greed + market cap trend
  const regime = fg
    ? fg.value > 60 ? "trending" : fg.value < 40 ? "ranging" : "unknown"
    : "unknown";

  const perpsData: Record<string, { fundingRate: number | null; longShortRatio: number | null }> = {};
  for (const sym of CORE_PERPS_SYMBOLS) {
    const ctx = perpsMap.get(sym);
    if (ctx) perpsData[sym] = { fundingRate: ctx.fundingRate, longShortRatio: ctx.longShortRatio };
  }

  return {
    fearGreedValue:   fg?.value ?? 50,
    fearGreedLabel:   fg?.valueText ?? "Neutral",
    btcDominancePct:  gm?.btcDominancePct ?? 0,
    totalMarketCapUsd: gm?.totalMarketCapUsd ?? 0,
    regime: regime as MarketContext["regime"],
    topMoverSymbol:   topMover?.symbol ?? "BTC",
    topMoverChange24h: topMover?.change24h ?? 0,
    perpsData,
    topTokens: top10.map(t => ({
      symbol: t.symbol, priceUsd: t.priceUsd,
      change24h: t.change24h, volume24hUsd: t.volume24hUsd,
    })),
  };
}

// ── LLM spec generation ─────────────────────────────────────────────────────

function buildPrompt(
  skillType: SkillType,
  universe: string[],
  riskProfile: "conservative" | "balanced" | "aggressive",
  ctx: Awaited<ReturnType<typeof buildMarketContext>>,
  customMandate?: string,
): string {
  const perpsLines = Object.entries(ctx.perpsData)
    .map(([sym, d]) =>
      `  ${sym}: funding=${d.fundingRate !== null ? (d.fundingRate * 100).toFixed(4) + "%" : "N/A"}, L/S ratio=${d.longShortRatio?.toFixed(2) ?? "N/A"}`,
    )
    .join("\n");

  const topLines = ctx.topTokens
    .map(t => `  ${t.symbol}: $${t.priceUsd.toFixed(2)}, 24h ${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(2)}%`)
    .join("\n");

  return `${SKILL_PROMPTS[skillType]}

=== CURRENT MARKET CONTEXT (CMC + Binance Futures) ===
CMC Fear & Greed: ${ctx.fearGreedValue} (${ctx.fearGreedLabel})
BTC Dominance: ${ctx.btcDominancePct.toFixed(1)}%
Global Market Cap: $${(ctx.totalMarketCapUsd / 1e12).toFixed(2)}T
Detected Regime: ${ctx.regime}
Top Mover: ${ctx.topMoverSymbol} (${ctx.topMoverChange24h >= 0 ? "+" : ""}${ctx.topMoverChange24h.toFixed(2)}%)

Perps positioning (Binance Futures):
${perpsLines || "  (perps data unavailable)"}

Top 10 tokens by market cap:
${topLines}

=== STRATEGY PARAMETERS ===
Skill type: ${skillType}
Universe: ${universe.join(", ")}
Risk profile: ${riskProfile}
${customMandate ? `Custom mandate: ${customMandate}` : ""}

=== SIGNAL VALUE RANGES — CRITICAL ===
All signal values are normalised to [-1, +1]. Use these calibrated thresholds:

  blended_signal  : composite score in [-1, +1]. Bullish threshold: > 0.05 (moderate) or > 0.12 (strong)
  rsi_signal      : RSI mapped to [-1,+1]. Only non-zero in extremes: Oversold (RSI<30) → +0.3 to +1.0. Overbought (RSI>70) → -0.3 to -1.0. RSI 30-70 → 0.
                    To catch oversold bounce use: "rsi_signal > 0.3"
                    Do NOT use rsi_signal > 0.0 as a condition — it only fires at RSI<30 (extreme oversold).
  macd_signal     : MACD histogram normalised. Bullish crossover → +0.3 to +1. Bearish → -0.3 to -1. Near zero → 0.
                    Bullish confirmation: "macd_signal > 0.05"
  stochastic_signal: Stochastic %K/%D mapped to [-1,+1]. Oversold → +0.7. Overbought → -0.7.
  bollinger_reversion: Price vs Bollinger Bands in [-1,+1]. Below lower band → +0.8. Above upper → -0.8.
  ma_crossover    : 50/200 MA crossover in [-1,+1]. Golden cross → +1. Death cross → -1.
  ema_crossover   : Fast/slow EMA crossover in [-1,+1]. Bullish crossover → +0.5 to +1.
  z_score         : Price Z-score mapped to [-1,+1]. Below mean (buy dip) → positive values.
  fear_greed      : Treated as neutral in backtests (no historical series). Omit or use only as context.
  funding_rate    : Perps-only, unavailable in candle backtest. Skip in entryConditions for backtestability.
  ls_ratio        : Perps-only, unavailable in candle backtest. Skip in entryConditions for backtestability.

IMPORTANT: Generate 2–4 entry conditions using ONLY blended_signal and candle-based signals above.
Do NOT use funding_rate or ls_ratio in entryConditions — they are skipped in backtesting.
Set thresholds appropriate for the [-1,+1] range. Using threshold=30 for rsi_signal is WRONG.
ALWAYS set regimeFilter.allowedRegimes to ["trending", "ranging", "unknown"] — all three must be included.
Crypto markets frequently switch between trending and ranging; excluding any regime eliminates most trade opportunities.

=== OUTPUT FORMAT ===
Return ONLY valid JSON matching this schema exactly — no prose, no markdown fences:
{
  "name": "string — concise strategy name",
  "description": "string — 2–3 sentence description of what the strategy does and why",
  "rationale": "string — why these specific thresholds and rules suit the current market context",
  "entryConditions": [
    {
      "signal": "blended_signal | rsi_signal | macd_signal | stochastic_signal | bollinger_reversion | ma_crossover | ema_crossover | z_score",
      "operator": "> | < | >= | <= | between",
      "threshold": number,
      "threshold2": number_or_null,
      "description": "string"
    }
  ],
  "exitRules": [
    {
      "type": "stop_loss | take_profit | signal_reversal | time_limit",
      "value": number,
      "description": "string"
    }
  ],
  "positionSizing": {
    "method": "fixed_risk | kelly | vol_scaled",
    "riskPerTradePct": number,
    "maxPositionPct": number
  },
  "regimeFilter": {
    "allowedRegimes": ["trending", "ranging", "unknown"],
    "adxMin": number_or_null,
    "adxMax": number_or_null
  },
  "riskLimits": {
    "maxDrawdownPct": number,
    "maxOpenPositions": number,
    "dailyLossLimitPct": number
  }
}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function generateStrategySpec(opts: {
  skillType: SkillType;
  universe: string[];
  riskProfile: "conservative" | "balanced" | "aggressive";
  customMandate?: string;
}): Promise<StrategySpec> {
  const { skillType, universe, riskProfile, customMandate } = opts;

  const ctx = await buildMarketContext(universe);

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const prompt = buildPrompt(skillType, universe, riskProfile, ctx, customMandate);

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: "You are a quantitative trading strategist. Output only valid JSON — no markdown, no explanation outside the JSON object.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 1200,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let parsed: Partial<StrategySpec>;
  try {
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  const spec: StrategySpec = {
    id:          crypto.randomUUID(),
    name:        parsed.name ?? `${skillType} strategy`,
    description: parsed.description ?? "",
    rationale:   parsed.rationale ?? "",
    skillType,
    universe,
    entryConditions: parsed.entryConditions ?? [
      { signal: "blended_signal", operator: ">", threshold: 0.10, description: "Default: blended signal bullish" },
    ],
    exitRules: parsed.exitRules ?? [
      { type: "stop_loss",  value: 0.05, description: "5% stop loss" },
      { type: "take_profit", value: 0.10, description: "10% take profit" },
    ],
    positionSizing: parsed.positionSizing ?? { method: "fixed_risk", riskPerTradePct: 0.01, maxPositionPct: 0.20 },
    regimeFilter:   parsed.regimeFilter,
    riskLimits:     parsed.riskLimits ?? { maxDrawdownPct: 0.20, maxOpenPositions: 5, dailyLossLimitPct: 0.05 },
    generatedAt: new Date().toISOString(),
    marketContext: {
      fearGreedValue:    ctx.fearGreedValue,
      fearGreedLabel:    ctx.fearGreedLabel,
      btcDominancePct:   ctx.btcDominancePct,
      totalMarketCapUsd: ctx.totalMarketCapUsd,
      regime:            ctx.regime,
      topMoverSymbol:    ctx.topMoverSymbol,
      topMoverChange24h: ctx.topMoverChange24h,
    },
  };

  return spec;
}

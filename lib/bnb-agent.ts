// BNB AI Agent SDK integration
// Wraps the CFO engine as a BNB Chain AI agent with tool definitions
// Compatible with https://github.com/bnb-chain/bnbagent-sdk

import { fetchFearGreed, fetchGlobalMetrics, fetchBSCTokens } from "./cmc";
import { BSC_TOKENS, PANCAKE_V2_ROUTER } from "./bsc/tokens";

// ── Tool schema (BNB Agent SDK format) ────────────────────────────────────────

export const BNB_AGENT_TOOLS = [
  {
    name: "get_market_sentiment",
    description: "Fetch CMC Fear & Greed index and BTC dominance for BSC trading decisions",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_bsc_token_prices",
    description: "Get current prices and 24h changes for core BSC tokens (BNB, CAKE, ETH, BTC)",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_agent_wallet",
    description: "Return the agent's BSC wallet address and BNB balance",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_trading_signals",
    description: "Get multi-strategy signals (momentum, mean reversion, sentiment) for a BSC token",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Token symbol: BNB, CAKE, ETH, or BTC" },
      },
      required: ["symbol"],
    },
  },
] as const;

// ── Tool execution ─────────────────────────────────────────────────────────────

export async function executeBNBAgentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (toolName === "get_market_sentiment") {
    const [fg, gm] = await Promise.all([fetchFearGreed(), fetchGlobalMetrics()]);
    return {
      fearGreedValue: fg?.value ?? 50,
      fearGreedLabel: fg?.valueText ?? "Neutral",
      btcDominancePct: gm?.btcDominancePct ?? null,
      totalMarketCapUsd: gm?.totalMarketCapUsd ?? null,
      signal: fg
        ? fg.value <= 25 ? "strong_buy"
        : fg.value <= 40 ? "buy"
        : fg.value <= 60 ? "neutral"
        : fg.value <= 75 ? "sell"
        : "strong_sell"
        : "neutral",
    };
  }

  if (toolName === "get_bsc_token_prices") {
    const tokens = await fetchBSCTokens();
    const core = ["BNB", "CAKE", "ETH", "BTC"];
    return core.map(sym => {
      const t = tokens.find(t => t.symbol === sym);
      return t
        ? { symbol: sym, priceUsd: t.priceUsd, change24h: t.change24h, marketCapUsd: t.marketCapUsd }
        : { symbol: sym, priceUsd: null, change24h: null };
    });
  }

  if (toolName === "get_agent_wallet") {
    const address = (args.walletAddress as string | undefined) ?? null;
    return {
      address: address ?? "call POST /api/cfo/wallet to create one",
      chain: "BNB Smart Chain",
      chainId: 56,
      dex: "PancakeSwap V2",
      routerAddress: PANCAKE_V2_ROUTER,
      explorer: address ? `https://bscscan.com/address/${address}` : null,
      note: "Each user has their own isolated agent wallet — private key is AES-256-GCM encrypted server-side.",
    };
  }

  if (toolName === "get_trading_signals") {
    const sym = String(args.symbol ?? "BNB").toUpperCase();
    const token = BSC_TOKENS.find(t => t.symbol === sym);
    if (!token) return { error: `Unknown BSC token: ${sym}` };

    // Import dynamically to avoid circular deps
    const { fetchCFOCandles } = await import("./cfo/market-data");
    const { runMomentumStrategies, adxFilter } = await import("./cfo/strategies/momentum");
    const { runMeanReversionStrategies } = await import("./cfo/strategies/mean-reversion");
    const { arbitrate } = await import("./cfo/arbitration");
    const { runSentimentStrategies } = await import("./cfo/strategies/sentiment");

    const candles = await fetchCFOCandles(token.pythSymbol);
    if (candles.length < 30) return { error: "Insufficient candle data" };

    const { isTrending, adxValue } = adxFilter(candles);
    const allSignals = [
      ...runMomentumStrategies(candles).filter(s => s.name !== "adx_filter"),
      ...runMeanReversionStrategies(candles),
      ...(await runSentimentStrategies().catch(() => [])),
    ];
    const arb = arbitrate(allSignals, adxValue, isTrending);

    return {
      symbol: sym,
      blendedSignal: arb.blendedSignal,
      direction: arb.blendedSignal > 0.08 ? "buy" : arb.blendedSignal < -0.08 ? "sell" : "hold",
      regime: arb.regime,
      adx: adxValue,
      signalCount: allSignals.length,
      topSignals: allSignals.slice(0, 3).map(s => ({ name: s.name, value: s.value, detail: s.detail })),
    };
  }

  return { error: `Unknown tool: ${toolName}` };
}

// ── Agent metadata ─────────────────────────────────────────────────────────────

export const BNB_AGENT_CONFIG = {
  name: "Ski — BSC Autonomous Trading Agent",
  description: "An AI agent that reads BSC markets via CMC Fear & Greed and multi-strategy signals, then autonomously signs and submits trades on BSC via PancakeSwap (Trust Wallet Agent Kit).",
  chain: "bsc",
  chainId: 56,
  dataSources: ["CoinMarketCap AI Agent Hub", "Binance OHLCV API", "PancakeSwap V2"],
  execution: "Trust Wallet Agent Kit (TWAK) → PancakeSwap V2 Router",
  strategies: ["Momentum", "Mean Reversion", "Volatility", "Volume", "Statistical", "Smart Money", "CMC Sentiment"],
  riskControls: ["Kelly criterion sizing", "Max drawdown circuit breaker", "Per-trade cap", "LLM sanity check"],
} as const;

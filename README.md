# Ski — Your Personal On-Chain CFO

Ski lets anyone spin up a personal AI Chief Financial Officer. It reads your Injective
portfolio, applies proven strategies (DCA, RSI, momentum, rebalancing), and delivers
CFO-grade guidance in plain language. No finance degree required.

Built for the **Injective Solo AI Builder Sprint**.

Live site: https://ski-trade.vercel.app

## What it does

- **Portfolio intelligence.** Reads live wallet balances on Injective, computes allocation,
  value, and concentration risk, then writes a natural-language CFO Report.
- **Strategy-driven advice.** Deterministic strategy math (RSI, momentum, target allocation,
  DCA sizing) produces signals; the AI explains why each fits your profile and how much to act on.
- **Conversational Q&A.** A chat that knows your real positions and answers questions like
  "should I take profit on my INJ?" with sized, reasoned answers.
- **CFO persona.** Set risk tolerance, goal, and horizon once; every recommendation is shaped to you.

## How AI is used

The reasoning engine is **Groq (Llama 3.3 70B)**. It receives structured context (the user's
persona, live portfolio, market signals, and the pre-computed strategy signals) and synthesizes
a CFO report and chat answers. The strategy math is deterministic and computed in `lib/strategies.ts`,
so the numbers are reproducible; the AI reasons on top of them rather than inventing figures.

If `GROQ_API_KEY` is absent, the app still works end to end. Portfolio data and deterministic
strategy signals render; only the AI narrative is disabled.

## Injective integration

Live spot prices and wallet portfolio data come directly from the Injective mainnet indexer via
`@injectivelabs/sdk-ts` (`IndexerGrpcAccountPortfolioApi`). Tracked spot markets: INJ, ATOM, WETH,
SOL, TIA. Wallets connect by pasting an `inj1…` address or via Keplr. Everything is read-only;
Ski never asks to sign a transaction or move funds.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · Groq API (Llama 3.3 70B) ·
`@injectivelabs/sdk-ts` · CoinGecko API · Zustand · Recharts · Vercel.

## Project structure

```
app/
  page.tsx              Landing
  setup/page.tsx        CFO persona builder
  dashboard/page.tsx    Portfolio + report + strategy signals
  chat/page.tsx         Conversational CFO
  api/
    portfolio/route.ts  Injective balances + market signals
    cfo-report/route.ts AI CFO report
    chat/route.ts       AI chat
components/             Nav, WalletConnect, AllocationChart, CFOReport, StrategyCard, ...
lib/
  injective.ts          Portfolio fetch + demo wallet
  market.ts             Market signals (price, 24h/7d, RSI)
  strategies.ts         RSI / momentum / rebalance / DCA math + suggestion engine
  groq.ts               Prompt construction + Groq client
  coingecko.ts          Prices and price series
store/cfoStore.ts       Persona + wallet state (persisted to localStorage)
```

## Run locally

```bash
npm install
cp .env.example .env.local   # add your free Groq key
npm run dev
```

Open http://localhost:3000, build your CFO, then connect a wallet or use the demo wallet.

## Roadmap

- **Phase 2, Telegram CFO.** An OpenClaw gateway so the same CFO reasoning reaches users
  proactively on Telegram (P&L swings, RSI signals, rebalance nudges).
- Historical P&L tracking and a monthly CFO summary.
- Optional on-chain execution of suggested rebalances on Injective spot markets.

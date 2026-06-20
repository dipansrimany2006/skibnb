"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { AppNav } from "@/components/app-nav";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Position {
  id: string;
  asset_id: string;
  symbol: string;
  display_symbol: string;
  name: string;
  category: string;
  quantity: number;
  avg_buy_price: number;
}

interface Trade {
  id: string;
  symbol: string;
  display_symbol: string;
  name: string;
  trade_type: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
  created_at: string;
}

interface Portfolio {
  balance: number;
  positions: Position[];
  trades: Trade[];
}

interface LiveData {
  price: number;
  change24h: number;
  logo: string;
}

type Tab = "chart" | "allocation" | "statistics";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, opts?: { digits?: number }): string {
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: opts?.digits ?? (Math.abs(n) >= 1 ? 2 : 6),
  }).format(n);
}

function fmtQty(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n < 0.01 ? n.toFixed(6) : n.toFixed(4);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const PALETTE = ["#10b981","#8b5cf6","#f59e0b","#3b82f6","#ec4899","#6366f1","#ef4444","#14b8a6"];
function assetColor(sym: string, idx: number) { return PALETTE[idx % PALETTE.length]; }

function AssetLogo({ symbol, logo, color, size = 36 }: { symbol: string; logo: string; color: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!logo || err) {
    return (
      <div className="rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
        style={{ width: size, height: size, background: color }}>
        {symbol.slice(0, 2)}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logo} alt={symbol} width={size} height={size} onError={() => setErr(true)} className="rounded-full shrink-0" style={{ width: size, height: size }} />;
}

function buildChartData(trades: Trade[], balance: number): { label: string; value: number }[] {
  const now = Date.now();
  const sorted = [...trades].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const points: { label: string; value: number }[] = [];
  const startTime = sorted.length ? new Date(sorted[0].created_at).getTime() - 60_000 : now - 3_600_000;
  points.push({ label: new Date(startTime).toLocaleDateString(), value: 10_000 });
  let running = 10_000;
  for (const t of sorted) {
    running += t.trade_type === "sell" ? t.total : -t.total;
    points.push({ label: new Date(t.created_at).toLocaleDateString(), value: Math.max(0, running) });
  }
  points.push({ label: new Date().toLocaleDateString(), value: balance });
  return points;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatChip({ label, pct, usd, positive }: { label: string; pct: number; usd: number; positive: boolean }) {
  return (
    <div>
      <p className="text-xs text-white/40 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
        {positive ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}% ({positive ? "+" : ""}{fmt(usd)})
      </p>
    </div>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2 text-xs shadow-xl">
      <p className="text-white font-semibold">{fmt(payload[0].value)}</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();
  const [portfolio,  setPortfolio]  = useState<Portfolio | null>(null);
  const [liveData,   setLiveData]   = useState<Map<string, LiveData>>(new Map());
  const [loading,    setLoading]    = useState(true);
  const [authed,     setAuthed]     = useState(true);
  const [tab,        setTab]        = useState<Tab>("allocation");
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/paper/portfolio")
      .then(r => { if (r.status === 401) { setAuthed(false); return null; } return r.json(); })
      .then(raw => {
        const d = raw as Portfolio | null;
        if (!d) return;
        setPortfolio(d);
        if (d.positions.length > 0) {
          Promise.all(
            d.positions.map(pos =>
              fetch(`/api/asset/${pos.display_symbol.replace("/", "-")}`)
                .then(r => r.ok ? r.json() : null)
                .then(a => {
                  const asset = (a as { asset?: { priceUsd: number; change24h: number; logo: string } } | null)?.asset;
                  return asset ? [pos.display_symbol, { price: asset.priceUsd, change24h: asset.change24h, logo: asset.logo ?? "" }] as [string, LiveData] : null;
                })
                .catch(() => null)
            )
          ).then(results => {
            const map = new Map<string, LiveData>();
            for (const r of results) if (r) map.set(r[0], r[1]);
            setLiveData(map);
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    const handler = () => setActionMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const positions = portfolio?.positions ?? [];
  const trades    = portfolio?.trades    ?? [];

  const openValue = useMemo(() =>
    positions.reduce((s, p) => s + p.quantity * (liveData.get(p.display_symbol)?.price ?? p.avg_buy_price), 0),
  [positions, liveData]);

  const totalValue  = (portfolio?.balance ?? 0) + openValue;
  const totalReturn = totalValue - 10_000;
  const returnPct   = (totalReturn / 10_000) * 100;

  // 24H portfolio change
  const change24hUsd = useMemo(() =>
    positions.reduce((s, p) => {
      const ld = liveData.get(p.display_symbol);
      if (!ld) return s;
      return s + p.quantity * ld.price * (ld.change24h / 100);
    }, 0),
  [positions, liveData]);
  const change24hPct = totalValue > 0 ? (change24hUsd / totalValue) * 100 : 0;

  // Best / worst performer
  const performers = useMemo(() =>
    positions.map(p => {
      const live = liveData.get(p.display_symbol)?.price ?? p.avg_buy_price;
      const pnl  = p.quantity * (live - p.avg_buy_price);
      const pct  = p.avg_buy_price > 0 ? ((live - p.avg_buy_price) / p.avg_buy_price) * 100 : 0;
      return { symbol: p.symbol, pnl, pct };
    }),
  [positions, liveData]);

  const best  = performers.length ? performers.reduce((a, b) => b.pct > a.pct ? b : a) : null;
  const worst = performers.length ? performers.reduce((a, b) => b.pct < a.pct ? b : a) : null;

  // Allocation
  const allocItems = useMemo(() => {
    if (!portfolio || totalValue === 0) return [];
    const items = [
      ...positions.map((p, i) => ({
        label: p.symbol,
        pct: ((p.quantity * (liveData.get(p.display_symbol)?.price ?? p.avg_buy_price)) / totalValue) * 100,
        color: PALETTE[i % PALETTE.length],
      })),
      { label: "Cash", pct: ((portfolio.balance) / totalValue) * 100, color: "#4b5563" },
    ];
    return items.filter(i => i.pct > 0.1).sort((a, b) => b.pct - a.pct);
  }, [portfolio, positions, liveData, totalValue]);

  const chartData = useMemo(() => buildChartData(trades, portfolio?.balance ?? 10_000), [trades, portfolio]);
  const chartMin  = useMemo(() => Math.min(...chartData.map(d => d.value)) * 0.998, [chartData]);
  const chartMax  = useMemo(() => Math.max(...chartData.map(d => d.value)) * 1.002, [chartData]);

  // ── Unauthenticated ───────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppNav active="Portfolio" />
        <main className="mx-auto max-w-4xl px-6 py-32 text-center">
          <p className="text-white/40 mb-6">Sign in to view your portfolio</p>
          <Link href="/login" className="rounded-2xl bg-white text-black px-8 py-3 text-sm font-semibold">Sign In</Link>
        </main>
      </div>
    );
  }

  const pos24Up = change24hUsd >= 0;
  const totalUp = totalReturn >= 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav active="Portfolio" />

      <main className="mx-auto max-w-6xl px-8 py-8">

        {/* ── Page title ──────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">Portfolio</h1>
          <p className="text-white/30 text-sm mt-1 italic">
            Updated on {fmtDate(new Date().toISOString())}
          </p>
        </div>

        {/* ── Balance row ─────────────────────────────────────────────────── */}
        <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
          <div>
            <p className="text-xs text-white/40 mb-1 flex items-center gap-1">
              Current balance
              <span className="text-white/20 text-[10px] border border-white/15 rounded-full w-4 h-4 flex items-center justify-center leading-none">i</span>
            </p>
            {loading ? (
              <div className="h-12 w-56 animate-pulse rounded-xl bg-white/5" />
            ) : (
              <>
                <p className="text-5xl font-bold tracking-tight">{fmt(totalValue)}</p>
                <p className={`text-sm mt-1.5 font-semibold flex items-center gap-2 ${pos24Up ? "text-emerald-400" : "text-rose-400"}`}>
                  {pos24Up ? "+" : ""}{fmt(change24hUsd)} ({pos24Up ? "+" : ""}{change24hPct.toFixed(2)}%)
                  <span className="text-xs bg-white/8 text-white/40 rounded-md px-1.5 py-0.5 font-normal">24H</span>
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/cfo"
              className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white/70 hover:text-white hover:border-white/30 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              CFO Settings
            </Link>
            <Link
              href="/cfo"
              className="flex items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2.5 text-sm font-semibold transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
              </svg>
              Run CFO
            </Link>
          </div>
        </div>

        {/* ── Stats strip ─────────────────────────────────────────────────── */}
        {!loading && (
          <div className="flex items-center gap-10 mb-8 flex-wrap">
            <StatChip
              label="All time profit"
              pct={returnPct}
              usd={totalReturn}
              positive={totalUp}
            />
            {best && (
              <div className="flex items-center gap-2">
                <span className="text-lg">💎</span>
                <StatChip label="Best performer" pct={best.pct} usd={best.pnl} positive={best.pct >= 0} />
              </div>
            )}
            {worst && worst.symbol !== best?.symbol && (
              <div className="flex items-center gap-2">
                <span className="text-lg">📉</span>
                <StatChip label="Worst performer" pct={worst.pct} usd={worst.pnl} positive={worst.pct >= 0} />
              </div>
            )}
          </div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-6">
          {(["chart", "allocation", "statistics"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-5 py-2 text-sm font-medium capitalize transition-all ${
                tab === t
                  ? "bg-white text-black"
                  : "border border-white/15 text-white/50 hover:text-white hover:border-white/30"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl bg-white/5 mb-8" />
        ) : tab === "chart" ? (
          <div className="h-52 mb-8">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={totalUp ? "#10b981" : "#f43f5e"} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={totalUp ? "#10b981" : "#f43f5e"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" hide />
                <YAxis domain={[chartMin, chartMax]} hide />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="value"
                  stroke={totalUp ? "#10b981" : "#f43f5e"} strokeWidth={2}
                  fill="url(#portGrad)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

        ) : tab === "allocation" ? (
          <div className="mb-8">
            {allocItems.length === 0 ? (
              <p className="text-sm text-white/30 py-8 text-center">No holdings to allocate</p>
            ) : (
              <>
                {/* Stacked bar */}
                <div className="flex h-12 rounded-lg overflow-hidden mb-4 gap-0.5">
                  {allocItems.map((item, i) => (
                    <div
                      key={item.label}
                      className="h-full transition-all duration-700 first:rounded-l-lg last:rounded-r-lg"
                      style={{ width: `${item.pct}%`, background: item.color }}
                      title={`${item.label} ${item.pct.toFixed(2)}%`}
                    />
                  ))}
                </div>
                {/* Legend */}
                <div className="flex items-center flex-wrap gap-6">
                  {allocItems.map(item => (
                    <span key={item.label} className="flex items-center gap-1.5 text-sm text-white/60">
                      <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                      {item.label}
                      <span className="text-white/30">{item.pct.toFixed(2)}%</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

        ) : (
          /* Statistics tab */
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total trades",    value: String(trades.length) },
              { label: "Buy orders",      value: String(trades.filter(t => t.trade_type === "buy").length) },
              { label: "Sell orders",     value: String(trades.filter(t => t.trade_type === "sell").length) },
              { label: "Open positions",  value: String(positions.length) },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                <p className="text-xs text-white/40 uppercase tracking-wider mb-2">{s.label}</p>
                <p className="text-3xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Your holdings ────────────────────────────────────────────────── */}
        <h2 className="text-2xl font-bold mb-5">Your holdings</h2>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/5" />)}
          </div>
        ) : positions.length === 0 ? (
          <div className="rounded-2xl border border-white/8 py-16 text-center">
            <p className="text-white/30 mb-3">No holdings yet</p>
            <Link href="/cfo" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
              Enable CFO to start trading →
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/8 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1fr_80px_1fr_1fr_1fr_90px] gap-4 px-6 py-3.5 text-xs font-medium text-white/30 uppercase tracking-widest border-b border-white/8 bg-white/[0.015]">
              <span>Assets</span>
              <span className="text-right">Price</span>
              <span className="text-right">24H</span>
              <span className="text-right">Balance</span>
              <span className="text-right">Avg buy</span>
              <span className="text-right">Profit / Loss</span>
              <span className="text-right">Actions</span>
            </div>

            {positions.map((pos, idx) => {
              const ld      = liveData.get(pos.display_symbol);
              const live    = ld?.price   ?? pos.avg_buy_price;
              const chg24   = ld?.change24h ?? 0;
              const pnl     = pos.quantity * (live - pos.avg_buy_price);
              const pnlPct  = pos.avg_buy_price > 0 ? ((live - pos.avg_buy_price) / pos.avg_buy_price) * 100 : 0;
              const up      = pnl >= 0;
              const chgUp   = chg24 >= 0;
              const slug    = pos.display_symbol.replace("/", "-");
              const color   = assetColor(pos.symbol, idx);

              return (
                <div
                  key={pos.id}
                  onClick={() => router.push(`/explore/${slug}`)}
                  className="grid grid-cols-[2fr_1fr_80px_1fr_1fr_1fr_90px] gap-4 px-6 py-4 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors items-center cursor-pointer group"
                >
                  {/* Asset */}
                  <div className="flex items-center gap-3 min-w-0">
                    <AssetLogo symbol={pos.symbol} logo={ld?.logo ?? ""} color={color} />
                    <div className="min-w-0">
                      <span className="text-sm font-semibold group-hover:text-white transition-colors">{pos.name} </span>
                      <span className="text-xs text-white/30 uppercase">{pos.symbol}</span>
                    </div>
                  </div>

                  {/* Price */}
                  <p className="text-sm text-right font-mono">{fmt(live)}</p>

                  {/* 24H */}
                  <p className={`text-sm text-right font-semibold ${chgUp ? "text-emerald-400" : "text-rose-400"}`}>
                    {chgUp ? "▲" : "▼"} {Math.abs(chg24).toFixed(2)}%
                  </p>

                  {/* Balance (qty) */}
                  <p className="text-sm text-right font-mono text-white/70">{fmtQty(pos.quantity)}</p>

                  {/* Avg buy */}
                  <p className="text-sm text-right text-white/50 font-mono">{fmt(pos.avg_buy_price)}</p>

                  {/* P&L */}
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                      {up ? "+" : ""}{fmt(pnl)}
                    </p>
                    <p className={`text-xs mt-0.5 ${up ? "text-emerald-400/60" : "text-rose-400/60"}`}>
                      {up ? "+" : ""}{pnlPct.toFixed(2)}%
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                    <Link
                      href={`/explore/${slug}`}
                      className="w-7 h-7 rounded-full border border-white/15 flex items-center justify-center text-white/50 hover:text-white hover:border-white/30 transition-all"
                      title="Trade"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
                      </svg>
                    </Link>
                    <div className="relative">
                      <button
                        onClick={() => setActionMenu(m => m === pos.id ? null : pos.id)}
                        className="w-7 h-7 rounded-full border border-white/15 flex items-center justify-center text-white/50 hover:text-white hover:border-white/30 transition-all"
                        title="More"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                        </svg>
                      </button>
                      {actionMenu === pos.id && (
                        <div className="absolute right-0 top-9 z-50 w-40 rounded-xl border border-white/10 bg-[#111] shadow-xl overflow-hidden">
                          <Link
                            href={`/explore/${slug}`}
                            onClick={() => setActionMenu(null)}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            View asset
                          </Link>
                          <Link
                            href="/cfo"
                            onClick={() => setActionMenu(null)}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm text-rose-400 hover:bg-white/5 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                            Exit via CFO
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Recent transactions ──────────────────────────────────────────── */}
        {trades.length > 0 && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold mb-5">Recent transactions</h2>
            <div className="rounded-2xl border border-white/8 overflow-hidden">
              <div className="grid grid-cols-[2fr_80px_1fr_1fr_1fr] gap-4 px-6 py-3.5 text-xs font-medium text-white/30 uppercase tracking-widest border-b border-white/8 bg-white/[0.015]">
                <span>Asset</span>
                <span className="text-center">Type</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Price</span>
                <span className="text-right">Total · Date</span>
              </div>
              {trades.slice(0, 10).map((t, idx) => (
                <div
                  key={t.id}
                  onClick={() => router.push(`/explore/${t.display_symbol.replace("/", "-")}`)}
                  className="grid grid-cols-[2fr_80px_1fr_1fr_1fr] gap-4 px-6 py-4 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors items-center cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AssetLogo symbol={t.symbol} logo={liveData.get(t.display_symbol)?.logo ?? ""} color={PALETTE[idx % PALETTE.length]} size={32} />
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-white/30">{t.display_symbol}</p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${t.trade_type === "buy" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                      {t.trade_type.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-right font-mono text-white/60">{fmtQty(t.quantity)}</p>
                  <p className="text-sm text-right font-mono text-white/60">{fmt(t.price)}</p>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{fmt(t.total)}</p>
                    <p className="text-xs text-white/30 mt-0.5">
                      {new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

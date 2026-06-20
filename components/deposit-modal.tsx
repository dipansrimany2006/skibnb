"use client";

import { useState, useEffect } from "react";
import { useWallets } from "@privy-io/react-auth";
import { MANTLE_SEPOLIA, CFO_VAULT_ADDRESS, fmtMnt, mntToHexWei } from "@/lib/mantle";

type Step = "amount" | "confirm" | "signing" | "broadcasting" | "success" | "error";

interface DepositModalProps {
  open:        boolean;
  mntPrice:    number;          // live MNT/USD for display
  onClose:     () => void;
  onSuccess:   (newBalanceUsd: number, mntAmount: number) => void;
}

const QUICK_AMOUNTS = [50, 100, 500, 1000];

function shortHash(h: string) {
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}

async function switchToMantle(provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MANTLE_SEPOLIA.chainIdHex }],
    });
  } catch (err: unknown) {
    // Chain not added yet — add it
    if ((err as { code?: number }).code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId:          MANTLE_SEPOLIA.chainIdHex,
          chainName:        MANTLE_SEPOLIA.name,
          nativeCurrency:   { name: "MNT", symbol: "MNT", decimals: 18 },
          rpcUrls:          [MANTLE_SEPOLIA.rpcUrl],
          blockExplorerUrls: [MANTLE_SEPOLIA.explorerUrl],
        }],
      });
    } else {
      throw err;
    }
  }
}

export function DepositModal({ open, mntPrice, onClose, onSuccess }: DepositModalProps) {
  const { wallets } = useWallets();
  const wallet = wallets[0];

  const [step,       setStep]       = useState<Step>("amount");
  const [rawAmount,  setRawAmount]  = useState("");
  const [txHash,     setTxHash]     = useState("");
  const [errorMsg,   setErrorMsg]   = useState("");
  const [newBalUsd,  setNewBalUsd]  = useState(0);
  const [mntDeposited, setMntDeposited] = useState(0);

  const mntAmount = parseFloat(rawAmount) || 0;
  const usdValue  = mntPrice > 0 ? mntAmount * mntPrice : 0;

  useEffect(() => {
    if (open) { setStep("amount"); setRawAmount(""); setTxHash(""); setErrorMsg(""); }
  }, [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleDeposit() {
    if (!wallet || mntAmount <= 0) return;
    setStep("signing");
    setErrorMsg("");

    try {
      const provider = await wallet.getEthereumProvider();

      // Switch to Mantle Sepolia
      await switchToMantle(provider);

      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      const from     = accounts[0] ?? wallet.address;
      const value    = mntToHexWei(mntAmount);

      // Send MNT to the CFO vault address
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from, to: CFO_VAULT_ADDRESS, value, gas: "0x5208" }],
      }) as string;

      setTxHash(hash);
      setMntDeposited(mntAmount);
      setStep("broadcasting");

      // Wait for the animation to feel real, then credit
      await new Promise(r => setTimeout(r, 2500));

      const res  = await fetch("/api/paper/deposit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mntAmount, txHash: hash }),
      });
      const data = await res.json() as { ok?: boolean; newBalanceUsd?: number; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Deposit failed");

      setNewBalUsd(data.newBalanceUsd ?? 0);
      setStep("success");
      onSuccess(data.newBalanceUsd ?? 0, mntAmount);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(
        msg.includes("4001") || msg.toLowerCase().includes("rejected")
          ? "Transaction cancelled by user."
          : msg
      );
      setStep("error");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#080808] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            {/* Mantle logo mark */}
            <div className="w-8 h-8 rounded-lg bg-[#1a1a2e] border border-[#6366f1]/30 flex items-center justify-center">
              <span className="text-sm font-bold text-[#6366f1]">M</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-tight">Deposit to CFO</h2>
              <p className="text-[11px] text-white/30 mt-0.5">Mantle Network · MNT</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/8 transition-all text-sm">✕</button>
        </div>

        <div className="px-6 py-5">

          {/* ── Amount ─────────────────────────────────────────────────── */}
          {step === "amount" && (
            <div className="space-y-4">
              {/* Amount input */}
              <div>
                <p className="text-[11px] text-white/35 mb-2 uppercase tracking-widest">Amount</p>
                <div className="relative rounded-xl bg-white/[0.04] border border-white/10 focus-within:border-white/20 transition-colors">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={rawAmount}
                    onChange={e => setRawAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent pl-4 pr-20 py-4 text-2xl font-semibold text-white placeholder:text-white/15 focus:outline-none"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#6366f1]">MNT</span>
                </div>
                {mntAmount > 0 && mntPrice > 0 && (
                  <p className="text-xs text-white/30 mt-1.5 pl-1">
                    ≈ ${usdValue.toFixed(2)} USD · 1 MNT = ${mntPrice.toFixed(4)}
                  </p>
                )}
              </div>

              {/* Quick amounts */}
              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map(n => (
                  <button
                    key={n}
                    onClick={() => setRawAmount(String(n))}
                    className={`rounded-lg py-2 text-xs font-medium transition-all border ${
                      mntAmount === n
                        ? "border-[#6366f1]/60 bg-[#6366f1]/15 text-[#818cf8]"
                        : "border-white/8 bg-white/[0.03] text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
                    }`}
                  >
                    {n} MNT
                  </button>
                ))}
              </div>

              {/* Info */}
              <div className="rounded-xl bg-white/[0.025] border border-white/6 divide-y divide-white/6">
                {[
                  { label: "Network",    value: "Mantle Sepolia" },
                  { label: "Managed by", value: "Your AI CFO" },
                  { label: "Est. gas",   value: "< 0.001 MNT" },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center px-4 py-2.5 text-xs">
                    <span className="text-white/35">{r.label}</span>
                    <span className="text-white/70">{r.value}</span>
                  </div>
                ))}
              </div>

              {!wallet && (
                <p className="text-xs text-amber-400 text-center">Connect a wallet to continue</p>
              )}

              <button
                onClick={() => setStep("confirm")}
                disabled={mntAmount <= 0 || !wallet}
                className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background py-3 text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Review deposit
              </button>
            </div>
          )}

          {/* ── Confirm ────────────────────────────────────────────────── */}
          {step === "confirm" && (
            <div className="space-y-4">
              {/* Big amount display */}
              <div className="rounded-2xl bg-[#6366f1]/8 border border-[#6366f1]/20 px-5 py-5 text-center">
                <p className="text-3xl font-bold text-white">{fmtMnt(mntAmount)}</p>
                {mntPrice > 0 && (
                  <p className="text-sm text-white/35 mt-1">≈ ${usdValue.toFixed(2)} USD</p>
                )}
              </div>

              <div className="rounded-xl bg-white/[0.025] border border-white/6 divide-y divide-white/6">
                {[
                  { label: "Destination",  value: "CFO vault" },
                  { label: "Network",      value: "Mantle Sepolia" },
                  { label: "Token",        value: "MNT (native)" },
                ].map(r => (
                  <div key={r.label} className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-white/35">{r.label}</span>
                    <span className="font-medium">{r.value}</span>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-white/25 text-center leading-relaxed px-2">
                Your wallet will open to approve this transaction. Once confirmed on Mantle, your CFO balance updates instantly.
              </p>

              <div className="flex gap-2.5">
                <button onClick={() => setStep("amount")} className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-white/45 hover:bg-white/5 transition-colors">
                  Back
                </button>
                <button onClick={handleDeposit} className="flex-1 rounded-xl bg-foreground hover:bg-foreground/90 text-background py-3 text-sm font-semibold transition-colors">
                  Confirm
                </button>
              </div>
            </div>
          )}

          {/* ── Signing ────────────────────────────────────────────────── */}
          {step === "signing" && (
            <div className="py-10 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full border border-[#6366f1]/30 bg-[#6366f1]/8 flex items-center justify-center">
                <span className="w-6 h-6 border-2 border-[#6366f1]/30 border-t-[#6366f1] rounded-full animate-spin inline-block" />
              </div>
              <div>
                <p className="font-semibold text-sm">Waiting for wallet</p>
                <p className="text-xs text-white/35 mt-1">Approve the transaction in your wallet</p>
              </div>
            </div>
          )}

          {/* ── Broadcasting ───────────────────────────────────────────── */}
          {step === "broadcasting" && (
            <div className="py-10 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full border border-emerald-500/30 bg-emerald-500/8 flex items-center justify-center">
                <span className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin inline-block" />
              </div>
              <div>
                <p className="font-semibold text-sm">Confirming on Mantle</p>
                <p className="text-xs text-white/35 mt-1">Crediting your CFO balance…</p>
              </div>
              {txHash && (
                <p className="font-mono text-[10px] text-white/20">{shortHash(txHash)}</p>
              )}
            </div>
          )}

          {/* ── Success ────────────────────────────────────────────────── */}
          {step === "success" && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/12 border border-emerald-500/30 flex items-center justify-center text-xl">
                ✓
              </div>
              <div>
                <p className="font-semibold text-base">Deposit confirmed</p>
                <p className="text-sm text-white/40 mt-1">
                  {fmtMnt(mntDeposited)} added to your CFO
                </p>
              </div>

              <div className="rounded-xl bg-white/[0.025] border border-white/6 divide-y divide-white/6">
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-white/35">CFO balance</span>
                  <span className="font-semibold text-emerald-400">
                    {mntPrice > 0 ? fmtMnt(newBalUsd / mntPrice) : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center px-4 py-3 text-xs">
                  <span className="text-white/35">Transaction</span>
                  <a
                    href={`${MANTLE_SEPOLIA.explorerUrl}/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[#818cf8] hover:underline"
                  >
                    {shortHash(txHash)} ↗
                  </a>
                </div>
              </div>

              <button onClick={onClose} className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background py-3 text-sm font-semibold transition-colors">
                Done
              </button>
            </div>
          )}

          {/* ── Error ──────────────────────────────────────────────────── */}
          {step === "error" && (
            <div className="py-8 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-xl">✕</div>
              <div>
                <p className="font-semibold text-sm">Deposit failed</p>
                <p className="text-xs text-white/35 mt-1 px-4 leading-relaxed">{errorMsg || "Something went wrong."}</p>
              </div>
              <div className="flex gap-2.5">
                <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-3 text-sm text-white/45 hover:bg-white/5 transition-colors">Cancel</button>
                <button onClick={() => setStep("amount")} className="flex-1 rounded-xl bg-foreground hover:bg-foreground/90 text-background py-3 text-sm font-semibold transition-colors">Try again</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

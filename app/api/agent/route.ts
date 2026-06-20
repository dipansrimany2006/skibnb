// GET  /api/agent — BNB AI Agent SDK metadata + status
// POST /api/agent — execute a BNB agent tool call

import { NextRequest, NextResponse } from "next/server";
import { BNB_AGENT_CONFIG, BNB_AGENT_TOOLS, executeBNBAgentTool } from "@/lib/bnb-agent";
import { fetchFearGreed, fetchGlobalMetrics } from "@/lib/cmc";
import { getSessionUser } from "@/lib/auth";
import { getUserById, getDB } from "@/lib/db";
import { getWalletBNBBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);

  const [fg, gm] = await Promise.all([
    fetchFearGreed().catch(() => null),
    fetchGlobalMetrics().catch(() => null),
  ]);

  let walletInfo = null;
  if (session) {
    const db   = getDB();
    const user = await getUserById(db, session.userId);
    if (user?.cfo_wallet_address) {
      const balance = user.cfo_wallet_key
        ? await getWalletBNBBalance(user.cfo_wallet_key).catch(() => 0)
        : 0;
      walletInfo = {
        address:    user.cfo_wallet_address,
        balanceBNB: balance,
        funded:     balance >= 0.01,
        mode:       balance >= 0.01 ? "live-bsc" : "paper-trade",
      };
    }
  }

  return NextResponse.json({
    agent:  BNB_AGENT_CONFIG,
    tools:  BNB_AGENT_TOOLS,
    status: {
      wallet:        walletInfo,
      fearGreed:     fg ? { value: fg.value, label: fg.valueText } : null,
      btcDominance:  gm?.btcDominancePct ?? null,
      authenticated: !!session,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { tool: string; args?: Record<string, unknown> };
  const { tool, args = {} } = body;
  if (!tool) return NextResponse.json({ error: "Missing tool name" }, { status: 400 });

  const session = await getSessionUser(req);
  if (session) {
    const db   = getDB();
    const user = await getUserById(db, session.userId);
    if (user?.cfo_wallet_address) args.walletAddress = user.cfo_wallet_address;
  }

  const result = await executeBNBAgentTool(tool, args);
  return NextResponse.json({ tool, result });
}

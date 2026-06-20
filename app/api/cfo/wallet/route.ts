// POST /api/cfo/wallet — create a BSC agent wallet for this user (idempotent)
// GET  /api/cfo/wallet — return wallet address + live BNB balance

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDB, getUserById } from "@/lib/db";
import { generateAgentWallet, getWalletBNBBalance } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const db   = getDB();
  const user = await getUserById(db, session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!user.cfo_wallet_address) return NextResponse.json({ wallet: null });

  const balance = user.cfo_wallet_key
    ? await getWalletBNBBalance(user.cfo_wallet_key).catch(() => 0)
    : 0;

  return NextResponse.json({
    wallet: {
      address:     user.cfo_wallet_address,
      balanceBNB:  balance,
      explorerUrl: `https://bscscan.com/address/${user.cfo_wallet_address}`,
      chain:       "BNB Smart Chain",
      funded:      balance >= 0.01,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  void req;

  const db   = getDB();
  const user = await getUserById(db, session.userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Idempotent — return existing wallet
  if (user.cfo_wallet_address) {
    const balance = user.cfo_wallet_key
      ? await getWalletBNBBalance(user.cfo_wallet_key).catch(() => 0)
      : 0;
    return NextResponse.json({
      created: false,
      address: user.cfo_wallet_address,
      balanceBNB: balance,
      message: "Agent wallet already exists.",
    });
  }

  const { address, encryptedKey } = generateAgentWallet();

  await db`
    UPDATE users
    SET cfo_wallet_address = ${address},
        cfo_wallet_key     = ${encryptedKey},
        updated_at         = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    WHERE id = ${session.userId}
  `;

  return NextResponse.json({
    created:     true,
    address,
    balanceBNB:  0,
    explorerUrl: `https://bscscan.com/address/${address}`,
    message:     "Agent wallet created. Send BNB to this address to fund live trading.",
  });
}

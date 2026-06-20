// POST /api/paper/deposit
// Called after a Mantle Sepolia MNT deposit is confirmed on-chain.
// Converts MNT → USD at live rate and credits the user's CFO balance.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDB } from "@/lib/db";
import { getMntPriceUsd, mntToUsd } from "@/lib/mantle";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await req.json() as { mntAmount: number; txHash: string };
  const { mntAmount, txHash } = body;

  if (!mntAmount || mntAmount <= 0) return NextResponse.json({ error: "Invalid amount" },  { status: 400 });
  if (!txHash?.trim())              return NextResponse.json({ error: "Missing tx hash" }, { status: 400 });

  const mntPrice = await getMntPriceUsd();
  const usdValue = mntToUsd(mntAmount, mntPrice);

  const db = getDB();

  // Ensure account exists (starting balance 0 for new users who haven't deposited)
  await db`INSERT INTO paper_accounts (user_id, balance) VALUES (${session.userId}, 0) ON CONFLICT (user_id) DO NOTHING`;

  // Credit USD equivalent to the paper balance
  await db`
    UPDATE paper_accounts
    SET balance    = balance + ${usdValue},
        updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    WHERE user_id = ${session.userId}
  `;

  // Log deposit in trades table for activity feed
  await db`
    INSERT INTO paper_trades
      (user_id, asset_id, symbol, display_symbol, name, trade_type, quantity, price, total)
    VALUES
      (${session.userId}, ${"deposit_MNT"}, ${"MNT"}, ${"MNT/USD"},
       ${"MNT Deposit"}, ${"deposit"}, ${mntAmount}, ${mntPrice}, ${usdValue})
  `;

  const rows = await db`SELECT balance FROM paper_accounts WHERE user_id = ${session.userId}`;
  const newBalanceUsd = Number(rows[0].balance);

  return NextResponse.json({
    ok:             true,
    txHash,
    mntAmount,
    mntPriceUsd:    mntPrice,
    creditedUsd:    usdValue,
    newBalanceUsd,
  });
}

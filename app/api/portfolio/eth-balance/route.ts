// GET /api/portfolio/eth-balance?address=0x...
// Fetches the ETH balance on Sepolia testnet for a given address using a public RPC.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL
  ?? "https://ethereum-sepolia-rpc.publicnode.com";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (!address || !ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid or missing address." }, { status: 400 });
  }

  try {
    const rpcRes = await fetch(SEPOLIA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });

    if (!rpcRes.ok) throw new Error(`RPC error ${rpcRes.status}`);

    const data = await rpcRes.json() as { result?: string; error?: { message: string } };
    if (data.error) throw new Error(data.error.message);

    const wei    = BigInt(data.result ?? "0x0");
    const ethBal = Number(wei) / 1e18;

    return NextResponse.json({
      address,
      balanceEth: ethBal,
      network:    "Sepolia",
      chainId:    11155111,
      explorerUrl: `https://sepolia.etherscan.io/address/${address}`,
    });
  } catch (err) {
    console.error("[eth-balance]", err);
    return NextResponse.json({ error: "Failed to fetch balance." }, { status: 500 });
  }
}

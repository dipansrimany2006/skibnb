import { NextResponse } from "next/server";
import { getMntPriceUsd } from "@/lib/mantle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const price = await getMntPriceUsd();
  return NextResponse.json({ price });
}

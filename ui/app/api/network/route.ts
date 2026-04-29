/**
 * GET /api/network
 *
 * Returns the AXL Mesh Proof Panel state: per-node AXL topology + on-chain
 * registration cross-check + derived mesh edges. Polled by /network every 5s.
 */

import { NextResponse } from "next/server";

import { gatherNetworkState } from "@/lib/network";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const view = await gatherNetworkState();
  return NextResponse.json(view, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

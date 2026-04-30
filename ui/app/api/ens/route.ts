/**
 * GET /api/ens             — return the live ENS resolution view used by the UI
 * GET /api/ens?refresh=1   — invalidate the cache first, then resolve
 *
 * Surfaces synodai.eth's parent text records + subname records exactly as the
 * UI consumes them. Use this to demo the load-bearing wiring: change a record
 * on-chain, hit ?refresh=1, watch the next /network tick reflect it.
 */

import { NextResponse } from "next/server";

import { invalidateEnsCache, resolveEnsView } from "@/lib/ens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  if (url.searchParams.get("refresh") === "1") invalidateEnsCache();
  const view = await resolveEnsView();
  return NextResponse.json(view, {
    headers: { "Cache-Control": "no-store" },
  });
}

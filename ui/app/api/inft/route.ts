/**
 * GET /api/inft
 *
 * Returns the ERC-7857 iNFT mint record for the 4 settlers on 0G Galileo.
 * Reads docs/inft-mints.json — committed at deploy time, not live-queried,
 * because the contract address is fixed and the token IDs (0-3) don't
 * change. (Re-deploy would require a new file commit.)
 *
 * Example:
 *   curl https://synod.gudman.xyz/api/inft
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function inftPath(): string {
  return (
    process.env.SYNOD_INFT_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "docs", "inft-mints.json")
  );
}

export async function GET(): Promise<NextResponse> {
  let raw: string;
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ inftPath(), "utf8");
  } catch {
    return NextResponse.json(
      { error: "iNFT mint record not yet on this server" },
      { status: 404 }
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "iNFT mint record is malformed" },
      { status: 500 }
    );
  }
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

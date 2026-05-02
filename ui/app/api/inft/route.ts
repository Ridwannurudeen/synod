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

function transferPath(): string {
  return (
    process.env.SYNOD_INFT_TRANSFER_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "docs", "inft-transfer.json")
  );
}

function safeReadJson(p: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8"));
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const mints = safeReadJson(inftPath());
  if (!mints) {
    return NextResponse.json(
      { error: "iNFT mint record not yet on this server" },
      { status: 404 }
    );
  }
  // If a transfer record exists, fold it in alongside the mints.
  const transfer = safeReadJson(transferPath());
  const out =
    transfer && typeof mints === "object" && mints !== null
      ? { ...(mints as object), transfers: [transfer] }
      : mints;
  return NextResponse.json(out, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/judgment/{questionId}
 *
 * Returns the ENS judgment subname for a settled question:
 *   { fqn, label, owner, mintTx, recordsTx, ensAppUrl, textRecords }
 * or 404 if not yet minted.
 *
 * Reads runtime/judgments.json (written by tools/mint_judgment.py).
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JudgmentEntry = {
  fqn: string;
  label: string;
  subnode: string;
  mint_tx: string;
  records_tx: string;
  owner: string;
  text_records: Record<string, string>;
  ens_app_url: string;
};

function judgmentsPath(): string {
  return (
    process.env.SYNOD_JUDGMENTS_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "runtime", "judgments.json")
  );
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ questionId: string }> }
): Promise<NextResponse> {
  const { questionId } = await ctx.params;
  const qidNorm = questionId.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(qidNorm)) {
    return NextResponse.json({ error: "invalid questionId" }, { status: 400 });
  }

  const p = judgmentsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
  } catch {
    return NextResponse.json(
      { error: "no judgments file on this server" },
      { status: 404 }
    );
  }
  let map: Record<string, JudgmentEntry>;
  try {
    map = JSON.parse(raw) as Record<string, JudgmentEntry>;
  } catch {
    return NextResponse.json(
      { error: "judgments file is malformed" },
      { status: 500 }
    );
  }

  const entry = map[qidNorm] ?? map[`0x${qidNorm}`];
  if (!entry) {
    return NextResponse.json(
      { error: "no judgment subname minted for that question yet" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      questionId: `0x${qidNorm}`,
      fqn: entry.fqn,
      label: entry.label,
      subnode: entry.subnode,
      owner: entry.owner,
      mintTx: entry.mint_tx,
      recordsTx: entry.records_tx,
      ensAppUrl: entry.ens_app_url,
      textRecords: entry.text_records,
      etherscanMintUrl: `https://etherscan.io/tx/${entry.mint_tx}`,
      etherscanRecordsUrl: `https://etherscan.io/tx/${entry.records_tx}`,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

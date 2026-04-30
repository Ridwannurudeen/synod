/**
 * GET /api/transcript/{questionId}
 *
 * Returns the 0G Storage transcript pointer for a settled question:
 * { root, indexerUrl, tx, bytes, uploadedAt } — or 404 if no transcript
 * was persisted for that question.
 *
 * Reads the local runtime/transcripts.json mapping that the settler
 * appends to after each successful settlement. The actual transcript
 * body is fetched directly from the 0G indexer URL by the client.
 */

import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TranscriptEntry = {
  root: string;
  tx: string;
  indexer_url: string;
  bytes: number;
  uploaded_at: number;
};

function transcriptsPath(): string {
  return (
    process.env.SYNOD_TRANSCRIPTS_FILE ??
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "runtime", "transcripts.json")
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

  const p = transcriptsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
  } catch {
    return NextResponse.json(
      { error: "no transcripts file on this server" },
      { status: 404 }
    );
  }
  let map: Record<string, TranscriptEntry>;
  try {
    map = JSON.parse(raw) as Record<string, TranscriptEntry>;
  } catch {
    return NextResponse.json(
      { error: "transcripts file is malformed" },
      { status: 500 }
    );
  }

  const entry = map[qidNorm] ?? map[`0x${qidNorm}`];
  if (!entry) {
    return NextResponse.json(
      { error: "no transcript stored for that question" },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      questionId: `0x${qidNorm}`,
      root: entry.root,
      tx: entry.tx,
      indexerUrl: entry.indexer_url,
      bytes: entry.bytes,
      uploadedAt: entry.uploaded_at,
      storage: "0g-storage-testnet-turbo",
      storageScanUrl: entry.tx
        ? `https://chainscan-galileo.0g.ai/tx/${entry.tx}`
        : `https://storagescan-galileo.0g.ai/`,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

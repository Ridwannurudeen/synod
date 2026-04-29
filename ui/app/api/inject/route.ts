/**
 * POST /api/inject
 *
 * Body: { prompt: string, outcomes: number[], deadlineSecs: number }
 *
 * Shells out to settler/tools/inject_question.py against the primary AXL
 * daemon. The CLI prints a `injected question <hex64>` line we parse out
 * to return the questionId for the UI to display.
 */

import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

import {
  INJECT_QUESTION_PY,
  PRIMARY_AXL_API,
  SETTLER_PYTHON,
} from "@/lib/config";
import type { ApiError, InjectQuestionResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RawBody {
  prompt?: string;
  outcomes?: number[] | string;
  deadlineSecs?: number;
  targetPubkey?: string;
}

function badRequest(message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isHex32(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

async function readPrimaryPubkey(): Promise<string> {
  const res = await fetch(`${PRIMARY_AXL_API}/topology`, {
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!res.ok) {
    throw new Error(
      `primary AXL daemon not reachable at ${PRIMARY_AXL_API}/topology`
    );
  }
  const j = (await res.json()) as { our_public_key?: string };
  if (!j.our_public_key) throw new Error("topology returned no public key");
  return j.our_public_key;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runInject(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(SETTLER_PYTHON, [INJECT_QUESTION_PY, ...args], {
      cwd: undefined,
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const token = process.env.SYNOD_UI_INJECT_TOKEN;
  if (token && req.headers.get("x-synod-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RawBody;
  try {
    body = (await req.json()) as RawBody;
  } catch {
    return badRequest("body must be JSON");
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return badRequest("prompt is required");
  if (prompt.length > 1024) return badRequest("prompt too long (>1024 chars)");

  const outcomes = Array.isArray(body.outcomes)
    ? body.outcomes.map((n) => Number(n)).filter(Number.isInteger)
    : [0, 1];
  if (outcomes.length < 2) return badRequest("at least two outcomes required");
  if (outcomes.length > 16) return badRequest("too many outcomes (>16)");
  if (new Set(outcomes).size !== outcomes.length) {
    return badRequest("outcomes must be unique integers");
  }

  const deadlineSecs = Math.max(30, Math.min(3_600, Number(body.deadlineSecs) || 180));

  let target: string;
  try {
    target = body.targetPubkey ?? (await readPrimaryPubkey());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (!isHex32(target)) return badRequest("targetPubkey must be a 32-byte hex string");

  const args = [
    "--axl",
    PRIMARY_AXL_API,
    "--target-pubkey",
    target,
    "--prompt",
    prompt,
    "--outcomes",
    outcomes.join(","),
    "--deadline-secs",
    String(deadlineSecs),
  ];

  const result = await runInject(args);
  if (result.exitCode !== 0) {
    return NextResponse.json(
      { error: `inject failed (${result.exitCode}): ${result.stderr || result.stdout}` },
      { status: 500 }
    );
  }

  const m = result.stdout.match(/injected question ([0-9a-f]{64})/);
  if (!m) {
    return NextResponse.json(
      { error: `could not parse questionId from inject output: ${result.stdout}` },
      { status: 500 }
    );
  }

  const resp: InjectQuestionResponse = {
    questionId: m[1],
    targets: [target],
  };
  return NextResponse.json(resp);
}

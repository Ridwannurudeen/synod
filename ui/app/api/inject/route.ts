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
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import {
  INJECT_QUESTION_PY,
  PRIMARY_AXL_API,
  SETTLER_PYTHON,
} from "@/lib/config";
import type { ApiError, InjectQuestionResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_384;
const MAX_OUTPUT_BYTES = 8_192;
const INJECT_TIMEOUT_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT_MAX = 5;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

interface RawBody {
  prompt?: string;
  outcomes?: number[] | string;
  deadlineSecs?: number;
  targetPubkey?: string;
}

interface InjectTarget {
  axlApi: string;
  pubkey: string;
}

function badRequest(message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isHex32(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

function publicInjectEnabled(): boolean {
  const raw = (process.env.SYNOD_UI_PUBLIC_INJECT ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function clientId(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

function checkRateLimit(id: string): boolean {
  const now = Date.now();
  const row = rateLimit.get(id);
  if (!row || row.resetAt <= now) {
    rateLimit.set(id, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (row.count >= RATE_LIMIT_MAX) return false;
  row.count++;
  return true;
}

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  return (current + chunk.toString("utf8")).slice(0, MAX_OUTPUT_BYTES);
}

function redact(text: string): string {
  return text
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_PROJECT_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_OPENAI_KEY]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, "0xREDACTED_PRIVATE_KEY")
    .replace(/\b[a-fA-F0-9]{64}\b/g, "REDACTED_64_HEX");
}

function configuredInjectTargets(): InjectTarget[] {
  const raw = process.env.SYNOD_UI_INJECT_TARGETS?.trim();
  if (!raw) return [];

  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [axlApi, pubkey] = entry.split("|").map((part) => part.trim());
      if (!axlApi || !pubkey) {
        throw new Error(
          "SYNOD_UI_INJECT_TARGETS entries must be '<axlApi>|<pubkey>'"
        );
      }
      if (!isHex32(pubkey)) {
        throw new Error("SYNOD_UI_INJECT_TARGETS contains an invalid pubkey");
      }
      return { axlApi: axlApi.replace(/\/+$/, ""), pubkey };
    });
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

async function resolveTargets(body: RawBody): Promise<InjectTarget[]> {
  if (body.targetPubkey) {
    return [{ axlApi: PRIMARY_AXL_API, pubkey: body.targetPubkey }];
  }

  const configured = configuredInjectTargets();
  if (configured.length > 0) return configured;

  return [{ axlApi: PRIMARY_AXL_API, pubkey: await readPrimaryPubkey() }];
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
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, INJECT_TIMEOUT_MS);
    proc.stdout.on("data", (d: Buffer) => (stdout = appendBounded(stdout, d)));
    proc.stderr.on("data", (d: Buffer) => (stderr = appendBounded(stderr, d)));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const token = process.env.SYNOD_UI_INJECT_TOKEN;
  if (token) {
    if (req.headers.get("x-synod-token") !== token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production" && !publicInjectEnabled()) {
    return NextResponse.json(
      { error: "question injection is disabled on this deployment" },
      { status: 503 }
    );
  }

  if (!checkRateLimit(clientId(req))) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return badRequest("body must be readable");
  }
  if (bodyText.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }

  let body: RawBody;
  try {
    body = JSON.parse(bodyText) as RawBody;
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

  let targets: InjectTarget[];
  try {
    targets = await resolveTargets(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  for (const target of targets) {
    if (!isHex32(target.pubkey)) {
      return badRequest("targetPubkey must be a 32-byte hex string");
    }
  }

  const questionId = randomBytes(32).toString("hex");
  const deadlineUnix = Math.floor(Date.now() / 1000) + deadlineSecs;

  for (const target of targets) {
    const args = [
      "--axl",
      target.axlApi,
      "--target-pubkey",
      target.pubkey,
      "--prompt",
      prompt,
      "--outcomes",
      outcomes.join(","),
      "--deadline-secs",
      String(deadlineSecs),
      "--deadline-unix",
      String(deadlineUnix),
      "--question-id",
      questionId,
    ];

    const result = await runInject(args);
    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `inject failed (${result.exitCode}): ${redact(result.stderr || result.stdout)}` },
        { status: 500 }
      );
    }

    const m = result.stdout.match(/injected question ([0-9a-f]{64})/);
    if (!m || m[1] !== questionId) {
      return NextResponse.json(
        { error: `could not parse questionId from inject output: ${redact(result.stdout)}` },
        { status: 500 }
      );
    }
  }

  const resp: InjectQuestionResponse = {
    questionId,
    targets: targets.map((target) => target.pubkey),
  };
  return NextResponse.json(resp);
}

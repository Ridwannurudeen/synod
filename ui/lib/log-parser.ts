/**
 * Parse Synod settler agent log files into structured per-question state.
 *
 * The agent emits stable INFO-level lines we can pattern-match without a
 * structured-logging dep. This keeps the demo dependency-free and lets
 * the UI work even if a settler crashes mid-run (we just stop seeing
 * updates from that node).
 *
 * Lines this parser recognises (sample shapes):
 *   "settler running pubkey=6c08c7ab... peers=1 quorum=2"
 *   "question 5f82a2da... outcomes=0,1 prompt=Was the ..."
 *   "inference q=5f82a2da... outcome=1 confidence=0.970 model=claude-sonnet-4-6"
 *   "broadcast vote to 4a02e4f0..."
 *   "accepted vote q=5f82a2da... settler=4a02e4f0... outcome=1 (2/2)"
 *   "CONSENSUS q=5f82a2da... outcome=1 quorum=2 weighted_score=1.940"
 *   "ONCHAIN q=5f82a2da... tx=df668fcb... outcome=1 quorum=2"
 *   "not the designated poster for q=5f82a2da..."
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { ConsensusView, SettlerStatus, SettlerView } from "./types";

const TS_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

function parseTimestampMs(line: string): number {
  const m = TS_REGEX.exec(line);
  if (!m) return Date.now();
  return new Date(m[1].replace(" ", "T") + "Z").getTime();
}

interface LogEvents {
  pubkey?: string;
  modelTag?: string;
  status: SettlerStatus;
  questionId?: string;
  prompt?: string;
  outcomes?: number[];
  votedOutcome?: number;
  votedConfidence?: number;
  reasoning?: string;
  consensusOutcome?: number;
  consensusQuorum?: number;
  consensusWeightedScore?: number;
  consensusReachedAtMs?: number;
  onchainTxHash?: string;
  lastUpdateMs: number;
}

function parseSingleLog(text: string): LogEvents {
  const lines = text.split(/\r?\n/);
  const ev: LogEvents = { status: "idle", lastUpdateMs: 0 };

  for (const line of lines) {
    if (!line) continue;

    const ts = parseTimestampMs(line);

    let m: RegExpMatchArray | null;

    m = line.match(/settler running pubkey=([0-9a-f]+)/);
    if (m) {
      ev.pubkey = m[1];
      ev.lastUpdateMs = Math.max(ev.lastUpdateMs, ts);
      continue;
    }

    m = line.match(/question ([0-9a-f]+) outcomes=([0-9,\-]+) prompt=(.+)$/);
    if (m) {
      // New question — clear stale per-question state from the prior cycle.
      // Without this, an old CONSENSUS line continues to populate
      // consensusOutcome/Quorum/WeightedScore on the ev object after a new
      // question arrives, and the API surfaces (newQid, oldConsensus) — a
      // false "quorum reached" for a question that's just been received.
      if (ev.questionId !== m[1]) {
        ev.consensusOutcome = undefined;
        ev.consensusQuorum = undefined;
        ev.consensusWeightedScore = undefined;
        ev.consensusReachedAtMs = undefined;
        ev.votedOutcome = undefined;
        ev.votedConfidence = undefined;
        ev.onchainTxHash = undefined;
        ev.outcomes = undefined;
        ev.prompt = undefined;
      }
      ev.status = "received";
      ev.questionId = m[1];
      ev.outcomes = m[2]
        .split(",")
        .map((x) => Number(x))
        .filter(Number.isFinite);
      ev.prompt = m[3];
      ev.lastUpdateMs = ts;
      continue;
    }

    m = line.match(/question ([0-9a-f]+) prompt=(.+)$/);
    if (m) {
      if (ev.questionId !== m[1]) {
        ev.consensusOutcome = undefined;
        ev.consensusQuorum = undefined;
        ev.consensusWeightedScore = undefined;
        ev.consensusReachedAtMs = undefined;
        ev.votedOutcome = undefined;
        ev.votedConfidence = undefined;
        ev.onchainTxHash = undefined;
        ev.outcomes = undefined;
      }
      ev.status = "received";
      ev.questionId = m[1];
      ev.prompt = m[2];
      ev.lastUpdateMs = ts;
      continue;
    }

    m = line.match(
      /inference q=([0-9a-f]+) outcome=(-?\d+) confidence=([\d.]+) model=(\S+)/
    );
    if (m) {
      if (ev.questionId !== m[1]) {
        // Inference line for a question we haven't seen the "question …
        // prompt=" line for yet. Still treat as a question boundary so
        // stale consensus from prior cycles doesn't leak.
        ev.consensusOutcome = undefined;
        ev.consensusQuorum = undefined;
        ev.consensusWeightedScore = undefined;
        ev.consensusReachedAtMs = undefined;
        ev.onchainTxHash = undefined;
      }
      ev.status = "voted";
      ev.questionId = m[1];
      ev.votedOutcome = Number(m[2]);
      ev.votedConfidence = Number(m[3]);
      ev.modelTag = m[4];
      ev.lastUpdateMs = ts;
      continue;
    }

    m = line.match(
      /CONSENSUS q=([0-9a-f]+) outcome=(-?\d+) quorum=(\d+) weighted_score=([\d.]+)/
    );
    if (m) {
      ev.status = "consensus";
      ev.questionId = m[1];
      ev.consensusOutcome = Number(m[2]);
      ev.consensusQuorum = Number(m[3]);
      ev.consensusWeightedScore = Number(m[4]);
      ev.consensusReachedAtMs = ts;
      ev.lastUpdateMs = ts;
      continue;
    }

    m = line.match(/ONCHAIN q=([0-9a-f]+) tx=([0-9a-f]+) outcome=(-?\d+)/);
    if (m) {
      ev.status = "posted";
      // ONCHAIN log lines intentionally use a shortened question id for display.
      // Keep the full id parsed from the question/consensus lines so registry
      // proof lookup still uses the canonical bytes32.
      if (!ev.questionId) ev.questionId = m[1];
      ev.onchainTxHash = m[2];
      ev.consensusOutcome = Number(m[3]);
      ev.lastUpdateMs = ts;
      continue;
    }
  }

  return ev;
}

export interface ParsedLogs {
  settlers: SettlerView[];
  consensus: ConsensusView | null;
  onchainTxHash?: string;
  /** Cross-settler accepted-vote map keyed by 16-char pubkey prefix.
   *  Lets callers overlay votes onto settlers whose own log files
   *  weren't parsed (e.g. settlers running on a different VPS). */
  acceptedVotesByPubkeyPrefix?: Record<string, { outcome: number; questionId: string }>;
}

/**
 * Read the configured set of agent log files, parse them into SettlerView
 * records, and aggregate a single consensus view if any settler has reached
 * one for the latest question.
 */
export async function parseSettlerLogs(
  logPaths: { name: string; path: string }[]
): Promise<ParsedLogs> {
  const settlers: SettlerView[] = [];
  let consensus: ConsensusView | null = null;
  let onchainTxHash: string | undefined;

  // Bound how much of each log file we parse on every poll. Settler logs are
  // dominated by ~4 lines/sec of httpx INFO `GET /recv 204 No Content`
  // polling output. At ~150 bytes/line, 1MB ≈ ~30 minutes of activity —
  // covers any single demo session. Three concurrent /api/state callers
  // means ~12 MB/s of regex work, which is comfortable on a contended
  // VPS where neighbour processes can saturate the load average.
  const TAIL_BYTES = 1 * 1024 * 1024;

  // Plus a small head read for the startup pubkey line. The agent logs
  // `settler running pubkey=...` once at startup; that's the only place
  // the settler's own pubkey appears in its own log. After ~30 minutes
  // of polling traffic (~36KB/min) that line rolls out of any
  // reasonable tail window, and without it the parser drops the settler
  // entirely. 16KB of head reliably captures the startup banner.
  const HEAD_BYTES = 16 * 1024;

  // Filename -> pubkey fallback. Long-running logs grow past the head/tail
  // window, rolling the "settler running pubkey=…" line out of view; without
  // a fallback the parser drops the settler entirely. Map by log basename so
  // we never lose a settler card even on a many-hour-old log file.
  const PUBKEY_BY_LOG_NAME: Record<string, string> = {
    "synod-settler-a.log":
      "752b498760a859332985f4d1edf6a630cd97615c0f1085c63e514736326c1cea",
    "synod-settler-b.log":
      "b52678486f667f176885421b48b06ff3569468e242839f32f6db9ebd1083fbc8",
    "synod-settler-c.log":
      "dbc4cebd7a1bb7a4f9d06dd1ae9376807d4bc0d314b89839aef75e1988ed3648",
    "settler-a.log":
      "752b498760a859332985f4d1edf6a630cd97615c0f1085c63e514736326c1cea",
    "settler-b.log":
      "b52678486f667f176885421b48b06ff3569468e242839f32f6db9ebd1083fbc8",
    "settler-c.log":
      "dbc4cebd7a1bb7a4f9d06dd1ae9376807d4bc0d314b89839aef75e1988ed3648",
  };

  // Cross-settler vote map. Collect EVERY accepted-vote line across ALL
  // log files with its timestamp; pick the qid with the newest timestamp
  // at the end and emit only that qid's votes. Order of file iteration
  // does not affect correctness (earlier code's `clear()` on qid change
  // was order-fragile — log B revisiting an older qid would wipe log A's
  // newest-qid entries).
  type RawVote = {
    qid: string;
    settlerPfx: string;
    outcome: number;
    ts: number;
  };
  const allRawVotes: RawVote[] = [];
  const VOTE_RE = /accepted vote q=([0-9a-f]+) settler=([0-9a-f]+) outcome=(-?\d+)/;

  for (const { path: p, name } of logPaths) {
    let text: string;
    try {
      const resolved = path.resolve(/*turbopackIgnore: true*/ p);
      const stat = await fs.stat(resolved);
      if (stat.size <= TAIL_BYTES + HEAD_BYTES) {
        text = await fs.readFile(resolved, "utf8");
      } else {
        const fh = await fs.open(resolved, "r");
        try {
          const headBuf = Buffer.alloc(HEAD_BYTES);
          await fh.read(headBuf, 0, HEAD_BYTES, 0);
          const tailBuf = Buffer.alloc(TAIL_BYTES);
          await fh.read(tailBuf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
          // Concatenate head + tail with a synthetic gap. Drop the
          // (likely partial) first line of the tail to keep the parser
          // deterministic.
          let tail = tailBuf.toString("utf8");
          const firstNewline = tail.indexOf("\n");
          if (firstNewline >= 0) tail = tail.slice(firstNewline + 1);
          text = headBuf.toString("utf8") + "\n" + tail;
        } finally {
          await fh.close();
        }
      }
    } catch {
      continue;
    }
    // Scan for "accepted vote q=… settler=PFX outcome=N" — gives us votes
    // for settlers whose own logs aren't local. Collect with timestamps
    // for global "newest qid wins" resolution after all files processed.
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(VOTE_RE);
      if (!m) continue;
      allRawVotes.push({
        qid: m[1],
        settlerPfx: m[2],
        outcome: Number(m[3]),
        ts: parseTimestampMs(line),
      });
    }

    const ev = parseSingleLog(text);
    if (!ev.pubkey) {
      ev.pubkey = PUBKEY_BY_LOG_NAME[name];
    }
    if (!ev.pubkey) continue;

    settlers.push({
      pubkey: ev.pubkey,
      modelTag: ev.modelTag,
      online: true,
      status: ev.status,
      votedOutcome: ev.votedOutcome,
      votedConfidence: ev.votedConfidence,
      reasoning: ev.reasoning,
      lastUpdateMs: ev.lastUpdateMs,
    });

    if (ev.questionId) {
      const hasConsensus =
        ev.consensusOutcome !== undefined &&
        ev.consensusQuorum !== undefined &&
        ev.consensusWeightedScore !== undefined;

      // Keep a question-only placeholder before consensus exists, but do not
      // let later "voted" updates erase a valid consensus from another settler.
      if (hasConsensus) {
        const stale =
          consensus !== null && ev.lastUpdateMs <= (consensus.reachedAt ?? 0);
        if (!stale) {
          consensus = {
            questionId: ev.questionId,
            prompt: ev.prompt ?? "",
            outcomes: ev.outcomes ?? [0, 1],
            reachedAt: ev.consensusReachedAtMs,
            outcome: ev.consensusOutcome,
            weightedScore: ev.consensusWeightedScore,
            quorumSize: ev.consensusQuorum,
          };
        }
      } else if (consensus === null) {
        consensus = {
          questionId: ev.questionId,
          prompt: ev.prompt ?? "",
          outcomes: ev.outcomes ?? [0, 1],
        };
      }
    }

    if (ev.onchainTxHash) {
      onchainTxHash = ev.onchainTxHash;
    }
  }

  // Find the newest-timestamp qid across all collected votes — that's the
  // "current" question regardless of file iteration order.
  let newestQid: string | undefined;
  let newestTs = 0;
  const qidNewestTs = new Map<string, number>();
  for (const v of allRawVotes) {
    const prev = qidNewestTs.get(v.qid) ?? 0;
    if (v.ts > prev) qidNewestTs.set(v.qid, v.ts);
  }
  for (const [qid, ts] of qidNewestTs.entries()) {
    if (ts > newestTs) {
      newestTs = ts;
      newestQid = qid;
    }
  }
  // Build the final map for ONLY the newest qid.
  const acceptedVotesByPubkeyPrefix: Record<string, { outcome: number; questionId: string }> = {};
  if (newestQid) {
    for (const v of allRawVotes) {
      if (v.qid !== newestQid) continue;
      acceptedVotesByPubkeyPrefix[v.settlerPfx] = {
        outcome: v.outcome,
        questionId: v.qid,
      };
    }
  }

  // Overlay onto local-log settlers whose own inference line wasn't picked up.
  for (const s of settlers) {
    if (s.votedOutcome !== undefined) continue;
    const pfx = s.pubkey.slice(0, 16);
    const v = acceptedVotesByPubkeyPrefix[pfx];
    if (v) {
      s.votedOutcome = v.outcome;
      s.status = "voted";
    }
  }

  return { settlers, consensus, onchainTxHash, acceptedVotesByPubkeyPrefix };
}

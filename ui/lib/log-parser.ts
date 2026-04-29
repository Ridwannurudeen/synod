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
 *   "question 5f82a2da... prompt=Was the ..."
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

    m = line.match(/question ([0-9a-f]+) prompt=(.+)$/);
    if (m) {
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
      ev.questionId = m[1];
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

  for (const { path: p } of logPaths) {
    let text: string;
    try {
      text = await fs.readFile(path.resolve(p), "utf8");
    } catch {
      continue;
    }
    const ev = parseSingleLog(text);
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
      // All settlers log the same question/consensus; just take the freshest.
      const stale = consensus !== null && ev.lastUpdateMs <= (consensus.reachedAt ?? 0);
      if (!stale) {
        consensus = {
          questionId: ev.questionId,
          prompt: ev.prompt ?? "",
          outcomes: [0, 1],
          reachedAt: ev.consensusReachedAtMs,
          outcome: ev.consensusOutcome,
          weightedScore: ev.consensusWeightedScore,
          quorumSize: ev.consensusQuorum,
        };
      }
    }

    if (ev.onchainTxHash) {
      onchainTxHash = ev.onchainTxHash;
    }
  }

  return { settlers, consensus, onchainTxHash };
}

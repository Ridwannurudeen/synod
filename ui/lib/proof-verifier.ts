import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { Hex, PublicClient } from "viem";

import { SYNOD_REGISTRY_ABI } from "./registry-abi";
import type { OnchainSettlement } from "./registry";
import type { ProofVerificationView, ProofVoteView } from "./types";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PROTOCOL_VERSION = 1;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

function sha256HexText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256HexCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function fromHex(hex: string): Buffer {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(stripped, "hex");
}

function bytes32Hex(hex: string): Hex {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `0x${stripped}` as Hex;
}

function isHex32(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function isSignatureHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{128}$/.test(value);
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function verifyEd25519(pubkeyHex: string, payload: Buffer, signatureHex: string): boolean {
  try {
    const pubkey = fromHex(pubkeyHex);
    if (pubkey.length !== 32) return false;
    const signature = fromHex(signatureHex);
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pubkey]),
      format: "der",
      type: "spki",
    });
    return verifySignature(null, payload, key, signature);
  } catch {
    return false;
  }
}

interface ProofQuestion {
  kind: number;
  question_id: string;
  prompt: string;
  outcomes: number[];
  deadline: number;
}

interface ProofVote {
  kind: number;
  protocol_version: number;
  question_id: string;
  prompt_hash: string;
  outcomes_hash: string;
  deadline: number;
  settler_pubkey: string;
  model_tag: string;
  outcome: number;
  confidence: number;
  timestamp: number;
  signature: string;
}

interface ProofPayload {
  protocol_version?: number;
  question?: ProofQuestion;
  votes?: ProofVote[];
}

function signingPayload(vote: ProofVote): Buffer {
  return Buffer.from(
    canonicalJson({
      kind: vote.kind,
      protocol_version: vote.protocol_version,
      question_id: vote.question_id,
      prompt_hash: vote.prompt_hash,
      outcomes_hash: vote.outcomes_hash,
      deadline: vote.deadline,
      settler_pubkey: vote.settler_pubkey.toLowerCase(),
      model_tag: vote.model_tag,
      outcome: vote.outcome,
      confidence: round4(Number(vote.confidence)),
      timestamp: vote.timestamp,
    }),
    "utf8"
  );
}

export async function verifySettlementProof(
  client: PublicClient,
  registryAddress: Hex,
  settlement: OnchainSettlement
): Promise<ProofVerificationView> {
  const errors: string[] = [];
  const votesView: ProofVoteView[] = [];

  let parsed: ProofPayload;
  try {
    const text = fromHex(settlement.signedVotesPayload).toString("utf8");
    parsed = JSON.parse(text) as ProofPayload;
  } catch {
    return { status: "invalid", errors: ["signedVotesPayload is not valid JSON"], votes: [] };
  }

  if (parsed.protocol_version !== PROTOCOL_VERSION) {
    errors.push(`unsupported protocol_version ${String(parsed.protocol_version)}`);
  }
  if (!parsed.question) errors.push("proof payload is missing question");
  if (!Array.isArray(parsed.votes) || parsed.votes.length === 0) {
    errors.push("proof payload has no votes");
  }

  const question = parsed.question;
  const votes = Array.isArray(parsed.votes) ? parsed.votes : [];
  const settlementQuestionId = settlement.questionId.replace(/^0x/, "").toLowerCase();

  let promptHash = "";
  let outcomesHash = "";
  if (question) {
    if (question.question_id.toLowerCase() !== settlementQuestionId) {
      errors.push("question_id does not match on-chain settlement");
    }
    promptHash = sha256HexText(question.prompt);
    outcomesHash = sha256HexCanonical(question.outcomes);
  }

  const seen = new Set<string>();
  const outcomeCounts = new Map<number, number>();
  const outcomeWeights = new Map<number, number>();

  for (const vote of votes) {
    const pubkey = typeof vote.settler_pubkey === "string" ? vote.settler_pubkey.toLowerCase() : "";
    const row: ProofVoteView = {
      pubkey,
      modelTag: vote.model_tag,
      outcome: Number(vote.outcome),
      confidence: Number(vote.confidence),
      registered: false,
      signatureValid: false,
    };

    if (!isHex32(pubkey)) {
      errors.push("vote has invalid settler_pubkey");
      votesView.push(row);
      continue;
    }
    if (seen.has(pubkey)) {
      errors.push(`duplicate vote from ${pubkey.slice(0, 16)}`);
      votesView.push(row);
      continue;
    }
    seen.add(pubkey);

    try {
      row.registered = Boolean(
        await client.readContract({
          address: registryAddress,
          abi: SYNOD_REGISTRY_ABI,
          functionName: "registeredAxlPubKeys",
          args: [bytes32Hex(pubkey)],
        })
      );
    } catch {
      errors.push(`could not check registry membership for ${pubkey.slice(0, 16)}`);
    }
    if (!row.registered) errors.push(`unregistered AXL pubkey ${pubkey.slice(0, 16)}`);

    if (!isSignatureHex(vote.signature)) {
      errors.push(`invalid signature encoding for ${pubkey.slice(0, 16)}`);
    } else {
      row.signatureValid = verifyEd25519(pubkey, signingPayload(vote), vote.signature);
      if (!row.signatureValid) errors.push(`bad signature for ${pubkey.slice(0, 16)}`);
    }

    if (vote.protocol_version !== PROTOCOL_VERSION) errors.push(`bad vote protocol for ${pubkey.slice(0, 16)}`);
    if (vote.question_id?.toLowerCase() !== settlementQuestionId) errors.push(`vote question mismatch for ${pubkey.slice(0, 16)}`);
    if (question && vote.deadline !== question.deadline) errors.push(`vote deadline mismatch for ${pubkey.slice(0, 16)}`);
    if (question && vote.prompt_hash !== promptHash) errors.push(`vote prompt hash mismatch for ${pubkey.slice(0, 16)}`);
    if (question && vote.outcomes_hash !== outcomesHash) errors.push(`vote outcomes hash mismatch for ${pubkey.slice(0, 16)}`);
    if (question && !question.outcomes.includes(Number(vote.outcome))) errors.push(`vote outcome invalid for ${pubkey.slice(0, 16)}`);
    if (!Number.isFinite(Number(vote.confidence)) || Number(vote.confidence) < 0 || Number(vote.confidence) > 1) {
      errors.push(`vote confidence invalid for ${pubkey.slice(0, 16)}`);
    }

    votesView.push(row);
    if (row.registered && row.signatureValid) {
      const outcome = Number(vote.outcome);
      const confidence = round4(Number(vote.confidence));
      outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
      outcomeWeights.set(outcome, (outcomeWeights.get(outcome) ?? 0) + confidence);
    }
  }

  const expectedOutcome = Number(settlement.outcome);
  const winnerVotes = outcomeCounts.get(expectedOutcome) ?? 0;
  const weightedScoreScaled = Math.round((outcomeWeights.get(expectedOutcome) ?? 0) * 1_000_000);
  if (winnerVotes < Number(settlement.quorumSize)) {
    errors.push("winning outcome does not meet on-chain quorumSize");
  }
  if (weightedScoreScaled !== Number(settlement.weightedScoreScaled)) {
    errors.push("weighted score does not match signed votes");
  }

  return {
    status: errors.length === 0 ? "verified" : "invalid",
    errors,
    questionId: settlementQuestionId,
    quorumSize: Number(settlement.quorumSize),
    winnerVotes,
    weightedScoreScaled,
    votes: votesView,
  };
}

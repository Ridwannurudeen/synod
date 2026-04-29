/**
 * Shared types used across the Synod live deliberation viewer.
 *
 * The UI is read-only over a few sources:
 *   - settler/agent log files     -> per-settler runtime status
 *   - SynodRegistry contract       -> registered settlers + on-chain settlements
 *   - inject_question.py CLI       -> initiates a deliberation when the user
 *                                     submits a question via the form
 *
 * All identifiers below match the on-the-wire / on-chain shapes 1:1 so log
 * parsing and contract reads stay trivial.
 */

export type SettlerStatus =
  | "idle"
  | "received"
  | "inferring"
  | "voted"
  | "consensus"
  | "posted";

export interface SettlerView {
  /** AXL ed25519 public key, 64-char hex (no 0x prefix). */
  pubkey: string;
  /** EVM address registered in SynodRegistry, 0x-prefixed checksum hex. */
  evmAddress?: string;
  /** Free-form model identifier, e.g. "claude-sonnet-4-6". */
  modelTag?: string;
  /** Whether the settler is reachable (its AXL daemon answered /topology). */
  online: boolean;
  /** Lifecycle of the most recent question this settler has touched. */
  status: SettlerStatus;
  /** Best-known outcome the settler voted for (only after status >= voted). */
  votedOutcome?: number;
  /** Settler's confidence in its own answer (0..1). */
  votedConfidence?: number;
  /** Human-readable reasoning the model provided for its vote. */
  reasoning?: string;
  /** Timestamp of last status change (ms epoch). */
  lastUpdateMs: number;
}

export interface ConsensusView {
  questionId: string;
  prompt: string;
  outcomes: number[];
  /** Reached locally (off-chain) once a quorum of signed votes is gathered. */
  reachedAt?: number;
  /** Off-chain consensus winning outcome. */
  outcome?: number;
  /** Off-chain confidence-weighted score for the winning outcome. */
  weightedScore?: number;
  /** Distinct settlers participating in the off-chain quorum. */
  quorumSize?: number;
}

export interface OnchainView {
  /** Address of the deployed SynodRegistry contract. */
  registryAddress?: string;
  /** Current chain ID — used for explorer URL templating. */
  chainId?: number;
  /** Tx hash that posted this question's settlement on-chain (if any). */
  postedTxHash?: string;
  /** Address that posted on-chain (one of the registered settlers). */
  postedBy?: string;
  /** Block timestamp of the on-chain record. */
  postedAt?: number;
  /** Stored outcome on-chain — should match the off-chain consensus outcome. */
  outcome?: number;
  /** Stored confidence-weighted score scaled by 1e6 on-chain. */
  weightedScoreScaled?: number;
  /** Server-side verification of the signed-vote proof stored on-chain. */
  proof?: ProofVerificationView;
}

export interface ProofVoteView {
  pubkey: string;
  modelTag?: string;
  outcome?: number;
  confidence?: number;
  registered: boolean;
  signatureValid: boolean;
}

export interface ProofVerificationView {
  status: "verified" | "invalid" | "unavailable";
  errors: string[];
  questionId?: string;
  quorumSize?: number;
  winnerVotes?: number;
  weightedScoreScaled?: number;
  votes: ProofVoteView[];
}

export interface DeliberationState {
  /** Question currently being deliberated; null when idle. */
  consensus: ConsensusView | null;
  /** Per-settler view, keyed by AXL pubkey. */
  settlers: SettlerView[];
  /** On-chain projection of the current question. */
  onchain: OnchainView;
  /** Server-side wall clock when this snapshot was assembled. */
  serverTimeMs: number;
}

export interface InjectQuestionRequest {
  prompt: string;
  outcomes: number[];
  deadlineSecs: number;
}

export interface InjectQuestionResponse {
  questionId: string;
  targets: string[];
}

export interface ApiError {
  error: string;
}

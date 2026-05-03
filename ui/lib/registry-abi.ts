/**
 * SynodRegistry ABI subset the UI needs.
 *
 * Read paths cover settlement state + security config so the viewer can
 * render the on-chain Settlement and decide whether the "Challenge this
 * settlement" CTA is live.
 *
 * One write — challengeSettlement — is exposed so connected wallets can
 * post optimistic-finality challenges directly. All other writes (record,
 * resolve, configureSecurity, deposit/withdraw bond) are settler/admin-only
 * and live in the Python tools, not the browser.
 *
 * The full ABI is at contracts/out/SynodRegistry.sol/SynodRegistry.json after
 * `forge build`.
 */

export const SYNOD_REGISTRY_ABI = [
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "registeredSettlerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "settlers",
    stateMutability: "view",
    inputs: [{ name: "settler", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "axlPubKey", type: "bytes32" },
      { name: "modelTag", type: "string" },
      { name: "bond", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "registeredAxlPubKeys",
    stateMutability: "view",
    inputs: [{ name: "axlPubKey", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isSettled",
    stateMutability: "view",
    inputs: [{ name: "questionId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isFinalized",
    stateMutability: "view",
    inputs: [{ name: "questionId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getSettlement",
    stateMutability: "view",
    inputs: [{ name: "questionId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "questionId", type: "bytes32" },
          { name: "outcome", type: "uint8" },
          { name: "quorumSize", type: "uint256" },
          { name: "weightedScoreScaled", type: "uint256" },
          { name: "signedVotesPayload", type: "bytes" },
          { name: "postedBy", type: "address" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "challengeWindowSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "minChallengeBond",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "minSettlerBond",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSlashedBond",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "challengeSettlement",
    stateMutability: "payable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "SettlementRecorded",
    inputs: [
      { name: "questionId", type: "bytes32", indexed: true },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "quorumSize", type: "uint256", indexed: false },
      { name: "weightedScoreScaled", type: "uint256", indexed: false },
      { name: "postedBy", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SettlementChallenged",
    inputs: [
      { name: "questionId", type: "bytes32", indexed: true },
      { name: "challenger", type: "address", indexed: true },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "challengeBond", type: "uint256", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ChallengeResolved",
    inputs: [
      { name: "questionId", type: "bytes32", indexed: true },
      { name: "sustained", type: "bool", indexed: false },
      { name: "recipient", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
    ],
  },
] as const;

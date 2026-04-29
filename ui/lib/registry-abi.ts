/**
 * Minimal SynodRegistry ABI subset the UI uses for read-only access.
 *
 * The full ABI (including write functions and errors) lives in
 * contracts/out/SynodRegistry.sol/SynodRegistry.json after `forge build`.
 * We only need read paths in the viewer because the settler agents own all
 * write transactions.
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
] as const;

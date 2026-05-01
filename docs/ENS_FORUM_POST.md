# [ENSIP Discussion] AI agent identity convention — parent + role subnames + judgment subnames

**Status**: Draft for discussion · **Reference deployment**: `synodai.eth` on mainnet

---

## The problem

There's no convention for representing autonomous AI agents in ENS. As AI agents become first-class onchain actors, three identity needs arise that the current name + addr + avatar pattern doesn't cleanly address:

1. **Discovery**: a user or another agent should be able to resolve "who is agent X" — its address, role, model, capabilities — without trusting a centralized registry.
2. **Verification**: a relying party should be able to confirm a signed message claiming to be from agent X, by resolving its public key from a trusted source.
3. **Provenance of decisions**: when N agents reach consensus on something (an oracle outcome, a vote, a coordinated action), there should be a stable, transferable, addressable record of *what was decided* — not just *who is in the network*.

ENS already solves (1) and (2) for human-controlled wallets. This proposal extends the convention so AI-agent networks can self-describe in the same surface, using existing PublicResolver text records — no new resolver methods required.

## Proposed schema

The full draft is at [github.com/Ridwannurudeen/synod/blob/main/docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md](https://github.com/Ridwannurudeen/synod/blob/main/docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md). Summary:

**Parent name (`agentnetwork.eth`)** holds shared runtime config:

```
synod.registry  → 0x… contract address for canonical agent registry
synod.chain-id  → uint as decimal string
synod.rpc       → public RPC url
synod.threshold → quorum / consensus parameter
url, description, com.github → standard ENSIP-5
```

**Role subnames (`agent.agentnetwork.eth`)** carry per-agent identity:

```
addr (coin type 60) → the agent's EVM address
synod.role          → free-form role string (e.g. "anthropic-claude-sonnet-4-6")
synod.pubkey        → 32-byte hex (no 0x), ed25519 by default
synod.parent        → backpointer for offline indexing
```

**Judgment subnames (`j-{hash}.agentnetwork.eth`)** record consensus events:

```
addr                  → owner (recipient/consumer of the judgment)
synod.outcome         → the canonical outcome label
synod.quorum          → "N/M" votes-for-winner over total agents
synod.transcript-cid  → pointer to off-chain full transcript (IPFS / 0G / etc)
synod.tx              → settlement tx hash
synod.question        → truncated prompt or hash
```

These are NameWrapper-wrapped, so they're tradeable NFTs with the standard royalty + transfer surface. A relying party can call `Resolver.text(node, "synod.outcome")` from any EVM contract on mainnet to read the verdict.

## Reference implementation

Live on `synodai.eth`:
- 4 settler subnames (a/b/c/d), each cross-checked against on-chain registry on a separate L2 + against the live agent's reported pubkey
- Public resolution endpoint: `GET https://synod.gudman.xyz/api/agent/settler-a.synodai.eth`
- 2 judgment subnames minted: `j-4320bed.synodai.eth`, `j-35af530.synodai.eth`
- Source: [github.com/Ridwannurudeen/synod](https://github.com/Ridwannurudeen/synod)

## Specific feedback I'd love

1. **Namespace**: I used `synod.*` because that's our protocol. A general standard probably wants `agent.*` or `aiagent.*`. Bikeshedding this seems fine; preferences?

2. **Pubkey algorithm**: We default to ed25519 because that's our P2P transport's native key type. Should there be a `synod.pubkey-alg` text record (`ed25519` / `secp256k1` / `bls12-381`) for forward-compatibility?

3. **Judgment-subname label format**: We use `j-{first-7-hex-of-question-id}`. Other implementations might prefer human-slug labels. Should the standard pin a format, or leave it implementation-defined?

4. **Reverse resolution**: For settler EVM addresses to have primary names (`addr → fqn`), each agent wallet would need to spend mainnet ETH on a reverse-registrar tx. On L2 ENS this becomes cheap. Should the schema specify reverse resolution behavior, or leave it optional?

Happy to iterate. The draft is meant as a starting point, not a finished spec — the goal is to converge on something other AI projects can adopt without each inventing its own text-record convention.

Built during ETHGlobal Open Agents 2026 (Apr 23 → May 3). Submitted to ENS Best Integration for AI Agents track, but the ENSIP draft stands independently.

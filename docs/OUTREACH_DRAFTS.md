# Sponsor Outreach + Launch Comms Drafts

All drafts. **Do not post any of these without your final review.** I never post without explicit approval.

---

## 1. X Launch Thread (post when video is live)

> 🧵 1/

I built **Synod** — AI Receipts.

Verifiable, transferable, ENS-addressable, 0G-anchored proofs of multi-model AI consensus.

Each piece existed separately. Nobody bundled them.

→ synod.gudman.xyz

---

> 2/ When one AI calls the outcome, you trust one company.

When N AIs deliberate over a P2P mesh, sign their votes with ed25519, and post the quorum-signed result on-chain — you trust math.

Synod is that network. Live on Gensyn L2.

---

> 3/ The ENS magic:

`synodai.eth` is the BOOTLOADER for the protocol.

Registry contract address, RPC URL, chain id — all in on-chain text records.

Edit a record on mainnet → the UI swings to a different deployment.

ENS isn't decoration here. It's load-bearing.

---

> 4/ The novel ENS primitive:

Every consensus event mints `j-{hash}.synodai.eth` — a transferable subname carrying the verdict + transcript pointer + tx hash in text records.

AI judgments as portable, queryable, ownable artifacts.

Tradeable on @opensea.

---

> 5/ The 0G integration:

Every full deliberation transcript persists to 0G Storage.

Pure HTTP retrieval — no SDK, no auth.

```
curl https://indexer-storage-testnet-turbo.0g.ai/file?root=0x…
```

Tamper-evident memory for the swarm.

---

> 6/ The AXL transport:

Two physical machines (Frankfurt + Toronto), four AI settlers, one encrypted Yggdrasil mesh.

End-to-end encrypted, peer-discovered, no central coordinator.

This is what AXL is for.

---

> 7/ Try it now:

→ Submit a question: synod.gudman.xyz
→ Browse settled questions: synod.gudman.xyz/gallery
→ Verify any proof: synod.gudman.xyz/verify
→ Resolve any agent: synod.gudman.xyz/api/agent/settler-a.synodai.eth

---

> 8/ ETHGlobal Open Agents.

Submission to:
- @gensynai (AXL)
- @ensdomains (Identity + Creative tracks)
- @0G_labs (Track 2 Swarms)

ENSIP draft proposing the agent-identity schema as a standard: github.com/Ridwannurudeen/synod

---

> 9/ Built solo in 7 days.

Source: github.com/Ridwannurudeen/synod
Security model: docs/grant-security-model.md (next milestone: permissionless bonded settlers)

If you're building AI agents on @gensynai, @ensdomains, or @0G_labs — DM me.

End thread. 🤝

---

## 2. Gensyn Telegram (post in their group after video lands)

> hey team — hackathon submission for AXL prize.
>
> Synod: production AI consensus protocol over AXL. 4 settlers across 2 physical machines (Frankfurt + Toronto), Yggdrasil mesh, ed25519-signed votes, on-chain settlement on Gensyn L2 (chain 685689).
>
> Live: synod.gudman.xyz
> /network shows the mesh + on-chain registry cross-check
> SynodRegistry: 0xD387f749667590940d7c68CA350e57FbcE62b6ad
> First settlement tx: 0xc96835176b03b91e13907bab612ebdf79a0d5fe60647c76f2d6b06fa46ab8b82
>
> AXL is genuinely load-bearing — settlers communicate ONLY over AXL, no Redis, no HTTP fallback. Cross-machine demo via two terminals: `curl 127.0.0.1:9002/topology` from each box shows the bidirectional peer at the other machine's public IP.
>
> Demo video + writeup landing in the next 24h. Would love feedback before submission. Repo: github.com/Ridwannurudeen/synod

---

## 3. ENS Discord (post in #builders or relevant channel)

> 👋 hackathon submission for both ENS tracks at ETHGlobal Open Agents.
>
> Synod uses ENS in two ways that I haven't seen elsewhere:
>
> **1. ENS as the bootloader.** `synodai.eth`'s text records (synod.registry, synod.rpc, synod.chain-id, synod.threshold) are the source of truth for the entire protocol's runtime config. Cold-boot a UI from one ENS name; it self-configures. Editing the synod.registry text record on mainnet swings the live app to a different deployment.
>
> **2. ENS as judgment NFTs.** Every AI consensus event mints `j-{hash}.synodai.eth` — a transferable subname carrying the verdict + 0G transcript pointer + on-chain tx hash in text records. Owner = question submitter. Tradeable. Queryable from any contract via `Resolver.text(node, "synod.outcome")`.
>
> Plus an ENSIP draft proposing the parent/subname/judgment-subname schema as a standard for AI agent identity in ENS:
> github.com/Ridwannurudeen/synod/blob/main/docs/ENSIP-DRAFT-AI-AGENT-IDENTITY.md
>
> Live demo: synod.gudman.xyz
> Public profile API: synod.gudman.xyz/api/agent/settler-a.synodai.eth
>
> Would love any thoughts before final submission.

---

## 4. 0G Telegram (post in their hackathon group)

> Hackathon submission for 0G Track 2 Swarms.
>
> Synod is a specialist AI swarm (analyst + skeptic + synthesizer) where every full deliberation transcript persists to 0G Storage on Galileo.
>
> Bypassed the SDK entirely (it kept failing on the market contract decode) and use the `0g-storage-client` Go binary via subprocess + the indexer's HTTP API for retrieval. Pure REST GET, no auth:
>
> `curl https://indexer-storage-testnet-turbo.0g.ai/file?root=0x{root}`
>
> Returns the full reasoning chain — every model's argument, every signed vote — months later if you want.
>
> Live: synod.gudman.xyz/gallery — 10 settled questions, click any of them, "fetch raw transcript →" button.
>
> 0G key wallet: 0xc9c0754fDB2C22Fd19B5B649e1e60eE9d1Ccca3f (Galileo testnet)
>
> 11 transcripts persisted as of submission. Total ~24KB of decentralized memory.

---

## 5. ETHGlobal form — TIGHT submission body (max 500 chars-ish per field)

Most ETHGlobal forms have short field caps. Here's a tight version of each track's pitch you can paste:

### "Short description" field

> Synod ships AI Receipts — verifiable, transferable, ENS-addressable, 0G-anchored proofs of multi-model AI consensus. Multiple AI settlers on independent machines coordinate over Gensyn AXL, sign votes with ed25519, post quorum-signed settlements on Gensyn L2, persist full transcripts to 0G Storage, and (optionally) mint each judgment as a transferable ENS subname under synodai.eth.

### "How it works" field

> Settlers communicate over Gensyn AXL (encrypted P2P, cross-machine: Frankfurt + Toronto). Each settler runs a different LLM, reasons independently, signs its vote with its ed25519 identity. Per-outcome quorum: the winning outcome needs ≥N votes for that outcome (more robust than simple majority — prompt injection holds). Designated poster (lowest-hex-pubkey) submits to SynodRegistry on Gensyn L2. Designated poster also uploads the full transcript to 0G Storage. UI cold-boots from synodai.eth's on-chain text records. Optional judgment subname (j-{hash}.synodai.eth) carries the verdict in text records, transferable to the question submitter.

### "Tech stack" field

> Gensyn AXL (P2P transport, ed25519), Gensyn L2 (chain 685689, settlement layer), Solidity 0.8.24 (SynodRegistry, 25 tests + 256-run fuzz), Python 3.12 (settlers), Next.js 16 + viem + Tailwind v4 (UI), ENS PublicResolver + NameWrapper (parent + subname schema on Ethereum mainnet), 0G Storage Galileo (transcript persistence via 0g-storage-client + HTTP indexer for retrieval).

---

## 6. README badges (add to top of README.md)

```markdown
![Built for ETHGlobal Open Agents](https://img.shields.io/badge/ETHGlobal-Open%20Agents%202026-blue)
![Gensyn AXL](https://img.shields.io/badge/Transport-Gensyn%20AXL-orange)
![ENS](https://img.shields.io/badge/Identity-synodai.eth-purple)
![0G Storage](https://img.shields.io/badge/Memory-0G%20Storage-green)
![License](https://img.shields.io/badge/License-MIT-blue)
```

---

## 7. Pre-recording checklist (cross-reference with docs/DEMO_THEATER.md)

When you're ready to record, run `bash scripts/demo_preflight.sh` first. Every line should be ✓. If anything's red, fix before recording.

The "demo video URLs (preload these tabs)" section of preflight output gives you the exact tabs to have open. Tab-switch order in the video matches the master cut order in `docs/DEMO_THEATER.md`.

Audio tip: 5 seconds of silence at the start before you say anything — gives the noise floor a chance to set, lets you trim cleanly in editor.

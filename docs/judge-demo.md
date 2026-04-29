# Synod Judge Demo

Use this as the live-demo spine. The goal is to make judges see three things
quickly: AXL is essential, consensus is not a UI trick, and the proof is
independently verifiable after it lands on-chain.

## Recommended Live Path

1. Start the three-node demo:

   ```bash
   bash tools/demo-up-3node.sh
   ```

2. Open `http://localhost:3000`.

3. Inject a deterministic factual market:

   ```text
   Did Bitcoin's genesis block have timestamp January 3, 2009? Outcome 1 means yes, outcome 0 means no.
   ```

4. Narrate what is happening:

   - Three AXL nodes receive the same question over the mesh.
   - Three separate model providers infer independently.
   - Each settler signs its canonical vote with the same ed25519 key that identifies it on AXL.
   - The winning outcome needs quorum from that outcome, not just a high aggregate score.
   - One deterministic poster submits the signed-vote bundle to `SynodRegistry`.

5. When the UI shows `proof: verified`, copy the question id from the UI/logs and run:

   ```bash
   cd settler
   python tools/verify_settlement.py \
     --rpc-url http://127.0.0.1:8545 \
     --registry-address <SynodRegistry> \
     --question-id <question_id>
   ```

6. End with the grant path:

   ```text
   Hackathon version proves the primitive: decentralized AI settlement over AXL
   with verifiable signed proofs. Grant version turns it into Delphi v2
   infrastructure: stake-weighted enrollment, REE-backed inference, slashing,
   and a direct Delphi settler adapter.
   ```

## Environment

The default three-node demo expects these secrets in `settler/.env`:

```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
```

For topology-only local testing without three provider accounts, override nodes B
and C to Anthropic:

```bash
SYNOD_DEMO_B_PROVIDER=anthropic \
SYNOD_DEMO_B_MODEL=claude-sonnet-4-6 \
SYNOD_DEMO_C_PROVIDER=anthropic \
SYNOD_DEMO_C_MODEL=claude-sonnet-4-6 \
bash tools/demo-up-3node.sh
```

## Why This Can Win

- It is not another agent chat demo. It is settlement infrastructure for a live
  mainnet Gensyn product.
- AXL is not decorative. Without AXL, there is no decentralized settler mesh,
  no transport identity, and no signed-vote quorum.
- The security story is concrete: domain-bound votes, registered pubkeys,
  prompt/outcome/deadline binding, equivocation rejection, quorum-gated winner
  selection, on-chain proof anchoring, UI verification, and independent CLI
  verification.
- The grant path is natural because the hackathon artifact is a reference
  implementation of a protocol Gensyn can actually integrate.

## Avoid In The Live Demo

- Do not rely on only the UI as the trust story. Always show the CLI verifier.
- Do not claim on-chain ed25519 verification yet. The contract anchors and bounds
  the proof; off-chain verifiers check signatures against registered pubkeys.
- Do not demo ambiguous markets first. Use a deterministic factual market, then
  show that ambiguous prompts lower confidence if there is time.

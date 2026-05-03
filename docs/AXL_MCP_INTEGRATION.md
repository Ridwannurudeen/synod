# AXL MCP integration

Synod ships an MCP sidecar that registers `synod.settle` as a callable tool on
the local AXL MCP router. Any AXL agent on any node in the mesh can resolve a
market question through Synod **over the encrypted Yggdrasil mesh, not via
HTTPS** — no public endpoint, no API key, no DNS dependency.

## What this enables

- A remote AXL agent calls one MCP method (`tools/call name=settle`) on its
  local AXL daemon.
- AXL transports the JSON-RPC call across Yggdrasil to the destination
  node's MCP router.
- The router forwards to this sidecar, which drives Synod's existing
  inject + consensus + on-chain pipeline and returns a quorum-signed proof
  bundle.

## Wire diagram

```
caller (any AXL agent)
   |
   |  POST /mcp/<dest_peer_id>/synod
   v
caller's axl-node  --[Yggdrasil tunnel]--> dest axl-node
                                              |
                                              |  POST /route
                                              v
                                          mcp_router.py (port 9003)
                                              |
                                              |  POST /mcp
                                              v
                                          synod_mcp_sidecar.py (port 7100)
                                              |
                                              |  inject_question.py + AXL /send
                                              v
                                          primary settler (deliberation)
                                              |
                                              |  recordSettlement on-chain
                                              v
                                          SynodRegistry (Gensyn mainnet)
                                              |
                                              |  poll isSettled / getSettlement
                                              v
                                          response bundle bubbles back up
```

## Worked example

1. Remote agent emits:
   ```json
   {
     "jsonrpc": "2.0", "id": 1, "method": "tools/call",
     "params": {
       "name": "settle",
       "arguments": {
         "prompt": "Will protocol X reach $100M TVL by 2026-12-31?",
         "outcomes": [0, 1],
         "deadline_secs": 180
       }
     }
   }
   ```
2. Sidecar shells out to `settler/tools/inject_question.py`, broadcasts the
   `QuestionAnnouncement` to settler-A, and polls `SynodRegistry.isSettled`
   every 2 s for up to 90 s.
3. Once sealed, the sidecar returns:
   ```json
   {
     "structuredContent": {
       "questionId": "<64-hex>",
       "outcome": 1,
       "confidence": 0.94,
       "weighted_score": 1.88,
       "quorum_size": 2,
       "signed_votes_payload": "<hex>",
       "on_chain_tx": null,
       "posted_by": "0x...",
       "settled_at": 1714600000
     },
     "isError": false
   }
   ```

The caller can verify each signature in `signed_votes_payload` against the
settler set on-chain — the proof is portable beyond AXL.

## Submission body bullet (Track 1, AXL)

> Synod is registered as an AXL MCP service. Remote agents call
> `tools/call name=settle` on their local AXL daemon and receive a
> quorum-signed proof bundle that's also verifiable on-chain. First AXL
> submission to extend the protocol's MCP surface — settlement-as-a-service
> over the encrypted mesh.

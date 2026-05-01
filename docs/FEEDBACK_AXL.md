# Feedback — Gensyn AXL

Honest engineering feedback collected while building Synod (4 settlers across two physical machines, real cross-machine mesh, mainnet settlement on Gensyn L2). Submitted to the AXL prize at ETHGlobal Open Agents 2026.

## What worked great

- **The "single binary, talks to localhost" model is the right design.** Once configured, settlers don't have to know anything about networking — just `POST /send` with an `X-Destination-Peer-Id` header and AXL routes the encrypted payload across the mesh. We never had to think about TCP, TLS, NAT, or peer discovery in the agent code.
- **Yggdrasil mesh routing held up across two physical hosting providers** (Contabo Frankfurt ↔ Servarica Toronto) over the public internet. End-to-end encrypted, peer-discovered automatically, bidirectional in `/topology` from each side.
- **The `/topology` endpoint** is excellent for cross-checking — we built our entire `/network` page on it. Tells us pubkey, IPv6, peer URIs, peer up/down, inbound/outbound, all in one call.

## Friction we hit (genuinely useful for the team to know)

### 1. `tcp_port` mismatch silently breaks peer reachability

When Settler D was added on a separate machine, A's send calls returned `502 Bad Gateway` with body `Failed to reach peer: connect tcp [<ipv6>]:7000: connection was refused`. After debugging, the cause was that D's `node-d.json` had `"tcp_port": 7003` while A had `"tcp_port": 7000` — AXL apparently expects all peers in a mesh to listen on the same `tcp_port`, but this isn't called out in the docs we found.

**Suggestion**: README could note that `tcp_port` must match across all nodes in a mesh, OR error loudly at handshake time, OR auto-detect.

### 2. API binds to 127.0.0.1 only

The `api_port` (e.g. `9002`) is hardcoded to bind localhost only. We needed external monitoring (UI on Contabo probing D's `/topology` on Servarica). Worked around it with a `socat` TCP bridge listening publicly on a different port + a UFW rule restricting source IP. Mentioning in docs that the API is local-only by design (security feature) would save people 15 minutes.

### 3. `502` on `/send` is sometimes transient

Under demo load with a fresh peer connection, we occasionally got `502 Bad Gateway` on the first `POST /send` to a peer, then success on retry. We added retry-with-exponential-backoff (3 attempts, 0.4s base) in our agent code as a workaround. Nothing in the docs suggests this is expected behavior — clarification welcome.

### 4. Public listener config not obvious

To expose A's mesh listener publicly for D to dial, we set `"Listen": ["tls://127.0.0.1:9001", "tls://0.0.0.0:9101"]`. The format works but isn't documented in the example configs. A line in the README on multi-host setup would help.

## Things we'd love to see

- **`POST /send` returning a delivery confirmation**, not just "queued for routing." Right now we have to wait for the peer's `/recv` poll to confirm receipt.
- **A `/peers` admin endpoint** that returns more than topology — connection age, bytes in/out, last-seen — for debugging.
- **Native IPv4 UDP transport** as an alternative to TCP+TLS for low-latency intra-mesh.

## Settler set used

- A/B/C: Contabo (Frankfurt), 127.0.0.1:9001/9011/9021 listen, 9002/9012/9022 API
- D: Servarica (Toronto), public listener via 75.119.153.252:9101 ↔ 38.49.212.102 outbound

Mesh stayed bidirectional + healthy throughout the build. Genuinely good infrastructure — these notes are minor friction, not blockers.

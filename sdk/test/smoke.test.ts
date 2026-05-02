/**
 * Smoke tests for @synod/sdk against the live deployment at synod.gudman.xyz.
 *
 * These hit the real public API. They confirm shape + basic behavior — they
 * are NOT meant to be a full coverage suite. Run with:
 *
 *   cd sdk && npm test
 *
 * If the live endpoint is unreachable, all tests skip cleanly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SynodClient, DEFAULT_BASE_URL, SynodAPIError } from "../src/index.js";

const synod = new SynodClient({ timeoutMs: 8000 });

async function liveOnline(): Promise<boolean> {
  try {
    await synod.stats();
    return true;
  } catch {
    return false;
  }
}

describe("@synod/sdk smoke", { concurrency: false }, () => {
  it("default base URL is the canonical mainnet", () => {
    assert.equal(DEFAULT_BASE_URL, "https://synod.gudman.xyz");
  });

  it("stats() returns expected shape", async (t) => {
    if (!(await liveOnline())) return t.skip("live API unreachable");
    const s = await synod.stats();
    assert.equal(typeof s.questionsSettled, "number");
    assert.equal(typeof s.judgmentsMinted, "number");
    assert.equal(typeof s.transcriptsKB, "number");
    assert.equal(typeof s.ensParent, "string");
    assert.ok(s.questionsSettled >= 0);
  });

  it("ens() reports source and includes settler subnames", async () => {
    const e = await synod.ens();
    assert.ok(e.source === "ens" || e.source === "fallback");
    assert.ok(Array.isArray(e.subnames));
    if (e.source === "ens") {
      assert.ok(e.subnames.length >= 3, "expected at least 3 settler subnames");
    }
  });

  it("agent('settler-a.synodai.eth') resolves", async () => {
    const a = await synod.agent("settler-a.synodai.eth");
    assert.ok(a, "expected non-null profile");
    assert.equal(a.parent, "synodai.eth");
    assert.match(a.addr, /^0x[a-fA-F0-9]{40}$/);
    assert.match(a.pubkey, /^[a-f0-9]{64}$/);
  });

  it("agent() returns null on unknown name", async () => {
    const a = await synod.agent("nonexistent-xyz123.synodai.eth");
    assert.equal(a, null);
  });

  it("gallery() returns items array with expected fields", async () => {
    const g = await synod.gallery();
    assert.ok(g.count >= 0);
    assert.ok(Array.isArray(g.items));
    if (g.items.length > 0) {
      const it = g.items[0]!;
      assert.match(it.questionId, /^0x[a-f0-9]{64}$/);
      assert.equal(typeof it.transcript.indexerUrl, "string");
    }
  });

  it("verify() of a known settled question returns 'verified'", async () => {
    // The Pacific cross-machine question — won't be deleted
    const v = await synod.verify(
      "0xcd79b5dbfc6365f7f6c21e5b1c7a7b841a502b448fe9689f403d84fbac4447ac"
    );
    assert.equal(v.status, "verified");
    assert.ok(v.votes.length >= 2, "expected at least 2 verified votes");
    for (const vt of v.votes) {
      assert.equal(vt.signatureValid, true);
      assert.equal(vt.registered, true);
    }
  });

  it("verify() of a malformed id throws SynodAPIError", async () => {
    await assert.rejects(
      synod.verify("0xnotahex"),
      (err: unknown) => err instanceof SynodAPIError
    );
  });

  it("inft() returns the iNFT contract + tokens", async () => {
    const i = await synod.inft();
    assert.ok(i, "expected non-null iNFT view");
    assert.match(i.contract, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(i.chainId, 16602);
    assert.ok(i.tokens.length >= 4, "expected 4 settler iNFTs");
  });
});

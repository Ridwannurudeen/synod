// 0G Compute Network inference shell — invoked from the Python ZerogProvider.
//
// Reads a single JSON object from stdin:
//   { system, user, model?, max_tokens?, temperature?, provider? }
//
// Writes a single JSON object to stdout (one line, no trailing newline noise):
//   { text, model, model_tag, provider, chat_id, attestation_verified, error? }
//
// Exit code is 0 on success and 1 on any failure (stderr carries the trace,
// stdout still contains a JSON object with an "error" field so the Python
// caller can parse it without parsing stderr).
//
// Authentication: ZEROG_PRIVATE_KEY env var (32-byte hex, with or without
// 0x prefix). The Python caller is responsible for placing it in the env;
// this script never logs or echoes it.
//
// Why a separate Node script: the 0G Compute SDK is TypeScript-only, and
// Synod already shells out to a Node binary for 0G Storage uploads
// (see settler/synod_settler/storage_0g.py). Mirroring that pattern keeps
// the Python settler dependency-free with respect to JS toolchains.

import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const DEFAULT_RPC = "https://evmrpc-testnet.0g.ai";
// Galileo testnet defaults; override via ZEROG_RPC if 0G repoints the chain.
const DEFAULT_MODEL_HINT = "GLM"; // first match wins; falls back to first chatbot
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TEMPERATURE = 0;

function emit(obj) {
  // Single-line JSON so the Python caller can json.loads(stdout.strip())
  process.stdout.write(JSON.stringify(obj));
}

function fail(message, extra = {}) {
  emit({ error: message, ...extra });
  process.exit(1);
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function pickService(services, modelHint, providerAddress) {
  const chatbots = services.filter((s) => s.serviceType === "chatbot");
  if (chatbots.length === 0) {
    throw new Error("no chatbot services discovered on 0G Compute");
  }
  if (providerAddress) {
    const exact = chatbots.find(
      (s) => (s.provider || "").toLowerCase() === providerAddress.toLowerCase(),
    );
    if (exact) return exact;
    throw new Error(
      `provider ${providerAddress} not found among ${chatbots.length} chatbot services`,
    );
  }
  if (modelHint) {
    const hinted = chatbots.find((s) =>
      (s.model || "").toLowerCase().includes(modelHint.toLowerCase()),
    );
    if (hinted) return hinted;
  }
  return chatbots[0];
}

async function main() {
  const raw = (await readStdin()).trim();
  if (!raw) {
    fail("empty stdin: expected JSON payload");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON on stdin: ${e.message}`);
    return;
  }

  const system = String(payload.system ?? "");
  const user = String(payload.user ?? "");
  const modelHint = payload.model || DEFAULT_MODEL_HINT;
  const providerAddress = payload.provider || process.env.ZEROG_PROVIDER || "";
  const maxTokens = Number.isFinite(payload.max_tokens)
    ? Number(payload.max_tokens)
    : DEFAULT_MAX_TOKENS;
  const temperature = Number.isFinite(payload.temperature)
    ? Number(payload.temperature)
    : DEFAULT_TEMPERATURE;

  if (!user) {
    fail("payload.user is required");
    return;
  }

  const pkRaw = (process.env.ZEROG_PRIVATE_KEY || "").trim();
  if (!pkRaw) {
    fail("ZEROG_PRIVATE_KEY not set");
    return;
  }
  const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;

  const rpc = process.env.ZEROG_RPC || DEFAULT_RPC;

  let broker;
  let wallet;
  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    wallet = new ethers.Wallet(pk, provider);
    broker = await createZGComputeNetworkBroker(wallet);
  } catch (e) {
    fail(`broker init failed: ${e.message}`);
    return;
  }

  // Ensure the user account exists on 0G Compute. On first use the wallet
  // has no on-chain account; depositFund creates it. Subsequent calls top
  // up the balance, which is fine — the wallet started with 0.293 OG
  // (funded by the operator) so a small per-call top-up is acceptable for
  // the demo. We suppress the "amount too small" error from very large
  // integer gas-price paths and let acknowledgeProviderSigner surface the
  // real error if something else is wrong.
  try {
    if (broker.ledger && typeof broker.ledger.depositFund === "function") {
      await broker.ledger.depositFund(0.01);
    }
  } catch (e) {
    const msg = String(e?.message || e);
    // benign: account already exists, amount rounding, etc.
    const benign =
      msg.includes("already") ||
      msg.includes("exist") ||
      msg.includes("revert") ||
      msg.includes("0x");
    if (!benign) {
      process.stderr.write(`[zerog] depositFund warning: ${msg}\n`);
    }
  }

  // Pick a service. Service discovery is done after account creation so
  // acknowledgeProviderSigner has a valid account to charge.
  let service;
  try {
    const services = await broker.inference.listService();
    service = pickService(services, modelHint, providerAddress);
  } catch (e) {
    fail(`listService failed: ${e.message}`);
    return;
  }

  // Acknowledge the provider's TEE signer. The SDK exposes this as an
  // idempotent operation — the on-chain check is a no-op if already done.
  // First call costs gas; subsequent calls are cheap. We swallow "already
  // acknowledged" errors so the script is safe to call repeatedly.
  try {
    if (typeof broker.inference.acknowledgeProviderSigner === "function") {
      await broker.inference.acknowledgeProviderSigner(service.provider);
    }
  } catch (e) {
    const msg = String(e?.message || e);
    const benign =
      msg.includes("already") ||
      msg.includes("acknowledged") ||
      msg.includes("AlreadyAcknowledged");
    if (!benign) {
      fail(`acknowledgeProviderSigner failed: ${msg}`, {
        provider: service.provider,
      });
      return;
    }
  }

  let endpoint, model;
  try {
    const meta = await broker.inference.getServiceMetadata(service.provider);
    endpoint = meta.endpoint;
    model = meta.model;
  } catch (e) {
    fail(`getServiceMetadata failed: ${e.message}`, {
      provider: service.provider,
    });
    return;
  }

  let headers;
  try {
    headers = await broker.inference.getRequestHeaders(service.provider);
  } catch (e) {
    fail(`getRequestHeaders failed: ${e.message}`, {
      provider: service.provider,
    });
    return;
  }

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  let response;
  try {
    response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });
  } catch (e) {
    fail(`fetch failed: ${e.message}`, { endpoint });
    return;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    fail(`inference HTTP ${response.status}: ${body.slice(0, 400)}`, {
      endpoint,
    });
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    fail(`could not parse inference JSON: ${e.message}`);
    return;
  }

  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text) {
    fail("model returned empty content", { data });
    return;
  }

  // Attestation verification: the chatID is the response key the TEE signed
  // over. broker.inference.processResponse(provider, chatID) returns a
  // boolean. We capture both the chatID (a stable per-call attestation
  // reference, suitable for storing on-chain or in transcripts) and the
  // verification result.
  const chatId =
    response.headers.get("ZG-Res-Key") ||
    response.headers.get("zg-res-key") ||
    data.id ||
    "";

  let attestationVerified = false;
  if (chatId) {
    try {
      attestationVerified = Boolean(
        await broker.inference.processResponse(service.provider, chatId),
      );
    } catch (e) {
      // Don't fail the whole inference — we have the answer text, attestation
      // failure is metadata. Surface it via attestationVerified=false +
      // an attestation_error field.
      emit({
        text,
        model,
        model_tag: `zerog/${model}`,
        provider: service.provider,
        chat_id: chatId,
        attestation_verified: false,
        attestation_error: String(e?.message || e),
      });
      return;
    }
  }

  emit({
    text,
    model,
    model_tag: `zerog/${model}`,
    provider: service.provider,
    chat_id: chatId,
    attestation_verified: attestationVerified,
  });
}

main().catch((e) => {
  fail(`unhandled: ${e?.message || e}`);
});

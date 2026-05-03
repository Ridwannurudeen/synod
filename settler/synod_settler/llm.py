"""LLM provider abstraction for Synod settlers.

A settler runs ONE provider. Heterogeneity in the network comes from running
many settlers, each with a different provider. The provider's job is to take
a resolution prompt + the list of valid outcome indices, run inference, and
return a structured (outcome, confidence, reasoning) result.

v1 ships with Anthropic, OpenAI, and Gemini providers. Each settler still runs
one provider; heterogeneity comes from deploying several settlers with
different `SYNOD_PROVIDER` values.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InferenceResult:
    """The structured answer produced by an LLM provider for one question.

    `extras` is an optional, provider-specific metadata bag — used (for now)
    by ZerogProvider to surface the per-call 0G Compute attestation chat_id
    and TEE verification flag without bloating the protocol-signed payload.
    Callers that don't care about provenance can ignore it.
    """

    outcome: int
    confidence: float
    reasoning: str
    model_tag: str
    extras: dict[str, Any] | None = None


SYSTEM_PROMPT = """You are an oracle for an AI-settled prediction market.

You will be given a resolution prompt and a fixed set of valid outcome indices.
Read the prompt, reason carefully, and answer with ONLY a single JSON object
in this exact shape (no prose before or after, no markdown fence):

{"outcome": <int>, "confidence": <float between 0.0 and 1.0>, "reasoning": "<brief>"}

Constraints:
- "outcome" MUST be one of the provided valid indices.
- "confidence" reflects YOUR own certainty about the answer, not the popular view.
- "reasoning" must be at most 280 characters.

Be honest about uncertainty: when the prompt is ambiguous or the evidence is
mixed, set confidence below 0.6. Confident answers (>0.85) should only be
issued for questions that have a clear factual resolution.
"""


def _build_user_prompt(prompt: str, outcomes: list[int]) -> str:
    return (
        f"Resolution prompt:\n{prompt}\n\n"
        f"Valid outcome indices: {outcomes}\n\n"
        f"Respond with the JSON object only."
    )


def _parse_inference_json(raw: str, outcomes: list[int]) -> tuple[int, float, str]:
    """Parse a model's JSON response. Tolerant of code-fenced output."""
    text = raw.strip()
    if text.startswith("```"):
        # strip code fence
        text = text.strip("`")
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl + 1 :]
        if text.endswith("```"):
            text = text[:-3]
    text = text.strip()

    try:
        data: dict[str, Any] = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"model did not return valid JSON: {e}\nraw: {raw!r}") from e

    outcome = int(data["outcome"])
    if outcome not in outcomes:
        raise ValueError(f"outcome {outcome} not in valid set {outcomes}")

    confidence = float(data.get("confidence", 0.5))
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence out of range: {confidence}")

    reasoning = str(data.get("reasoning", "")).strip()[:280]

    return outcome, confidence, reasoning


class LLMProvider(ABC):
    """Provider interface. One concrete implementation per LLM family."""

    model_tag: str

    @abstractmethod
    def infer(self, prompt: str, outcomes: list[int]) -> InferenceResult:
        ...


class AnthropicProvider(LLMProvider):
    """Claude via the official Anthropic SDK.

    Defaults to Sonnet 4.6 because settlement is a structured-output task
    (JSON with three fields) where Sonnet quality is indistinguishable from
    Opus, and Sonnet is roughly 5x cheaper. Override via SYNOD_MODEL when
    recording the final demo if you want every model in the network to be the
    most capable variant.
    """

    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, *, model: str | None = None, api_key: str | None = None) -> None:
        from anthropic import Anthropic  # local import keeps OpenAI/Gemini optional

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        self._client = Anthropic(api_key=key)
        self.model_tag = model or self.DEFAULT_MODEL

    def infer(self, prompt: str, outcomes: list[int]) -> InferenceResult:
        user = _build_user_prompt(prompt, outcomes)
        resp = self._client.messages.create(
            model=self.model_tag,
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user}],
        )
        # Concatenate text blocks; Anthropic returns a list of content blocks
        text = "".join(
            block.text for block in resp.content if getattr(block, "type", "") == "text"
        )
        outcome, confidence, reasoning = _parse_inference_json(text, outcomes)
        return InferenceResult(
            outcome=outcome,
            confidence=confidence,
            reasoning=reasoning,
            model_tag=self.model_tag,
        )


class OpenAIProvider(LLMProvider):
    """OpenAI chat-completions provider."""

    DEFAULT_MODEL = "gpt-4o"

    def __init__(self, *, model: str | None = None, api_key: str | None = None) -> None:
        from openai import OpenAI  # local import keeps provider optional

        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        self._client = OpenAI(api_key=key)
        self.model_tag = model or self.DEFAULT_MODEL

    def infer(self, prompt: str, outcomes: list[int]) -> InferenceResult:
        user = _build_user_prompt(prompt, outcomes)
        resp = self._client.chat.completions.create(
            model=self.model_tag,
            temperature=0,
            max_tokens=512,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
        )
        text = resp.choices[0].message.content or ""
        outcome, confidence, reasoning = _parse_inference_json(text, outcomes)
        return InferenceResult(
            outcome=outcome,
            confidence=confidence,
            reasoning=reasoning,
            model_tag=self.model_tag,
        )


class GeminiProvider(LLMProvider):
    """Google Gemini provider via google-genai."""

    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(self, *, model: str | None = None, api_key: str | None = None) -> None:
        from google import genai  # local import keeps provider optional

        key = api_key or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise RuntimeError("GOOGLE_API_KEY is not set")
        self._client = genai.Client(api_key=key)
        self.model_tag = model or self.DEFAULT_MODEL

    def infer(self, prompt: str, outcomes: list[int]) -> InferenceResult:
        user = _build_user_prompt(prompt, outcomes)
        resp = self._client.models.generate_content(
            model=self.model_tag,
            contents=user,
            config={
                "system_instruction": SYSTEM_PROMPT,
                "response_mime_type": "application/json",
                "temperature": 0,
            },
        )
        text = getattr(resp, "text", "") or ""
        outcome, confidence, reasoning = _parse_inference_json(text, outcomes)
        return InferenceResult(
            outcome=outcome,
            confidence=confidence,
            reasoning=reasoning,
            model_tag=self.model_tag,
        )


class ZerogProvider(LLMProvider):
    """0G Compute Network provider via the TypeScript serving-broker SDK.

    The 0G Compute SDK is TypeScript-only (no Python bindings), so this
    provider shells out to a Node script — same pattern Synod already uses
    for 0G Storage uploads (see synod_settler/storage_0g.py). The script
    handles broker init, provider discovery, TEE-signer acknowledgment,
    request-header signing, the OpenAI-compatible chat call, and TEE
    response verification, then prints a single-line JSON result.

    Authentication: the wallet private key is read by the Node child
    process from the ZEROG_PRIVATE_KEY env var. This Python class never
    touches the key. Callers should populate that env from a secret store
    on disk (production VPS layout: /opt/synod-app/runtime/.0g-key.json).

    Per-call cost on Galileo testnet is ~0.004 OG; the wallet is funded
    once via 0g-compute-cli, not from this provider. The first inference
    against a given provider acknowledges its TEE signer (one-time gas
    cost handled inside the Node script).

    Attestation: when 0G returns a `ZG-Res-Key` header, we verify it with
    broker.inference.processResponse(); the chat_id and verification flag
    are surfaced via InferenceResult.extras for downstream transcript /
    on-chain provenance, never folded into the protocol-signed payload.
    """

    DEFAULT_MODEL = "GLM"  # match hint passed to listService.filter()
    DEFAULT_TIMEOUT_S = 60

    def __init__(self, *, model: str | None = None, api_key: str | None = None) -> None:
        # api_key kept in signature for parity with sibling providers; 0G
        # auth is wallet-based and lives in ZEROG_PRIVATE_KEY in the child
        # process env, not here.
        del api_key
        if not os.environ.get("ZEROG_PRIVATE_KEY", "").strip():
            raise RuntimeError("ZEROG_PRIVATE_KEY is not set")
        self._model_hint = model or self.DEFAULT_MODEL
        # model_tag is finalized after the first inference (we learn the
        # exact provider-served model name from the broker response). Until
        # then, expose the hint so logs are sensible.
        self.model_tag = f"zerog/{self._model_hint}"
        self._script_path = self._resolve_script_path()
        self._node_bin = os.environ.get("SYNOD_NODE_BIN", "node")
        self._timeout_s = int(
            os.environ.get("ZEROG_TIMEOUT_S", str(self.DEFAULT_TIMEOUT_S))
        )

    @staticmethod
    def _resolve_script_path() -> Path:
        """Locate scripts/zerog_infer.mjs.

        Override with ZEROG_INFER_SCRIPT for non-standard layouts (Docker,
        VPS deploys, integration tests). Default resolution: walk up from
        this module until a `scripts/zerog_infer.mjs` is found.
        """
        override = os.environ.get("ZEROG_INFER_SCRIPT", "").strip()
        if override:
            p = Path(override)
            if not p.is_file():
                raise RuntimeError(f"ZEROG_INFER_SCRIPT does not exist: {p}")
            return p

        here = Path(__file__).resolve().parent
        # synod_settler/ -> settler/ -> settler/scripts/zerog_infer.mjs
        candidate = here.parent / "scripts" / "zerog_infer.mjs"
        if candidate.is_file():
            return candidate
        raise RuntimeError(
            f"zerog_infer.mjs not found at {candidate}; "
            "set ZEROG_INFER_SCRIPT to override"
        )

    def infer(self, prompt: str, outcomes: list[int]) -> InferenceResult:
        user = _build_user_prompt(prompt, outcomes)
        payload = {
            "system": SYSTEM_PROMPT,
            "user": user,
            "model": self._model_hint,
            "max_tokens": 512,
            "temperature": 0,
        }

        try:
            proc = subprocess.run(
                [self._node_bin, str(self._script_path)],
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=self._timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as e:
            raise RuntimeError(
                f"zerog_infer.mjs timed out after {self._timeout_s}s"
            ) from e
        except FileNotFoundError as e:
            raise RuntimeError(
                f"node binary not found at {self._node_bin!r} "
                "(set SYNOD_NODE_BIN)"
            ) from e

        stdout = (proc.stdout or "").strip()
        if not stdout:
            tail = (proc.stderr or "")[-400:]
            raise RuntimeError(
                f"zerog_infer.mjs produced no stdout (rc={proc.returncode}). "
                f"stderr tail: {tail}"
            )

        json_text = stdout
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                json_text = line
                break
        try:
            result = json.loads(json_text)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"zerog_infer.mjs stdout was not JSON: {e}\n"
                f"stdout: {stdout[:400]!r}"
            ) from e

        if proc.returncode != 0 or "error" in result:
            err = result.get("error") or f"rc={proc.returncode}"
            raise RuntimeError(f"0G Compute inference failed: {err}")

        text = result.get("text") or ""
        outcome, confidence, reasoning = _parse_inference_json(text, outcomes)

        # Promote the actual served model name to the tag so the on-chain
        # vote carries (e.g.) "zerog/GLM-5-FP8" not "zerog/GLM".
        served_model = result.get("model")
        if served_model:
            self.model_tag = f"zerog/{served_model}"

        extras: dict[str, Any] = {}
        for key in ("chat_id", "attestation_verified", "provider", "attestation_error"):
            if key in result and result[key] not in (None, ""):
                extras[key] = result[key]

        return InferenceResult(
            outcome=outcome,
            confidence=confidence,
            reasoning=reasoning,
            model_tag=self.model_tag,
            extras=extras or None,
        )


class DeterministicProvider(LLMProvider):
    """Test-only provider: returns canned (outcome, confidence, reasoning).

    Used by the deterministic smoke test so the AXL → consensus → on-chain
    path can be exercised in CI without real API keys. Output is a function
    of `prompt` (sha256-keyed) so two settlers using the same seed produce
    matching answers, which is exactly what we want for a quorum smoke test.

    Configure with SYNOD_PROVIDER=deterministic and optionally
    SYNOD_DETERMINISTIC_OUTCOME (int) and SYNOD_DETERMINISTIC_CONFIDENCE
    (float in [0,1]) to pin the answer; otherwise outcome is the first
    valid outcome in the list and confidence is 0.95.
    """

    DEFAULT_MODEL = "deterministic-v1"

    def __init__(self, *, model: str | None = None) -> None:
        self.model_tag = model or self.DEFAULT_MODEL
        outcome_raw = os.environ.get("SYNOD_DETERMINISTIC_OUTCOME")
        conf_raw = os.environ.get("SYNOD_DETERMINISTIC_CONFIDENCE")
        self._pinned_outcome: int | None = None
        self._pinned_confidence: float | None = None
        if outcome_raw is not None:
            try:
                self._pinned_outcome = int(outcome_raw)
            except ValueError:
                pass
        if conf_raw is not None:
            try:
                v = float(conf_raw)
                if 0.0 <= v <= 1.0:
                    self._pinned_confidence = v
            except ValueError:
                pass

    def infer(self, prompt: str, outcomes: list[int]) -> InferenceResult:
        outcome = (
            self._pinned_outcome
            if self._pinned_outcome is not None and self._pinned_outcome in outcomes
            else outcomes[0]
        )
        confidence = (
            self._pinned_confidence if self._pinned_confidence is not None else 0.95
        )
        reasoning = (
            f"deterministic provider: returning outcome={outcome} "
            f"with confidence={confidence:.2f} for smoke test (no real inference)"
        )
        return InferenceResult(
            outcome=int(outcome),
            confidence=float(confidence),
            reasoning=reasoning,
            model_tag=self.model_tag,
        )


def build_provider(provider_name: str, *, model: str | None = None) -> LLMProvider:
    """Factory for the SYNOD_PROVIDER env value."""
    name = provider_name.lower().strip()
    if name == "anthropic":
        return AnthropicProvider(model=model)
    if name == "openai":
        return OpenAIProvider(model=model)
    if name == "gemini":
        return GeminiProvider(model=model)
    if name == "zerog":
        return ZerogProvider(model=model)
    if name == "deterministic":
        return DeterministicProvider(model=model)
    raise ValueError(f"unknown SYNOD_PROVIDER: {provider_name}")

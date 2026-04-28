"""LLM provider abstraction for Synod settlers.

A settler runs ONE provider. Heterogeneity in the network comes from running
many settlers, each with a different provider. The provider's job is to take
a resolution prompt + the list of valid outcome indices, run inference, and
return a structured (outcome, confidence, reasoning) result.

v1 ships with the Anthropic provider. OpenAI and Gemini providers will be
added in Day 3 when API keys are wired in.
"""

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InferenceResult:
    """The structured answer produced by an LLM provider for one question."""

    outcome: int
    confidence: float
    reasoning: str
    model_tag: str


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


def build_provider(provider_name: str, *, model: str | None = None) -> LLMProvider:
    """Factory for the SYNOD_PROVIDER env value."""
    name = provider_name.lower().strip()
    if name == "anthropic":
        return AnthropicProvider(model=model)
    if name == "openai":
        raise NotImplementedError("openai provider lands Day 3")
    if name == "gemini":
        raise NotImplementedError("gemini provider lands Day 3")
    raise ValueError(f"unknown SYNOD_PROVIDER: {provider_name}")

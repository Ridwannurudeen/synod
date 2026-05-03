"""Tests for the ZerogProvider (0G Compute via Node shell-out).

These tests mock subprocess.run so the test suite never hits the 0G
Galileo testnet, never spawns Node, and never needs a wallet. The
provider is exercised end-to-end through its parsing path.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

import pytest

from synod_settler.llm import (
    InferenceResult,
    ZerogProvider,
    build_provider,
)


def _ok_stdout(text_payload: dict[str, Any], **extra: Any) -> str:
    """Build a stdout JSON blob the same way zerog_infer.mjs does."""
    out: dict[str, Any] = {
        "text": json.dumps(text_payload),
        "model": "GLM-5-FP8",
        "model_tag": "zerog/GLM-5-FP8",
        "provider": "0xprovider",
        "chat_id": "chat-abc123",
        "attestation_verified": True,
    }
    out.update(extra)
    return json.dumps(out)


def _completed(stdout: str, *, returncode: int = 0, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["node", "zerog_infer.mjs"],
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


def _setup_env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    """Common env setup: set the wallet key and point the script env at a
    real-on-disk file so _resolve_script_path doesn't raise.
    """
    monkeypatch.setenv("ZEROG_PRIVATE_KEY", "0x" + "a" * 64)
    fake_script = tmp_path / "zerog_infer.mjs"
    fake_script.write_text("// stub")
    monkeypatch.setenv("ZEROG_INFER_SCRIPT", str(fake_script))


def test_zerog_provider_parses_subprocess_output(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    _setup_env(monkeypatch, tmp_path)

    captured: dict[str, Any] = {}

    def fake_run(cmd, *, input, capture_output, text, timeout, check):  # noqa: ARG001
        captured["cmd"] = cmd
        captured["input"] = input
        captured["timeout"] = timeout
        return _completed(
            _ok_stdout({"outcome": 1, "confidence": 0.83, "reasoning": "GLM said yes"})
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    p = ZerogProvider()
    r = p.infer("Will it rain?", [0, 1])

    assert isinstance(r, InferenceResult)
    assert r.outcome == 1
    assert r.confidence == pytest.approx(0.83)
    assert r.reasoning == "GLM said yes"
    # model_tag is upgraded from the hint to the actual served model name
    # after the first inference.
    assert r.model_tag == "zerog/GLM-5-FP8"
    assert p.model_tag == "zerog/GLM-5-FP8"

    # Attestation metadata lands in extras, not in the signed protocol payload.
    assert r.extras is not None
    assert r.extras["chat_id"] == "chat-abc123"
    assert r.extras["attestation_verified"] is True
    assert r.extras["provider"] == "0xprovider"

    # Subprocess was called with stdin JSON containing the system prompt + user prompt.
    payload = json.loads(captured["input"])
    assert "outcome" not in payload  # we don't leak the JSON shape into the user side
    assert "Resolution prompt:" in payload["user"]
    assert "Will it rain?" in payload["user"]
    assert payload["system"].startswith("You are an oracle")
    assert payload["max_tokens"] == 512
    assert payload["temperature"] == 0


def test_zerog_provider_propagates_node_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    _setup_env(monkeypatch, tmp_path)

    err_blob = json.dumps({"error": "broker init failed: insufficient OG balance"})

    def fake_run(*args, **kwargs):  # noqa: ARG001
        return _completed(err_blob, returncode=1, stderr="broker error trace")

    monkeypatch.setattr(subprocess, "run", fake_run)

    p = ZerogProvider()
    with pytest.raises(RuntimeError, match="0G Compute inference failed"):
        p.infer("Q?", [0, 1])


def test_zerog_provider_raises_on_invalid_inference_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """Node script ran fine but the model returned non-JSON content."""
    _setup_env(monkeypatch, tmp_path)

    bad_blob = json.dumps(
        {
            "text": "I refuse to answer in JSON",
            "model": "GLM-5-FP8",
            "chat_id": "x",
            "attestation_verified": True,
        }
    )

    def fake_run(*args, **kwargs):  # noqa: ARG001
        return _completed(bad_blob)

    monkeypatch.setattr(subprocess, "run", fake_run)

    p = ZerogProvider()
    with pytest.raises(ValueError, match="model did not return valid JSON"):
        p.infer("Q?", [0, 1])


def test_zerog_provider_requires_private_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.delenv("ZEROG_PRIVATE_KEY", raising=False)
    fake_script = tmp_path / "zerog_infer.mjs"
    fake_script.write_text("// stub")
    monkeypatch.setenv("ZEROG_INFER_SCRIPT", str(fake_script))

    with pytest.raises(RuntimeError, match="ZEROG_PRIVATE_KEY is not set"):
        ZerogProvider()


def test_zerog_provider_handles_subprocess_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    _setup_env(monkeypatch, tmp_path)

    def fake_run(*args, **kwargs):  # noqa: ARG001
        raise subprocess.TimeoutExpired(cmd="node", timeout=60)

    monkeypatch.setattr(subprocess, "run", fake_run)

    p = ZerogProvider()
    with pytest.raises(RuntimeError, match="timed out"):
        p.infer("Q?", [0, 1])


def test_build_provider_dispatches_zerog(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    _setup_env(monkeypatch, tmp_path)
    p = build_provider("zerog")
    assert isinstance(p, ZerogProvider)
    # default model hint
    assert p.model_tag == "zerog/GLM"

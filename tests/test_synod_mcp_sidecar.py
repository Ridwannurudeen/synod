"""Tests for the Synod AXL MCP sidecar.

Run with:

    cd axl/integrations && pytest -q ../../tests/test_synod_mcp_sidecar.py

Pytest config is in axl/integrations/pyproject.toml, which sets
asyncio_mode = "auto" and pulls in pytest-aiohttp. The sidecar module
lives at axl/synod_mcp_sidecar.py and is added to sys.path below.

These tests mock the AXL daemon (we don't actually spawn inject_question.py
against a live mesh) and the on-chain registry (no RPC). They exercise:

  - tools/list returns the settle schema
  - tools/call with valid args drives the inject + poll pipeline and
    returns a structuredContent bundle
  - tools/call with invalid args returns a JSON-RPC -32602 error
  - tools/call with an unknown tool name returns -32602
  - tools/call when the pipeline raises returns isError=True
  - initialize / ping / unknown method handling
  - _register and _deregister POST/DELETE the right payloads
  - _register treats 409 as success
  - /health reports registered=True after startup
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

# Make the sidecar module importable: axl/ lives one level above tests/.
_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT / "axl"))

import synod_mcp_sidecar as sidecar  # noqa: E402


# ── Fixtures ───────────────────────────────────────────────────────────


@pytest.fixture
def cfg() -> sidecar.SidecarConfig:
    """A non-validated test config. Real network hosts are never contacted."""
    return sidecar.SidecarConfig(
        primary_axl="http://127.0.0.1:9002",
        primary_pubkey="a" * 64,
        registry_rpc="http://127.0.0.1:0",
        registry_addr="0x0000000000000000000000000000000000000001",
        router_url="http://127.0.0.1:9003",
        listen_port=7100,
        service_name="synod",
        settle_timeout_secs=5.0,
        poll_interval_secs=0.01,
        inject_python="/usr/bin/python3",
        inject_script="/dev/null",
        registry_abi_path=None,
    )


@pytest.fixture
def app(cfg: sidecar.SidecarConfig) -> web.Application:
    application = sidecar.build_app(cfg)
    return application


# ── parse_settle_args ──────────────────────────────────────────────────


class TestParseSettleArgs:
    def test_valid(self):
        args = sidecar.parse_settle_args(
            {"prompt": "Will X happen?", "outcomes": [0, 1], "deadline_secs": 60}
        )
        assert args.prompt == "Will X happen?"
        assert args.outcomes == [0, 1]
        assert args.deadline_secs == 60

    def test_default_deadline(self):
        args = sidecar.parse_settle_args(
            {"prompt": "Will X happen?", "outcomes": [0, 1]}
        )
        assert args.deadline_secs == 180

    @pytest.mark.parametrize(
        "raw,fragment",
        [
            ("not-a-dict", "must be an object"),
            ({}, "prompt"),
            ({"prompt": ""}, "prompt"),
            ({"prompt": "x"}, "outcomes"),
            ({"prompt": "x", "outcomes": [0]}, "at least 2"),
            ({"prompt": "x", "outcomes": [0, 0]}, "unique"),
            ({"prompt": "x", "outcomes": [0, "1"]}, "integers"),
            ({"prompt": "x", "outcomes": [0, -1]}, "non-negative"),
            ({"prompt": "x", "outcomes": list(range(20))}, "too large"),
            ({"prompt": "x" * 2000, "outcomes": [0, 1]}, "too long"),
            (
                {"prompt": "x", "outcomes": [0, 1], "deadline_secs": 5},
                "deadline_secs",
            ),
            (
                {"prompt": "x", "outcomes": [0, 1], "deadline_secs": 99999},
                "deadline_secs",
            ),
        ],
    )
    def test_invalid(self, raw, fragment):
        with pytest.raises(ValueError) as exc_info:
            sidecar.parse_settle_args(raw)
        assert fragment in str(exc_info.value)


# ── tools/list ─────────────────────────────────────────────────────────


class TestToolsList:
    async def test_returns_settle_schema(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        assert resp.status == 200
        body = await resp.json()
        assert body["jsonrpc"] == "2.0"
        assert body["id"] == 1
        tools = body["result"]["tools"]
        assert len(tools) == 1
        tool = tools[0]
        assert tool["name"] == "settle"
        assert "prompt" in tool["inputSchema"]["properties"]
        assert "outcomes" in tool["inputSchema"]["properties"]
        assert tool["inputSchema"]["required"] == ["prompt", "outcomes"]
        assert "questionId" in tool["outputSchema"]["properties"]
        assert "outcome" in tool["outputSchema"]["properties"]
        assert "signed_votes_payload" in tool["outputSchema"]["properties"]


# ── tools/call ─────────────────────────────────────────────────────────


class TestToolsCall:
    async def test_valid_call_drives_pipeline(
        self, aiohttp_client, app, monkeypatch
    ):
        """Mocks the settle pipeline; verifies args reach it and bundle round-trips."""
        captured: dict[str, object] = {}

        async def fake_pipeline(cfg, args):
            captured["cfg"] = cfg
            captured["args"] = args
            return {
                "questionId": "ab" * 32,
                "outcome": 1,
                "confidence": 0.9234,
                "weighted_score": 1.85,
                "quorum_size": 2,
                "signed_votes_payload": "deadbeef",
                "on_chain_tx": None,
                "posted_by": "0x" + "1" * 40,
                "settled_at": 1700000000,
            }

        monkeypatch.setattr(sidecar, "_settle_pipeline", fake_pipeline)

        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {
                    "name": "settle",
                    "arguments": {
                        "prompt": "Will X happen?",
                        "outcomes": [0, 1],
                        "deadline_secs": 120,
                    },
                },
            },
        )
        assert resp.status == 200
        body = await resp.json()
        assert body["id"] == 7
        assert "error" not in body
        result = body["result"]
        assert result["isError"] is False
        assert result["structuredContent"]["questionId"] == "ab" * 32
        assert result["structuredContent"]["outcome"] == 1
        assert result["content"][0]["type"] == "text"
        # Pipeline got the right args
        assert captured["args"].prompt == "Will X happen?"
        assert captured["args"].outcomes == [0, 1]
        assert captured["args"].deadline_secs == 120

    async def test_invalid_args_returns_jsonrpc_error(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": {
                    "name": "settle",
                    "arguments": {"prompt": "", "outcomes": [0, 1]},
                },
            },
        )
        assert resp.status == 200
        body = await resp.json()
        assert body["id"] == 8
        assert "error" in body
        assert body["error"]["code"] == sidecar.ERR_INVALID_PARAMS
        assert "prompt" in body["error"]["message"]

    async def test_unknown_tool_returns_jsonrpc_error(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tools/call",
                "params": {"name": "nope", "arguments": {}},
            },
        )
        body = await resp.json()
        assert body["error"]["code"] == sidecar.ERR_INVALID_PARAMS
        assert "unknown tool" in body["error"]["message"]

    async def test_pipeline_failure_returns_is_error(
        self, aiohttp_client, app, monkeypatch
    ):
        async def boom(cfg, args):
            raise RuntimeError("primary settler unreachable")

        monkeypatch.setattr(sidecar, "_settle_pipeline", boom)

        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 10,
                "method": "tools/call",
                "params": {
                    "name": "settle",
                    "arguments": {"prompt": "x", "outcomes": [0, 1]},
                },
            },
        )
        body = await resp.json()
        # Tool-level error: result envelope, isError=True, no JSON-RPC error.
        assert "error" not in body
        assert body["result"]["isError"] is True
        text = body["result"]["content"][0]["text"]
        assert "settle failed" in text
        assert "primary settler unreachable" in text

    async def test_non_object_params_rejected(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 11,
                "method": "tools/call",
                "params": "not-an-object",
            },
        )
        body = await resp.json()
        assert body["error"]["code"] == sidecar.ERR_INVALID_PARAMS


# ── Other JSON-RPC methods ─────────────────────────────────────────────


class TestOtherMethods:
    async def test_initialize(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
        )
        body = await resp.json()
        assert body["result"]["protocolVersion"] == sidecar.MCP_PROTOCOL_VERSION
        assert body["result"]["capabilities"]["tools"]["listChanged"] is False
        assert body["result"]["serverInfo"]["name"] == sidecar.SERVER_NAME

    async def test_ping(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 2, "method": "ping"},
        )
        body = await resp.json()
        assert body["result"] == {}

    async def test_initialized_notification_returns_204(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        assert resp.status == 204

    async def test_unknown_method(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/banana"},
        )
        body = await resp.json()
        assert body["error"]["code"] == sidecar.ERR_METHOD_NOT_FOUND

    async def test_malformed_json(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            data=b"{not-json",
            headers={"Content-Type": "application/json"},
        )
        body = await resp.json()
        assert body["error"]["code"] == sidecar.ERR_PARSE_ERROR

    async def test_wrong_jsonrpc_version(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.post(
            "/mcp",
            json={"jsonrpc": "1.0", "id": 4, "method": "tools/list"},
        )
        body = await resp.json()
        assert body["error"]["code"] == sidecar.ERR_INVALID_REQUEST


# ── /health ────────────────────────────────────────────────────────────


class TestHealth:
    async def test_health_unregistered(self, aiohttp_client, app):
        client = await aiohttp_client(app)
        resp = await client.get("/health")
        assert resp.status == 200
        body = await resp.json()
        assert body["ok"] is True
        assert body["registered"] is False
        assert body["service"] == "synod"

    async def test_health_after_register(self, aiohttp_client, app):
        # Manually flip the flag the way _on_startup would.
        app["registered"] = True
        client = await aiohttp_client(app)
        resp = await client.get("/health")
        body = await resp.json()
        assert body["registered"] is True


# ── Router lifecycle: _register / _deregister ──────────────────────────


def _mock_session_with_response(status: int, text: str = ""):
    """Build an aiohttp.ClientSession-style mock that returns status/text once."""
    mock_resp = AsyncMock()
    mock_resp.status = status
    mock_resp.text = AsyncMock(return_value=text)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_resp)
    cm.__aexit__ = AsyncMock(return_value=False)

    session = MagicMock()
    session.post = MagicMock(return_value=cm)
    session.delete = MagicMock(return_value=cm)
    return session, mock_resp


class TestRegister:
    async def test_register_success(self, cfg):
        session, _ = _mock_session_with_response(200)
        ok = await sidecar._register(cfg, session)
        assert ok is True
        # Verify URL + payload sent to router.
        args, kwargs = session.post.call_args
        assert args[0] == "http://127.0.0.1:9003/register"
        assert kwargs["json"]["service"] == "synod"
        assert kwargs["json"]["endpoint"] == "http://127.0.0.1:7100/mcp"

    async def test_register_409_is_success(self, cfg):
        session, _ = _mock_session_with_response(409, "already registered")
        ok = await sidecar._register(cfg, session)
        assert ok is True

    async def test_register_other_error(self, cfg):
        session, _ = _mock_session_with_response(500, "server boom")
        ok = await sidecar._register(cfg, session)
        assert ok is False

    async def test_register_router_unreachable(self, cfg):
        session = MagicMock()
        session.post = MagicMock(side_effect=ConnectionRefusedError("nope"))
        ok = await sidecar._register(cfg, session)
        assert ok is False


class TestDeregister:
    async def test_deregister_success(self, cfg):
        session, _ = _mock_session_with_response(200)
        await sidecar._deregister(cfg, session)
        args, _ = session.delete.call_args
        assert args[0] == "http://127.0.0.1:9003/register/synod"

    async def test_deregister_404_swallowed(self, cfg):
        session, _ = _mock_session_with_response(404)
        await sidecar._deregister(cfg, session)  # must not raise

    async def test_deregister_router_unreachable(self, cfg):
        session = MagicMock()
        session.delete = MagicMock(side_effect=ConnectionRefusedError("nope"))
        await sidecar._deregister(cfg, session)  # must not raise


# ── Config validation ─────────────────────────────────────────────────


class TestConfigValidation:
    def test_missing_pubkey_raises(self, monkeypatch):
        monkeypatch.delenv("SYNOD_MCP_PRIMARY_PUBKEY", raising=False)
        monkeypatch.setenv("SYNOD_MCP_REGISTRY_RPC", "http://x")
        monkeypatch.setenv("SYNOD_MCP_REGISTRY_ADDR", "0xabc")
        cfg = sidecar.SidecarConfig.from_env()
        with pytest.raises(RuntimeError, match="SYNOD_MCP_PRIMARY_PUBKEY"):
            cfg.validate()

    def test_bad_pubkey_format_raises(self, monkeypatch):
        monkeypatch.setenv("SYNOD_MCP_PRIMARY_PUBKEY", "not-hex")
        monkeypatch.setenv("SYNOD_MCP_REGISTRY_RPC", "http://x")
        monkeypatch.setenv("SYNOD_MCP_REGISTRY_ADDR", "0xabc")
        cfg = sidecar.SidecarConfig.from_env()
        with pytest.raises(RuntimeError, match="64-character hex"):
            cfg.validate()

    def test_valid_config_passes(self, monkeypatch):
        monkeypatch.setenv("SYNOD_MCP_PRIMARY_PUBKEY", "f" * 64)
        monkeypatch.setenv("SYNOD_MCP_REGISTRY_RPC", "http://x")
        monkeypatch.setenv("SYNOD_MCP_REGISTRY_ADDR", "0xabc")
        cfg = sidecar.SidecarConfig.from_env()
        cfg.validate()  # must not raise


# ── tool_error_result envelope shape ───────────────────────────────────


class TestEnvelopes:
    def test_jsonrpc_result_shape(self):
        out = sidecar.jsonrpc_result(42, {"x": 1})
        assert out == {"jsonrpc": "2.0", "id": 42, "result": {"x": 1}}

    def test_jsonrpc_error_shape(self):
        out = sidecar.jsonrpc_error(42, -32602, "bad")
        assert out["error"] == {"code": -32602, "message": "bad"}
        assert out["id"] == 42

    def test_tool_error_result_shape(self):
        out = sidecar.tool_error_result(7, "boom")
        assert out["result"]["isError"] is True
        assert out["result"]["content"][0]["text"] == "boom"

    def test_redact_strips_apikey_pattern(self):
        s = "Authorization: Bearer abc123 sk-projABCDEFGHIJKLMNOPQRSTUV"
        out = sidecar._redact(s)
        assert "[REDACTED" in out
        assert "sk-projABCDEFGHIJKLMNOPQRSTUV" not in out

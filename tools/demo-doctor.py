#!/usr/bin/env python3
"""Preflight checks for the Synod judge demo.

The script is intentionally conservative: it checks the things that commonly
break a live demo, but it never prints secret values from settler/.env.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SETTLER_DIR = ROOT / "settler"
ENV_PATH = SETTLER_DIR / ".env"

PROVIDER_KEYS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GOOGLE_API_KEY",
}


@dataclass
class Finding:
    level: str
    name: str
    detail: str


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        values[key.strip()] = value
    return values


def env_value(key: str, file_env: dict[str, str], default: str = "") -> str:
    return os.environ.get(key) or file_env.get(key) or default


def add(findings: list[Finding], level: str, name: str, detail: str) -> None:
    findings.append(Finding(level=level, name=name, detail=detail))


def known_foundry_paths() -> list[str]:
    home = Path.home()
    paths = [
        home / ".foundry" / "bin",
        Path("/c/Users/HP/.foundry/bin"),
        Path("/mnt/c/Users/HP/.foundry/bin"),
    ]
    return [str(p) for p in paths if p.exists()]


def which_tool(name: str) -> str | None:
    search_path = os.environ.get("PATH", "")
    extra = os.pathsep.join(known_foundry_paths())
    if extra:
        search_path = search_path + os.pathsep + extra
    for candidate in (name, f"{name}.exe"):
        resolved = shutil.which(candidate, path=search_path)
        if resolved:
            return resolved
    return None


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def run_check(cmd: list[str], cwd: Path, timeout: int = 30) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )
    except Exception as exc:
        return False, str(exc)
    return proc.returncode == 0, proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""


def provider_plan(demo: str, file_env: dict[str, str]) -> list[tuple[str, str, str]]:
    if demo == "2node":
        provider = env_value("SYNOD_PROVIDER", file_env, "anthropic").lower()
        model = env_value("SYNOD_MODEL", file_env, "claude-sonnet-4-6")
        return [("A", provider, model), ("B", provider, model)]
    return [
        (
            "A",
            env_value("SYNOD_DEMO_A_PROVIDER", file_env, "anthropic").lower(),
            env_value("SYNOD_DEMO_A_MODEL", file_env, "claude-sonnet-4-6"),
        ),
        (
            "B",
            env_value("SYNOD_DEMO_B_PROVIDER", file_env, "openai").lower(),
            env_value("SYNOD_DEMO_B_MODEL", file_env, "gpt-4o"),
        ),
        (
            "C",
            env_value("SYNOD_DEMO_C_PROVIDER", file_env, "gemini").lower(),
            env_value("SYNOD_DEMO_C_MODEL", file_env, "gemini-2.0-flash"),
        ),
    ]


def check_repo(findings: list[Finding]) -> None:
    required = [
        "README.md",
        "contracts/src/SynodRegistry.sol",
        "settler/synod_settler/agent.py",
        "tools/demo-up.sh",
        "tools/demo-up-3node.sh",
        "ui/package.json",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        add(findings, "fail", "repo layout", f"missing: {', '.join(missing)}")
    else:
        add(findings, "ok", "repo layout", "Synod files found")


def check_python(findings: list[Finding]) -> Path | None:
    add(
        findings,
        "ok" if sys.version_info >= (3, 11) else "fail",
        "python",
        f"{platform.python_version()} on {platform.system()}",
    )
    candidates = [
        SETTLER_DIR / ".venv" / "Scripts" / "python.exe",
        SETTLER_DIR / ".venv" / "bin" / "python",
    ]
    py = next((p for p in candidates if p.exists()), None)
    if not py:
        add(findings, "fail", "settler venv", "missing settler/.venv Python")
        return None
    ok, detail = run_check(
        [str(py), "-c", "import synod_settler, cryptography, web3; print('imports ok')"],
        SETTLER_DIR,
    )
    add(findings, "ok" if ok else "fail", "settler imports", detail or "import check failed")
    return py


def check_tools(findings: list[Finding]) -> None:
    for name in ("bash", "forge", "cast", "anvil", "node", "npm", "curl"):
        resolved = which_tool(name)
        if not resolved and name == "curl":
            resolved = which_tool("curl.exe")
        add(findings, "ok" if resolved else "fail", name, resolved or "not found on PATH")

    axl = ROOT / "axl" / ("axl-node.exe" if os.name == "nt" else "axl-node")
    fallback = ROOT / "axl" / ("axl-node" if os.name == "nt" else "axl-node.exe")
    if axl.exists():
        add(findings, "ok", "AXL binary", str(axl.relative_to(ROOT)))
    elif fallback.exists():
        add(findings, "ok", "AXL binary", str(fallback.relative_to(ROOT)))
    else:
        add(findings, "fail", "AXL binary", "build Gensyn AXL into axl/axl-node(.exe)")


def check_files(findings: list[Finding], demo: str) -> None:
    nodes = ["node-a", "node-b"] if demo == "2node" else ["node-a", "node-b", "node-c"]
    for node in nodes:
        cfg = ROOT / "configs" / "local" / f"{node}.json"
        key = ROOT / "keys" / f"{node}.pem"
        add(findings, "ok" if cfg.exists() else "fail", f"{node} config", str(cfg.relative_to(ROOT)))
        add(findings, "ok" if key.exists() else "fail", f"{node} key", str(key.relative_to(ROOT)))

    ui_lock = ROOT / "ui" / "package-lock.json"
    ui_modules = ROOT / "ui" / "node_modules"
    add(findings, "ok" if ui_lock.exists() else "fail", "UI lockfile", "ui/package-lock.json")
    add(findings, "ok" if ui_modules.exists() else "warn", "UI dependencies", "ui/node_modules")

    forge_std = ROOT / "contracts" / "lib" / "forge-std"
    add(findings, "ok" if forge_std.exists() else "warn", "Foundry deps", "contracts/lib/forge-std")


def check_env(findings: list[Finding], demo: str, file_env: dict[str, str]) -> None:
    add(
        findings,
        "ok" if ENV_PATH.exists() else "fail",
        "settler env",
        "settler/.env present" if ENV_PATH.exists() else "copy settler/.env.example to settler/.env",
    )

    plan = provider_plan(demo, file_env)
    providers = [provider for _, provider, _ in plan]
    for label, provider, model in plan:
        key_name = PROVIDER_KEYS.get(provider)
        if not key_name:
            add(findings, "fail", f"provider {label}", f"unknown provider '{provider}'")
            continue
        has_key = bool(env_value(key_name, file_env))
        add(
            findings,
            "ok" if has_key else "fail",
            f"provider {label}",
            f"{provider} / {model}; {key_name} {'present' if has_key else 'missing'}",
        )

    if demo == "3node" and len(set(providers)) < 3:
        add(
            findings,
            "warn",
            "provider diversity",
            "judge demo is strongest with Anthropic + OpenAI + Gemini all distinct",
        )

    quorum_raw = env_value("SYNOD_DEMO_QUORUM", file_env, "2")
    try:
        quorum = int(quorum_raw)
        max_nodes = 2 if demo == "2node" else 3
        if 1 <= quorum <= max_nodes:
            level = "ok"
            detail = f"{quorum} of {max_nodes}"
            if demo == "3node" and quorum == 3:
                level = "warn"
                detail += "; unanimity is impressive but fragile for live demos"
        else:
            level = "fail"
            detail = f"{quorum_raw}; must be between 1 and {max_nodes}"
    except ValueError:
        level = "fail"
        detail = f"{quorum_raw}; must be an integer"
    add(findings, level, "quorum", detail)


def check_ports(findings: list[Finding], demo: str) -> None:
    ports = [3000, 8545, 9002, 9012]
    if demo == "3node":
        ports.append(9022)
    for port in ports:
        if port_is_open(port):
            add(
                findings,
                "warn",
                f"port {port}",
                "already listening; stop stale demo services before launch",
            )
        else:
            add(findings, "ok", f"port {port}", "free")


def run_optional_tests(findings: list[Finding]) -> None:
    py = SETTLER_DIR / ".venv" / "Scripts" / "python.exe"
    if not py.exists():
        py = SETTLER_DIR / ".venv" / "bin" / "python"
    if py.exists():
        ok, detail = run_check([str(py), "-m", "pytest", "tests", "-q"], SETTLER_DIR, timeout=120)
        add(findings, "ok" if ok else "fail", "pytest", detail or "pytest failed")

    forge = which_tool("forge")
    if forge:
        ok, detail = run_check([forge, "test"], ROOT / "contracts", timeout=120)
        add(findings, "ok" if ok else "fail", "forge test", detail or "forge test failed")

    npm = which_tool("npm")
    if npm:
        ok, detail = run_check([npm, "run", "build"], ROOT / "ui", timeout=180)
        add(findings, "ok" if ok else "fail", "UI build", detail or "npm run build failed")


def print_report(findings: list[Finding]) -> None:
    width = max(len(f.name) for f in findings) if findings else 0
    print("Synod demo doctor")
    print(f"repo: {ROOT}")
    print()
    for f in findings:
        tag = {"ok": "OK", "warn": "WARN", "fail": "FAIL"}[f.level]
        print(f"[{tag:<4}] {f.name:<{width}}  {f.detail}")
    print()
    fails = sum(1 for f in findings if f.level == "fail")
    warns = sum(1 for f in findings if f.level == "warn")
    print(f"summary: {fails} fail, {warns} warn")


def main() -> int:
    parser = argparse.ArgumentParser(description="Preflight Synod demo dependencies and env.")
    parser.add_argument("--demo", choices=("2node", "3node"), default="3node")
    parser.add_argument("--with-tests", action="store_true", help="also run pytest, forge test, and UI build")
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = parser.parse_args()

    file_env = parse_env(ENV_PATH)
    findings: list[Finding] = []
    check_repo(findings)
    check_python(findings)
    check_tools(findings)
    check_files(findings, args.demo)
    check_env(findings, args.demo, file_env)
    check_ports(findings, args.demo)
    if args.with_tests:
        run_optional_tests(findings)

    print_report(findings)
    fail_count = sum(1 for f in findings if f.level == "fail")
    warn_count = sum(1 for f in findings if f.level == "warn")
    if fail_count:
        return 1
    if args.strict and warn_count:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

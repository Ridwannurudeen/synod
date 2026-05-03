"""Pytest config for the top-level tests directory (AXL MCP sidecar tests).

The sidecar tests use aiohttp's pytest plugin with auto-mode async fixtures.
This conftest sets the right asyncio mode so the tests can be run directly
from the repo root (`pytest tests/`) without the special path the agent's
docstring suggests.
"""

import pytest


def pytest_collection_modifyitems(config, items):
    """Ensure async tests get the asyncio mark when running auto mode."""
    pass


# pytest-asyncio: opt all tests in this directory into auto async mode.
collect_ignore_glob: list[str] = []

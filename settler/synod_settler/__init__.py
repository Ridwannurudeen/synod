"""Synod settler agent — Day 2 scaffold.

This package provides the runtime for a single Synod settler node. A settler
takes a market resolution prompt, runs LLM inference, signs the answer with its
AXL ed25519 identity key, broadcasts the signed vote to peer settlers over the
AXL P2P mesh, collects peer votes, and computes a quorum-signed consensus.
"""

__version__ = "0.1.0"

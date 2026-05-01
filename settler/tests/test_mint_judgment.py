import pytest

from tools.mint_judgment import transcript_indexer_url


def test_transcript_indexer_url_requires_http_scheme():
    root = "0x" + "a" * 64
    with pytest.raises(ValueError, match="http"):
        transcript_indexer_url("file:///tmp/transcript.json", root)


def test_transcript_indexer_url_rejects_non_hex_root():
    with pytest.raises(ValueError, match="hex"):
        transcript_indexer_url("https://indexer-storage-testnet-turbo.0g.ai", "0xnot-hex")


def test_transcript_indexer_url_builds_safe_query():
    root = "0x" + "a" * 64
    url = transcript_indexer_url("https://indexer-storage-testnet-turbo.0g.ai/", root)
    assert url == f"https://indexer-storage-testnet-turbo.0g.ai/file?root={root}"

"""Build a URL fragment for the longlong-copy Mini App.

The message belongs in the fragment (#...), never the query string.
Browsers do not send fragments to the server, so GitHub Pages never receives the text.

  #t=  percent-encoded UTF-8
  #b=  base64url of the UTF-8 bytes, without padding
  #z=  base64url of raw DEFLATE (RFC 1951) of those bytes

#z= is the format DecompressionStream('deflate-raw') accepts.
zlib produces it with wbits=-15.
"""

from __future__ import annotations

import base64
import urllib.parse
import zlib

PAGE_URL = "https://veronicamom.github.io/longlong-copy/"
# Whole URL size that both iOS and Android Telegram clients reliably open.
SAFE_URL_LENGTH = 2000


def fragment_budget(safe_url_length: int = SAFE_URL_LENGTH) -> int:
    """Characters left after ``PAGE_URL + '#'``."""
    return safe_url_length - len(PAGE_URL) - 1


DEFAULT_FRAGMENT_BUDGET = fragment_budget()


def encode_t(text: str) -> str:
    """Percent-encode like encodeURIComponent.

    ``quote(safe='')`` also encodes ``!*'()``, which the page's
    ``decodeURIComponent`` turns back into the original characters.
    """
    return "t=" + urllib.parse.quote(text, safe="")


def encode_b(text: str) -> str:
    token = base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")
    return "b=" + token


def encode_z(text: str) -> str:
    compressor = zlib.compressobj(level=9, wbits=-15)
    compressed = compressor.compress(text.encode("utf-8")) + compressor.flush()
    token = base64.urlsafe_b64encode(compressed).decode("ascii").rstrip("=")
    return "z=" + token


def encode_fragment(text: str, budget: int = DEFAULT_FRAGMENT_BUDGET) -> str:
    """Return the fragment without a leading '#'.

    Use ``#t=`` when it fits, then ``#b=``, then ``#z=``.
    If none of them fit, return the shortest one. Callers should still
    skip the button when ``len(PAGE_URL) + 1 + len(fragment)`` is above
    ``SAFE_URL_LENGTH``.
    """
    plain = encode_t(text)
    if len(plain) <= budget:
        return plain
    compact = encode_b(text)
    if len(compact) <= budget:
        return compact
    compressed = encode_z(text)
    if len(compressed) <= budget:
        return compressed
    return min((plain, compact, compressed), key=len)


def page_url(text: str, budget: int = DEFAULT_FRAGMENT_BUDGET) -> str:
    return PAGE_URL + "#" + encode_fragment(text, budget=budget)

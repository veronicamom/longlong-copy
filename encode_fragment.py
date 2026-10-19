"""Build a URL fragment for the longlong-copy Mini App.

The message belongs in the fragment (#...), never the query string.
Browsers do not send fragments to the server, so GitHub Pages never receives the text.

  #t=  percent-encoded UTF-8
  #b=  base64url of the UTF-8 bytes, without padding
  #z=  base64url of raw DEFLATE (RFC 1951) of those bytes
  #j=  base64url of a v2 JSON view, raw or raw-DEFLATE, whichever is shorter

#z= and compressed #j= match DecompressionStream('deflate-raw').
zlib produces that format with wbits=-15.
"""

from __future__ import annotations

import base64
import json
import urllib.parse
import zlib

PAGE_URL = "https://veronicamom.github.io/longlong-copy/"
# Whole URL size that both iOS and Android Telegram clients reliably open.
SAFE_URL_LENGTH = 2000


def fragment_budget(safe_url_length: int = SAFE_URL_LENGTH) -> int:
    """Characters left after ``PAGE_URL + '#'``."""
    return safe_url_length - len(PAGE_URL) - 1


DEFAULT_FRAGMENT_BUDGET = fragment_budget()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _deflate(raw: bytes) -> bytes:
    compressor = zlib.compressobj(level=9, wbits=-15)
    return compressor.compress(raw) + compressor.flush()


def encode_t(text: str) -> str:
    """Percent-encode like encodeURIComponent.

    ``quote(safe='')`` also encodes ``!*'()``, which the page's
    ``decodeURIComponent`` turns back into the original characters.
    """
    return "t=" + urllib.parse.quote(text, safe="")


def encode_b(text: str) -> str:
    return "b=" + _b64(text.encode("utf-8"))


def encode_z(text: str) -> str:
    return "z=" + _b64(_deflate(text.encode("utf-8")))


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


def _http_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return urllib.parse.urlunsplit(parsed)


def _coord(value: object, low: float, high: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number < low or number > high:
        return None
    return number


def normalize_payload(payload: dict) -> dict:
    """Drop empty fields and anything that is not http(s) or a real coordinate."""
    if not isinstance(payload, dict):
        raise TypeError("payload must be a dict")
    out: dict = {"v": 2}
    title = payload.get("title")
    if isinstance(title, str) and title.strip():
        out["title"] = title.strip()
    text = payload.get("text")
    if isinstance(text, str) and text:
        out["text"] = text
    links = []
    for item in payload.get("links") or []:
        if not isinstance(item, dict):
            continue
        url = _http_url(item.get("url"))
        if not url:
            continue
        link = {"url": url}
        label = item.get("title")
        if isinstance(label, str) and label.strip():
            link["title"] = label.strip()
        links.append(link)
    if links:
        out["links"] = links
    places = []
    for item in payload.get("places") or []:
        if not isinstance(item, dict):
            continue
        place: dict = {}
        name = item.get("name")
        address = item.get("address")
        if isinstance(name, str) and name.strip():
            place["name"] = name.strip()
        if isinstance(address, str) and address.strip():
            place["address"] = address.strip()
        lat = _coord(item.get("lat"), -90, 90)
        lng = _coord(item.get("lng"), -180, 180)
        if lat is not None and lng is not None:
            place["lat"] = lat
            place["lng"] = lng
        map_url = _http_url(item.get("map_url"))
        if map_url:
            place["map_url"] = map_url
        if place:
            places.append(place)
    if places:
        out["places"] = places
    if "text" not in out and "links" not in out and "places" not in out and "title" not in out:
        raise ValueError("payload needs a title, text, links, or places")
    return out


def encode_structured(payload: dict, max_url_length: int = SAFE_URL_LENGTH) -> dict | None:
    """Pack a v2 view into ``#j=``.

    The JSON is UTF-8 with no extra whitespace. The fragment is base64url of
    those bytes, or of their raw DEFLATE, whichever is shorter. Both start
    with ``j=``. Returns ``{"fragment", "url", "length"}`` or ``None`` when
    every form would make the full URL longer than ``max_url_length``.
    ``None`` means the relay should send a file instead of a button.
    """
    body = normalize_payload(payload)
    raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    blobs = [raw, _deflate(raw)]
    best: dict | None = None
    for blob in blobs:
        fragment = "j=" + _b64(blob)
        url = PAGE_URL + "#" + fragment
        if best is None or len(url) < best["length"]:
            best = {"fragment": fragment, "url": url, "length": len(url)}
    if best is None or best["length"] > max_url_length:
        return None
    return best

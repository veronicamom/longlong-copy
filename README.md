# longlong-copy

A one-page Telegram Mini App. The bot 롱롱이 sends a message with an inline button; tapping it opens this page. On a phone, Telegram chat bubbles only copy the whole message. Here the reader can long-press and drag to copy just the part they want.

Plain text still opens in a large text box. A v2 payload, or plain text that already has links or section headings, also opens as cards: a tappable link list, a place card, and sectioned writing. The message stays in the URL fragment. The page is static. There is no build step, no backend, and no analytics.

The page always loads `https://telegram.org/js/telegram-web-app.js`. A place that includes latitude and longitude also embeds one OpenStreetMap iframe. That embed does not use an API key. Nothing else is requested, and the message is never sent anywhere.

## Enable GitHub Pages

1. Open the repository on GitHub and go to **Settings > Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch **main** and folder **/ (root)**.
4. Save.

GitHub publishes the site at:

https://veronicamom.github.io/longlong-copy/

`.nojekyll` is in the repo root so Pages serves the files as they are and does not run Jekyll.

## Bot button

In a private chat, `web_app` inline buttons open the page inside Telegram:

```json
{"text":"✂️ 일부 복사","web_app":{"url":"https://veronicamom.github.io/longlong-copy/#b=..."}}
```

Replace the fragment with one from `encode_fragment()` or `encode_structured()` below. The hash is the whole message; do not also put the text in the query string.

### Groups

Inline `web_app` buttons are only available in private chats between a user and the bot (Bot API: not supported in groups, and not for messages sent on behalf of a business account). In a group, send a plain `url` button with the same link:

```json
{"text":"✂️ 일부 복사","url":"https://veronicamom.github.io/longlong-copy/#b=..."}
```

Copying still works in the browser that opens. **닫기** calls `Telegram.WebApp.close()`, which dismisses the Mini App. In a normal browser that call may do nothing.

## Encoding

The message arrives in the URL fragment (`#...`), never the query string. A fragment is not included in the HTTP request, so GitHub Pages never receives the text. The page does not write `localStorage` or `sessionStorage`, does not log the message, and does not send it anywhere. It reads the fragment into memory, then removes `t`, `b`, `z`, and `j` from the address bar before `telegram-web-app.js` runs, so that script's `sessionStorage` copy of the hash does not keep the message. Refreshing after that shows the empty state; the button in the chat still has the original link.

| Fragment | What it is |
| --- | --- |
| `#t=` + percent-encoded UTF-8 | Same idea as `encodeURIComponent`. Best for short text. |
| `#b=` + base64url of the UTF-8 bytes | Smaller for Korean. No `=` padding. `-` and `_` instead of `+` and `/`. |
| `#z=` + base64url of raw DEFLATE | Smallest when the message repeats itself. Raw DEFLATE is RFC 1951, which is Python `zlib` with `wbits=-15`. The page inflates it with `DecompressionStream('deflate-raw')` when the browser has it. If it does not, the page says so and leaves the box empty instead of showing garbage. |
| `#j=` + base64url of v2 JSON | A structured view. The JSON is UTF-8 with no extra whitespace. The fragment is base64url of those bytes, or of their raw DEFLATE (`wbits=-15`), whichever is shorter. Both use the `j=` prefix. If the first byte is `{`, the page parses it directly. Otherwise it inflates, then parses. A short payload is often shorter raw, so a phone without `DecompressionStream` can still open it. A compressed payload on that phone shows the same unsupported message as `#z=`. |

Telegram may append its own `tgWebAppData`, `tgWebAppVersion`, `tgWebAppPlatform`, and `tgWebAppThemeParams` keys to the same hash. The page ignores those and reads only `t`, `b`, `z`, or `j`.

`#t=`, `#b=`, and `#z=` are still plain text. The decoded string is unchanged, **전체 복사** still copies that string, and a message with no links and no section headings is still only the text box.

### v2 JSON

`encode_structured()` accepts a dict and writes `#j=`. Empty fields are dropped. Links and `map_url` must be `http` or `https`. `lat` and `lng` are kept only as a pair, inside the real ranges. A payload that is not a dict, or that has none of `title`, `text`, `links`, or `places`, raises `TypeError` or `ValueError`.

```json
{
  "v": 2,
  "title": "만나는 곳",
  "text": "성수역 3번 출구에서 도보 5분.",
  "links": [{"url": "https://example.com/guide", "title": "안내문"}],
  "places": [{
    "name": "성수 카페",
    "address": "서울 성동구 연무장길 12",
    "lat": 37.544577,
    "lng": 127.055961,
    "map_url": "https://map.kakao.com/link/map/성수카페,37.544577,127.055961"
  }]
}
```

| Field | Role |
| --- | --- |
| `v` | Always `2` after normalization. Older plain fragments do not use this object. |
| `title` | Replaces the page heading **복사하기**. Omitted when blank. |
| `text` | The message. Headings and URLs inside it are picked up even when `links` is omitted. **전체 복사** copies this string, including the heading markers. |
| `links` | Optional `{url, title}` list. `title` is the label; without it the label is the domain, without a leading `www.`. URLs already present in `text` are added too. A place `map_url` is not repeated in this list. |
| `places` | Optional cards. `name` and `address` are text. `lat` and `lng` together add a small OpenStreetMap embed, with no API key. `map_url` is the **지도 열기** target, for example a Kakao map link. With no coordinates there is no embed. |

The page also builds this view from plain `#t=`, `#b=`, and `#z=` text. URLs in that text become the link list. Lines that start a section become headings. Places are never guessed from prose; they have to be in the JSON.

Section headings are a whole line that starts with `#` (with or without a space), `■`, a bracketed title such as `[준비물]`, or a short numbered title such as `1. 일정` (the words after the number are at most 60 characters, so a long numbered sentence stays a paragraph). Bullets are lines that start with `-`, `*`, `•`, `·`, or `・`. Each section has its own **복사** button. That button copies the heading and the section body. Drag-select still works on the paragraphs, the bullets, and the address.

In Telegram, **열기** and **지도 열기** call `Telegram.WebApp.openLink` when it exists. Otherwise the link opens in a new tab.

### Practical URL length

The Bot API does not document a maximum length for `web_app.url`. The limit that matters is the Telegram client, because the WebView still has to receive the whole URL, fragment included.

Keep the **entire URL under 2000 characters**. That size opens reliably on both iOS and Android. Past roughly 4000 characters, some iOS WebViews truncate the link or refuse to open it. A cut-off fragment does not decode, and the page will show an error instead of half a message.

`https://veronicamom.github.io/longlong-copy/#` is 45 characters, so inside a 2000-character URL the fragment can be **1955 characters**, including the `t=`, `b=`, `z=`, or `j=` prefix.

Roughly how much text fits in that budget:

| Form | Capacity |
| --- | --- |
| `#t=` | About 210 Korean syllables, or about 1950 ASCII characters. Each Korean syllable becomes 9 characters once percent-encoded (`안` → `%EC%95%88`). |
| `#b=` | About 480 Korean syllables (3 UTF-8 bytes → 4 base64 characters), or about 1460 ASCII characters. |
| `#z=` | Depends on repetition. A message that repeats the same lines can be several times longer than `#b=` allows. Korean that does not repeat often shrinks only a little, and very short text can grow because of DEFLATE overhead. |
| `#j=` text only | **668** varied Hangul syllables. A shuffled syllable list of that length encodes to a 1999-character URL. Plan on about **660** Korean characters so a title or a last sentence still fits. The same paragraph repeated many times compresses much smaller and can be longer. |
| `#j=` with a card | **537** varied Hangul syllables once the payload also has a short title, one place (name, address, coordinates, Kakao map link), and three titled links. Plan on about **530**. |

`encode_fragment()` tries `#t=`, then `#b=`, then `#z=`, and keeps the first one that fits. If none fit, it returns the shortest form anyway. Check the length before sending the button.

`encode_structured()` picks the shorter of raw JSON and raw DEFLATE, then returns `{"fragment", "url", "length"}`. If every form would make the full URL longer than 2000 characters, it returns `None`. `None` means the relay should send a file instead of a button. Do not send a button when the result is `None`.

A Telegram message can be 4096 characters, which is larger than this URL budget. This page is for the part the reader needs to copy, not for every message the bot sends.

### Examples

These open the live page once this version is published. The same fragment works against a local `index.html`.

Link list, titled 안내문 and 메뉴 (263 characters):

```text
https://veronicamom.github.io/longlong-copy/#j=q1YqU7Iy0lEqySzJSVWyUnozY8nrrhkKrzfvUXi9vPFt4xoloFxqRQlIamrH66Ytr9fseAWSXDnldeeW10v3KLydOfXN3B1vp25ReLN4z5uWHW9mTdGLycsoKSkottLXT61IzC3ISdVLzs_VTy_NTEnFLpWbmlcKtCknMy-7WMkqulqptCgHaCVOU5SQXAxzllKtDj59UCtg2iAeUKqNrQUA
```

Place card for 성수 카페, with an address, a Kakao map button, and an OpenStreetMap embed (353 characters):

```text
https://veronicamom.github.io/longlong-copy/#j=RY_BSsNAEIZfZZlz2Ji0a3BfRUSWdtGSTRqaVYTSi-RQRKwHIVGCN_FSQU1a4itlx3dwLGKP880_38zM4RJk6IGdWKNBgnu9ddeVu3lgfdMAcX1lCWPxgcsKyzc2cJ9Lhtu636yxvMeiZm5VuKZlwm0LThOZUSOdgzyeQ6oS_T_M8Kv9vqsoocbjmc7zXafGp45RwK0eyciwfHfrFp9f-q5jQUhho2j_IOJiOBRRRHV6BjIII34gxNFh4EGistOLmSHbubVZLn2fCI9VrKZ8NE18M0njX-T__bC7wtsb9y5YnCx-AA
```

Sectioned note with `#`, `■`, `[준비물]`, and `1. 일정` (306 characters):

```text
https://veronicamom.github.io/longlong-copy/#j=JY2_asJQFMZf5XC7Vml081WMY4ZCyRRKQYQgdwgqkiFpLiXChYpZFKJEiZCnccz58g6etOP3-_7N1aeajF5V8B58eGqi8NtwERPSiJeVEu59BYJfqC1DXiXU1rXrowi71OBiadSZGtoS9BmRQXaiMV8iwi1vr8eh67v-41vcdd6WWnpmD6vJeROALCYuNrw0-En-klPsQ75rPjYz1x9IyfJN47DrhcA-4gwJuwY2la171W3lMYbO-z8u8y6t_rfU4gk
```

Plain text, `안녕하세요`:

```text
https://veronicamom.github.io/longlong-copy/#t=%EC%95%88%EB%85%95%ED%95%98%EC%84%B8%EC%9A%94
```

### Python

`encode_fragment.py` is what the relay should import.

```python
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
```

Wire a plain message like this:

```python
from encode_fragment import PAGE_URL, SAFE_URL_LENGTH, encode_fragment

text = "안녕하세요\n이 줄만 복사하세요 ✨"
fragment = encode_fragment(text)
url = PAGE_URL + "#" + fragment
if len(url) > SAFE_URL_LENGTH:
    raise SystemExit("message is too long for a reliable button URL")

button = {"text": "✂️ 일부 복사", "web_app": {"url": url}}
# In a group, use {"text": "✂️ 일부 복사", "url": url} instead.
```

Wire a view like this. `None` means the URL is over 2000 characters and the relay should send a file:

```python
from encode_fragment import encode_structured

packed = encode_structured({
    "title": "만나는 곳",
    "text": "성수역 3번 출구에서 도보 5분.",
    "places": [{
        "name": "성수 카페",
        "address": "서울 성동구 연무장길 12",
        "lat": 37.544577,
        "lng": 127.055961,
        "map_url": "https://map.kakao.com/link/map/성수카페,37.544577,127.055961",
    }],
})
if packed is None:
    raise SystemExit("send a file instead of a button")
button = {"text": "✂️ 일부 복사", "web_app": {"url": packed["url"]}}
```

`urllib.parse.quote(text, safe="")` matches `encodeURIComponent` for Korean, emoji, and newlines. It also percent-encodes `!*'()`, and the page decodes those back to the same characters. Do not build the fragment with `urlencode` or `quote_plus`: those turn spaces into `+`.

## What the page does

- The title is **복사하기**, unless the payload has a title. The text box is read-only but selectable, uses an 18px font, keeps line breaks, and grows with the message until the buttons would leave the screen. After that it scrolls inside the box.
- Links render as a **링크** list. Each row has the title or domain, **열기**, and **복사**.
- A place renders as a **장소** card: name, selectable address, **지도 열기** when `map_url` is set, and **주소 복사**. Coordinates add a 180px map embed from `https://www.openstreetmap.org/export/embed.html` with a marker and no API key. Without coordinates there is no iframe.
- Sectioned text hides the big box and shows each section with its own **복사** button. The box keeps the original text so **전체 복사** still copies the whole message, heading markers included. The hint becomes **글을 길게 눌러 원하는 부분만 선택할 수 있어요.**
- **전체 복사** copies the whole message with `navigator.clipboard.writeText`, and falls back to `document.execCommand('copy')`. On success it shows **복사됐어요**. The same pair is used for the smaller copy buttons. A hidden text box is copied through an off-screen field, because a hidden field cannot take the selection.
- **닫기** calls `Telegram.WebApp.close()`.
- On open the page calls `Telegram.WebApp.ready()` and `Telegram.WebApp.expand()`, and follows Telegram `themeParams` and the `--tg-theme-*` CSS variables. Opened outside Telegram, it follows the device light or dark theme. `disableVerticalSwipes` runs only on WebApp 7.7 or newer, and the header and background color calls only on 6.1 or newer.
- If the fragment has no message, the page shows a short explanation instead of an empty box.
- Opening it in a normal browser works, which is how the checks below run. `file://` is not a secure context, so use a local HTTP server if you want `navigator.clipboard` rather than the fallback.

## Check the decoder

From the repo root:

```bash
node test/roundtrip.mjs
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/test.html`.

`test/roundtrip.mjs` encodes Korean, emoji (including a family sequence), multi-line text, and a long message with `encode_fragment.py`, and decodes them with the functions in `index.html`. It covers `#t=`, `#b=`, `#z=`, and `#j=`, a structured payload with Korean, emoji, a titled link, and a place, Telegram's extra hash keys, a browser with no `DecompressionStream` (raw `#j=` still opens, compressed `#j=` does not), and the 2000-character budget including `encode_structured()` returning `None`. `test.html` loads the real page and checks the same round-trip in the browser, including the link, place, and section cards, and that the message does not land in `localStorage` or `sessionStorage`.

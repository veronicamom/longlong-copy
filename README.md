# longlong-copy

A one-page Telegram Mini App. The bot 롱롱이 sends a message with an inline button; tapping it opens this page and puts that message in a large text box. On a phone, Telegram chat bubbles only copy the whole message. Here the reader can long-press and drag to copy just the part they want.

The page is static. There is no build step, no backend, and no analytics. The only request it makes is Telegram's script, `https://telegram.org/js/telegram-web-app.js`.

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

Replace `#b=...` with a fragment from `encode_fragment()` below. The hash is the whole message; do not also put the text in the query string.

### Groups

Inline `web_app` buttons are only available in private chats between a user and the bot (Bot API: not supported in groups, and not for messages sent on behalf of a business account). In a group, send a plain `url` button with the same link:

```json
{"text":"✂️ 일부 복사","url":"https://veronicamom.github.io/longlong-copy/#b=..."}
```

Copying still works in the browser that opens. **닫기** calls `Telegram.WebApp.close()`, which dismisses the Mini App. In a normal browser that call may do nothing.

## Encoding

The message arrives in the URL fragment (`#...`), never the query string. A fragment is not included in the HTTP request, so GitHub Pages never receives the text. The page does not write `localStorage` or `sessionStorage`, does not log the message, and does not send it anywhere. It reads the fragment into memory, then removes `t`, `b`, and `z` from the address bar before `telegram-web-app.js` runs, so that script's `sessionStorage` copy of the hash does not keep the message. Refreshing after that shows the empty state; the button in the chat still has the original link.

| Fragment | What it is |
| --- | --- |
| `#t=` + percent-encoded UTF-8 | Same idea as `encodeURIComponent`. Best for short text. |
| `#b=` + base64url of the UTF-8 bytes | Smaller for Korean. No `=` padding. `-` and `_` instead of `+` and `/`. |
| `#z=` + base64url of raw DEFLATE | Smallest when the message repeats itself. Raw DEFLATE is RFC 1951, which is Python `zlib` with `wbits=-15`. The page inflates it with `DecompressionStream('deflate-raw')` when the browser has it. If it does not, the page says so and leaves the box empty instead of showing garbage. |

Telegram may append its own `tgWebAppData`, `tgWebAppVersion`, `tgWebAppPlatform`, and `tgWebAppThemeParams` keys to the same hash. The page ignores those and reads only `t`, `b`, or `z`.

### Practical URL length

The Bot API does not document a maximum length for `web_app.url`. The limit that matters is the Telegram client, because the WebView still has to receive the whole URL, fragment included.

Keep the **entire URL under 2000 characters**. That size opens reliably on both iOS and Android. Past roughly 4000 characters, some iOS WebViews truncate the link or refuse to open it. A cut-off fragment does not decode, and the page will show an error instead of half a message.

`https://veronicamom.github.io/longlong-copy/#` is 45 characters, so inside a 2000-character URL the fragment can be **1955 characters**, including the `t=`, `b=`, or `z=` prefix.

Roughly how much text fits in that budget:

| Form | Capacity |
| --- | --- |
| `#t=` | About 210 Korean syllables, or about 1950 ASCII characters. Each Korean syllable becomes 9 characters once percent-encoded (`안` → `%EC%95%88`). |
| `#b=` | About 480 Korean syllables (3 UTF-8 bytes → 4 base64 characters), or about 1460 ASCII characters. |
| `#z=` | Depends on repetition. A message that repeats the same lines can be several times longer than `#b=` allows. Korean that does not repeat often shrinks only a little, and very short text can grow because of DEFLATE overhead. |

`encode_fragment()` tries `#t=`, then `#b=`, then `#z=`, and keeps the first one that fits. If none fit, it returns the shortest form anyway. Check the length before sending the button. If it is still over 2000 characters, do not attach a link the phone will cut off; split the message or send it another way.

A Telegram message can be 4096 characters, which is larger than this URL budget. This page is for the part the reader needs to copy, not for every message the bot sends.

### Python

`encode_fragment.py` is what the relay should import.

```python
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
```

Wire it to the button like this:

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

`urllib.parse.quote(text, safe="")` matches `encodeURIComponent` for Korean, emoji, and newlines. It also percent-encodes `!*'()`, and the page decodes those back to the same characters. Do not build the fragment with `urlencode` or `quote_plus`: those turn spaces into `+`.

To try a link in a desktop browser:

```text
https://veronicamom.github.io/longlong-copy/#t=%EC%95%88%EB%85%95%ED%95%98%EC%84%B8%EC%9A%94
```

That fragment is `안녕하세요`.

## What the page does

- The title is **복사하기**. The text box is read-only but selectable, uses an 18px font, keeps line breaks, and grows with the message until the buttons would leave the screen. After that it scrolls inside the box.
- **전체 복사** copies the whole message with `navigator.clipboard.writeText`, and falls back to `document.execCommand('copy')`. On success it shows **복사됐어요**.
- **닫기** calls `Telegram.WebApp.close()`.
- On open the page calls `Telegram.WebApp.ready()` and `Telegram.WebApp.expand()`, and follows Telegram `themeParams` and the `--tg-theme-*` CSS variables. Opened outside Telegram, it follows the device light or dark theme.
- If the fragment has no message, the page shows a short explanation instead of an empty box.
- Opening it in a normal browser works, which is how the checks below run. `file://` is not a secure context, so use a local HTTP server if you want `navigator.clipboard` rather than the fallback.

## Check the decoder

From the repo root:

```bash
node test/roundtrip.mjs
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/test.html`.

`test/roundtrip.mjs` encodes Korean, emoji (including a family sequence), multi-line text, and a long message with `encode_fragment.py`, and decodes them with the functions in `index.html`. It covers `#t=`, `#b=`, and `#z=`, Telegram's extra hash keys, a browser with no `DecompressionStream`, and the 2000-character budget. `test.html` loads the real page and checks the same round-trip in the browser, including that the message does not land in `localStorage` or `sessionStorage`.

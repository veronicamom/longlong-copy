import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const encoder = fs.readFileSync(new URL('../encode_fragment.py', import.meta.url), 'utf8');

const scriptMatch = html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'index.html is missing its inline decoder script');

function loadApi({ decompression = true } = {}) {
  const history = { last: '', replaceState(_s, _t, url) { this.last = String(url); } };
  const sandbox = {
    console,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Blob,
    Response,
    Promise,
    atob: globalThis.atob,
    location: {
      href: 'https://veronicamom.github.io/longlong-copy/',
      pathname: '/longlong-copy/',
      search: '',
    },
    history,
    document: {
      documentElement: { dataset: {}, style: { setProperty() {}, colorScheme: '' } },
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      readyState: 'loading',
    },
    navigator: {},
    window: null,
  };
  if (decompression) sandbox.DecompressionStream = DecompressionStream;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext("'use strict';\n" + scriptMatch[1], sandbox, { filename: 'index.html' });
  assert.equal(typeof sandbox.LonglongCopy.decodeHash, 'function');
  return { api: sandbox.LonglongCopy, history, location: sandbox.location };
}

function py(code, stdin = '') {
  const res = spawnSync('python3', ['-c', code], {
    cwd: new URL('..', import.meta.url),
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (res.status !== 0) {
    throw new Error(res.stderr || `python exited ${res.status}`);
  }
  return res.stdout;
}

function pyEncode(text) {
  const stdout = py(
    [
      'import json, sys',
      'from encode_fragment import encode_t, encode_b, encode_z, encode_fragment, page_url, DEFAULT_FRAGMENT_BUDGET, PAGE_URL, SAFE_URL_LENGTH',
      'text = sys.stdin.read()',
      'frag = encode_fragment(text)',
      'json.dump({',
      '  "t": encode_t(text),',
      '  "b": encode_b(text),',
      '  "z": encode_z(text),',
      '  "chosen": frag,',
      '  "url": page_url(text),',
      '  "budget": DEFAULT_FRAGMENT_BUDGET,',
      '  "prefix": len(PAGE_URL) + 1,',
      '  "safe": SAFE_URL_LENGTH,',
      '}, sys.stdout)',
    ].join('\n'),
    text,
  );
  return JSON.parse(stdout);
}

async function decode(api, fragment) {
  return api.decodeHash(fragment.startsWith('#') ? fragment : `#${fragment}`);
}

const samples = [
  ['korean', '안녕하세요, 롱롱이입니다.'],
  ['emoji', '오늘 날씨 좋아요 🌤️✨'],
  ['zwj', '가족 👨‍👩‍👧 그리고 ✂️'],
  ['multiline', '첫째 줄\n둘째 줄\r\n\n넷째 줄\n'],
  ['special', "100% (롱롱이) *별* '따옴표' ! ~ ._-/&=#+ \n끝"],
  ['long', `${'가나다라마바사아자차카타파하'.repeat(80)}\n😊\n${'끝'.repeat(50)}`],
];

const { api, history, location } = loadApi();
let passed = 0;

for (const [name, text] of samples) {
  const encoded = pyEncode(text);
  for (const mode of ['t', 'b', 'z']) {
    const result = await decode(api, encoded[mode]);
    assert.equal(result.state, 'ready', `${name} ${mode} state`);
    assert.equal(result.text, text, `${name} ${mode} round-trip`);
    passed += 1;
  }

  const withTail = `#${encoded.b}&tgWebAppData=query_id%3DAA%26user%3D1&tgWebAppVersion=8.0&tgWebAppPlatform=ios`;
  const tail = await decode(api, withTail);
  assert.equal(tail.text, text, `${name} ignores trailing tgWebApp params`);
  assert.equal(tail.text.includes('tgWebApp'), false);

  const withHead = `#tgWebAppVersion=8.0&${encoded.b}&tgWebAppPlatform=android`;
  const head = await decode(api, withHead);
  assert.equal(head.text, text, `${name} ignores leading tgWebApp params`);
  passed += 2;
}

for (const empty of ['', '#', '#t=', '#b=', '#z=', '#tgWebAppVersion=8.0&tgWebAppPlatform=ios']) {
  const result = await decode(api, empty);
  assert.equal(result.state, 'empty', `empty ${empty}`);
  assert.equal(result.text, undefined);
  passed += 1;
}

const badB = await decode(api, '#b=!!!!');
assert.equal(badB.state, 'error');
assert.equal(badB.reason, 'format');
const badT = await decode(api, '#t=%EC%95');
assert.equal(badT.state, 'error');
assert.equal(badT.reason, 'format');
const badZ = await decode(api, '#z=aaaa');
assert.equal(badZ.state, 'error');
assert.equal(badZ.reason, 'format');
passed += 3;

const bare = loadApi({ decompression: false });
const unsupported = await decode(bare.api, pyEncode('안녕하세요').z);
assert.equal(unsupported.state, 'error');
assert.equal(unsupported.reason, 'unsupported');
const stillPlain = await decode(bare.api, pyEncode('안녕하세요 🌤️').t);
assert.equal(stillPlain.text, '안녕하세요 🌤️');
passed += 2;

const korean = '가'.repeat(400);
const koreanEnc = pyEncode(korean);
assert.ok(koreanEnc.t.length > koreanEnc.budget, 'percent-encoded Korean should exceed the budget');
assert.ok(koreanEnc.chosen.startsWith('b='), 'encoder should pick base64url for long Korean');
assert.equal((await decode(api, koreanEnc.chosen)).text, korean);

const repetitive = '안녕하세요'.repeat(500);
const repEnc = pyEncode(repetitive);
assert.ok(repEnc.b.length > repEnc.budget);
assert.ok(repEnc.chosen.startsWith('z='), 'encoder should pick deflate when repetition makes it fit');
assert.equal((await decode(api, repEnc.chosen)).text, repetitive);
assert.ok(repEnc.url.length <= repEnc.safe);
passed += 2;

const short = pyEncode('hi');
assert.ok(short.chosen.startsWith('t='));
assert.equal(short.prefix + short.budget, short.safe);

location.href = `https://veronicamom.github.io/longlong-copy/#${koreanEnc.b}&tgWebAppVersion=8.0`;
location.pathname = '/longlong-copy/';
location.search = '';
const stripped = api.takeFragmentFromLocation();
assert.equal(stripped, koreanEnc.b);
assert.equal(history.last, '/longlong-copy/#tgWebAppVersion=8.0');
assert.equal(history.last.includes(koreanEnc.b), false);
passed += 1;

const scriptOnly = scriptMatch[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(scriptOnly, /\b(localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|sendBeacon)\b/);
assert.doesNotMatch(scriptOnly, /\bconsole\.(log|debug|info|warn|error)\s*\(/);
assert.match(html, /https:\/\/telegram\.org\/js\/telegram-web-app\.js/);
assert.equal(fs.existsSync(new URL('../.nojekyll', import.meta.url)), true);

const fetchedUrls = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/g)].map((m) => m[1]);
assert.deepEqual(fetchedUrls, ['https://telegram.org/js/telegram-web-app.js']);

assert.match(readme, /https:\/\/veronicamom\.github\.io\/longlong-copy\//);
assert.match(readme, /\{"text":"✂️ 일부 복사","web_app":\{"url":"https:\/\/veronicamom\.github\.io\/longlong-copy\/#b=\.\.\."\}\}/);
assert.match(readme, /Settings → Pages|Settings > Pages/);
assert.match(readme, /wbits=-15/);
assert.match(readme, /2000/);
assert.ok(readme.includes(encoder.trim()), 'README should include the encoder source');

console.log(`ok ${passed} round-trips`);

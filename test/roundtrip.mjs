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
    URL,
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

function pyStructured(payload) {
  const stdout = py(
    [
      'import json, sys',
      'from encode_fragment import encode_structured',
      'result = encode_structured(json.loads(sys.stdin.read()))',
      'json.dump(result, sys.stdout)',
    ].join('\n'),
    JSON.stringify(payload),
  );
  return JSON.parse(stdout);
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

const plainHello = await decode(api, pyEncode('안녕하세요').t);
assert.equal(plainHello.text, '안녕하세요');
assert.equal(plainHello.view.show, false);
assert.equal(plainHello.view.sectioned, false);

const linkedPlain = await decode(api, `#t=${encodeURIComponent('메뉴 https://example.com/menu.')}`);
assert.equal(linkedPlain.text, '메뉴 https://example.com/menu.');
assert.equal(linkedPlain.view.show, true);
assert.deepEqual([...linkedPlain.view.links].map((link) => String(link.url)), ['https://example.com/menu']);
assert.equal(linkedPlain.view.sectioned, false);
passed += 2;

assert.equal(api.safeHttpUrl('javascript:alert(1)'), '');
assert.equal(api.safeHttpUrl('https://example.com/a'), 'https://example.com/a');
assert.deepEqual(
  [...api.extractLinks('끝 https://example.com/guide). 그리고 https://example.com/guide')].map((link) => String(link.url)),
  ['https://example.com/guide'],
);
const embed = api.osmEmbed(37.544577, 127.055961);
assert.match(embed, /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?/);
assert.equal(embed.includes('apikey'), false);
assert.equal(embed.includes('marker=37.544577%2C127.055961'), true);
assert.equal(api.osmEmbed(999, 127), '');
assert.equal(api.osmEmbed(37.5, Number.NaN), '');
passed += 1;

const sectionText = [
  '# 가는 길',
  '지하철 2호선 성수역 3번 출구.',
  '',
  '■ 시간',
  '오전 10시에 만나요.',
  '',
  '[준비물]',
  '- 신분증',
  '* 물',
  '',
  '1. 일정',
  '카페에서 출발해요. 🌤️',
  '',
  `2. ${'긴'.repeat(70)} 문장입니다.`,
].join('\n');
const sections = api.parseSections(sectionText);
assert.deepEqual([...sections].map((section) => String(section.heading)), ['가는 길', '시간', '준비물', '1. 일정']);
assert.equal(sections[2].blocks[0].type, 'ul');
assert.deepEqual([...sections[2].blocks[0].items].map(String), ['신분증', '물']);
assert.equal([...sections[3].blocks].some((block) => block.type === 'p' && String(block.text).includes('긴긴')), true);
assert.match(api.sectionPlain(sections[2]), /^준비물\n• 신분증\n• 물$/);
const sectionDecoded = await decode(api, pyEncode(sectionText).b);
assert.equal(sectionDecoded.text, sectionText);
assert.equal(sectionDecoded.view.sectioned, true);
assert.equal(sectionDecoded.view.show, true);
passed += 1;

const mapUrl = 'https://map.kakao.com/link/map/성수카페,37.544577,127.055961';
const structured = {
  title: '만나는 곳',
  text: `성수역 3번 출구에서 도보 5분. 🌤️\n${mapUrl}\nhttps://example.com/guide.`,
  links: [{ url: 'https://example.com/guide', title: '안내문' }],
  places: [{
    name: '성수 카페',
    address: '서울 성동구 연무장길 12',
    lat: 37.544577,
    lng: 127.055961,
    map_url: mapUrl,
  }],
};
const packed = pyStructured(structured);
assert.equal(typeof packed.url, 'string');
assert.ok(packed.length <= 2000);
assert.ok(packed.fragment.startsWith('j='));
const round = await decode(api, packed.fragment);
assert.equal(round.state, 'ready');
assert.equal(round.text, structured.text);
assert.equal(round.view.title, '만나는 곳');
assert.equal(round.view.places.length, 1);
assert.equal(round.view.places[0].name, '성수 카페');
assert.equal(round.view.places[0].address, '서울 성동구 연무장길 12');
assert.equal(round.view.places[0].lat, 37.544577);
assert.equal(round.view.places[0].lng, 127.055961);
assert.equal(round.view.places[0].mapUrl, api.safeHttpUrl(mapUrl));
assert.deepEqual(
  [...round.view.links].map((link) => ({ url: String(link.url), title: String(link.title) })),
  [{ url: 'https://example.com/guide', title: '안내문' }],
);
passed += 1;

const auto = pyStructured({ text: '메뉴는 https://example.com/menu 이에요 ✨' });
const autoDecoded = await decode(api, auto.fragment);
assert.equal(autoDecoded.text, '메뉴는 https://example.com/menu 이에요 ✨');
assert.deepEqual(
  [...autoDecoded.view.links].map((link) => ({ url: String(link.url), title: String(link.title) })),
  [{ url: 'https://example.com/menu', title: '' }],
);
passed += 1;

const dropped = pyStructured({
  text: 'hi',
  links: [
    { url: 'javascript:alert(1)', title: 'bad' },
    { url: 'https://example.com/ok', title: 'ok' },
  ],
});
const droppedDecoded = await decode(api, dropped.fragment);
assert.deepEqual(
  [...droppedDecoded.view.links].map((link) => ({ url: String(link.url), title: String(link.title) })),
  [{ url: 'https://example.com/ok', title: 'ok' }],
);
passed += 1;

const tiny = pyStructured({ text: '안녕' });
const tinyBytes = Buffer.from(tiny.fragment.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
assert.equal(tinyBytes[0], 0x7b);
const tinyBare = await decode(bare.api, tiny.fragment);
assert.equal(tinyBare.state, 'ready');
assert.equal(tinyBare.text, '안녕');
passed += 1;

const forced = py(
  [
    'import json',
    'from encode_fragment import _b64, _deflate',
    'body = json.dumps({"v":2,"text":"안녕 🌤️"}, ensure_ascii=False, separators=(",",":")).encode()',
    'print("j=" + _b64(_deflate(body)), end="")',
  ].join('\n'),
);
const forcedOk = await decode(api, forced);
assert.equal(forcedOk.text, '안녕 🌤️');
const forcedBare = await decode(bare.api, forced);
assert.equal(forcedBare.state, 'error');
assert.equal(forcedBare.reason, 'unsupported');
passed += 2;

const tooBig = py(
  [
    'import json',
    'from encode_fragment import encode_structured',
    'text = "".join(chr(0xAC00 + (i * 37) % 11172) for i in range(3000))',
    'print("null" if encode_structured({"text": text}) is None else "url")',
  ].join('\n'),
).trim();
assert.equal(tooBig, 'null');
assert.throws(() => pyStructured({}));
passed += 1;

for (const emptyJ of ['#j=', '#j']) {
  const result = await decode(api, emptyJ);
  assert.equal(result.state, 'empty', `empty ${emptyJ}`);
  passed += 1;
}
const badJ = await decode(api, '#j=aaaa');
assert.equal(badJ.state, 'error');
assert.equal(badJ.reason, 'format');
passed += 1;

location.href = `https://veronicamom.github.io/longlong-copy/#${packed.fragment}&tgWebAppVersion=8.0`;
const strippedJ = api.takeFragmentFromLocation();
assert.equal(strippedJ, packed.fragment);
assert.equal(history.last.includes(packed.fragment), false);
assert.equal(history.last, '/longlong-copy/#tgWebAppVersion=8.0');
passed += 1;

assert.ok(readme.includes(encoder.trim()), 'README should include the encoder source');

console.log(`ok ${passed} round-trips`);

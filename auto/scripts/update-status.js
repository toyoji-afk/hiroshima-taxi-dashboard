// update-status.js v37 JR production-ish LINEWISE parser
// Node.js 20+ / GitHub Actions
// Required in workflow when using JR rendered text:
//   npm i playwright
//   npx playwright install --with-deps chromium
//
// This standalone version writes JR 4 route records to auto/data/status.json.
// Merge getJrStatuses(), extractLineStatus(), and helper functions into your current
// full update-status.js if you already have weather/bus/airport/sports collectors.

const fs = require('fs');
const path = require('path');

const JR_URL = 'https://trafficinfo.westjr.co.jp/chugoku.html';
const OUT_PATH = path.join(process.cwd(), 'auto/data/status.json');
const DEBUG_DIR = path.join(process.cwd(), 'auto/data/debug');

const TARGET_LINES = ['山陽線', '呉線', '可部線', '芸備線'];

const ALL_JR_CHUGOKU_LINES = [
  '山陽線', '呉線', '可部線', '芸備線',
  '山陰線', '伯備線', '境線', '木次線', '因美線', '姫新線',
  '福塩線', '宇野みなと線', '瀬戸大橋線', '桃太郎線', '吉備線',
  '赤穂線', '津山線', '宇部線', '小野田線', '美祢線', '岩徳線',
  '山口線', '東海道・山陽新幹線', '山陽新幹線', '博多南線',
  '広島電鉄'
];

const JR_STOP_WORDS = [
  '連絡私鉄運行情報', '山陰地区', '山陽地区', '運行情報履歴',
  'サービス概要', '利用規約', 'よくあるご質問', '関連リンク',
  '特急列車の遅れ', '特急列車カテゴリ', 'JRおでかけネット',
  'JR西日本ホームページ', 'Copyright', 'このサイトに掲載されている情報'
];

const JR_STATUS_WORDS = [
  '順次運転見合わせ', '運転見合わせ', '一部列車運休・遅延',
  '一部列車遅延', '遅延あり', '遅れ', '遅延', '運休',
  '運転取り止め', '運転再開', '運転を再開', '保守工事',
  '列車に遅れ', 'ダイヤ乱れ'
];

const INCIDENT_START_RE = /(?=(?:順次運転見合わせ|運転見合わせ|一部列車運休・遅延|一部列車遅延|遅延あり|運休|運転取り止め|運転再開|ダイヤ乱れ))/g;

function nowIsoJst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T') + '+09:00';
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeDebug(name, body) {
  ensureDir(DEBUG_DIR);
  fs.writeFileSync(path.join(DEBUG_DIR, name), String(body || ''), 'utf8');
}

function normalizeText(s) {
  return String(s || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/〜/g, '～')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactLine(s) {
  return normalizeText(s).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function htmlToText(html) {
  return normalizeText(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"'));
}

async function fetchStaticHtml() {
  const res = await fetch(JR_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 GitHubActions taxi-dashboard v37',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
    }
  });
  const html = await res.text();
  console.log(`[JR] static fetch status=${res.status} length=${html.length}`);
  writeDebug('jr-static.html', html);
  writeDebug('jr-static-text.txt', htmlToText(html));
  return html;
}

async function fetchRenderedText() {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 GitHubActions taxi-dashboard v37',
      locale: 'ja-JP'
    });

    const responses = [];
    page.on('response', (response) => {
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (/trafficinfo|westjr|json|api|chugoku|train/i.test(url) || /json/i.test(ct)) {
        responses.push(`${response.status()} ${ct} ${url}`);
      }
    });

    await page.goto(JR_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);

    const html = await page.content();
    const text = normalizeText(await page.locator('body').innerText({ timeout: 10000 }));

    writeDebug('jr-rendered.html', html);
    writeDebug('jr-rendered-text.txt', text);
    writeDebug('jr-network.txt', responses.join('\n'));

    console.log(`[JR] rendered html length=${html.length} text length=${text.length}`);
    console.log('[JR] network candidates:\n' + responses.slice(0, 50).join('\n'));

    await browser.close();
    return text;
  } catch (e) {
    console.log('[JR] Playwright unavailable or failed:', e.message);
    return null;
  }
}

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/〜/g, '～')
    .split('\n')
    .map(x => x.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
}

function isStopLine(line, currentLine) {
  if (!line) return false;
  if (JR_STOP_WORDS.some(w => line.includes(w))) return true;

  return ALL_JR_CHUGOKU_LINES.some(name => {
    if (name === currentLine) return false;
    if (line === name) return true;
    if (line.startsWith(name + '（')) return true;
    if (line.startsWith(name + '(')) return true;
    if (line.startsWith(name + ' ')) return true;
    return false;
  });
}

function hasStatusNearby(lines, idx, windowSize = 45) {
  const chunk = lines.slice(idx, idx + windowSize).join(' ');
  return JR_STATUS_WORDS.some(w => chunk.includes(w));
}

function extractTargetBlock(text, targetLine) {
  const lines = normalizeLines(text);
  const candidateIndexes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line === targetLine ||
      line.startsWith(targetLine + ' ') ||
      line.startsWith(targetLine + '（') ||
      line.startsWith(targetLine + '(')
    ) {
      candidateIndexes.push(i);
    }
  }

  if (!candidateIndexes.length) return '';

  // メニュー側の路線名ではなく、異常語が近くにある本文側の路線名を優先する。
  const start = candidateIndexes.find(i => hasStatusNearby(lines, i)) ?? candidateIndexes[0];

  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i > start && isStopLine(line, targetLine)) break;
    out.push(line);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function stripJrNoise(s, targetLine) {
  return compactLine(s)
    .replace(new RegExp(`^.*?${targetLine}`), targetLine)
    .replace(/列車走行位置/g, ' ')
    .replace(/詳細/g, ' / ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*$/g, '')
    .trim();
}

function removeLineName(s, targetLine) {
  return String(s || '').replace(new RegExp(`^${targetLine}\s*`), '').trim();
}

function normalizeRangeText(range) {
  return String(range || '')
    .replace(/\s*～\s*/g, '～')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortUpdateTime(s) {
  const m = String(s || '').match(/(\d{2})月(\d{2})日(\d{1,2})時(\d{2})分更新/);
  if (!m) return '';
  return `${m[1]}/${m[2]} ${m[3]}:${m[4]}更新`;
}

function firstStatusPhrase(s) {
  return JR_STATUS_WORDS
    .filter(w => !['遅れ', '遅延', '運休', '列車に遅れ'].includes(w))
    .find(w => String(s || '').includes(w)) || '';
}

function formatIncident(raw) {
  let s = compactLine(raw).replace(/\s*\/\s*$/g, '').trim();
  if (!s) return '';

  const status = firstStatusPhrase(s);
  const update = shortUpdateTime(s);

  s = s.replace(/\d{2}月\d{2}日\d{1,2}時\d{2}分更新/g, '').trim();

  const restart = (s.match(/再開見込み\s*(.*?)(?=\s*区間|\s*原因|$)/) || [])[1];
  const range = (s.match(/区間\s*(.*?)(?=\s*原因|\s*再開見込み|$)/) || [])[1];
  const cause = (s.match(/原因\s*(.*?)(?=\s*再開見込み|\s*区間|$)/) || [])[1];

  // 「呉線：遅延あり 列車に遅れが出ています。」のように区間・原因が無いものも残す。
  let message = s;
  if (status) message = message.replace(status, '').trim();
  message = message
    .replace(/再開見込み\s*.*?(?=\s*区間|\s*原因|$)/, '')
    .replace(/区間\s*.*?(?=\s*原因|\s*再開見込み|$)/, '')
    .replace(/原因\s*.*?(?=\s*再開見込み|\s*区間|$)/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = [];
  if (status) parts.push(status);
  if (message) parts.push(message);
  if (range) parts.push(`区間 ${normalizeRangeText(range)}`);
  if (cause) parts.push(`原因：${cause.trim()}`);
  if (restart) parts.push(`再開見込み：${restart.trim()}`);
  if (update) parts.push(`（${update}）`);

  return parts.join(' ').replace(/\s+（/g, '（').trim();
}

function splitIncidents(block, targetLine) {
  const cleaned = stripJrNoise(block, targetLine);
  if (!cleaned) return [];

  let body = removeLineName(cleaned, targetLine);
  if (!body) return [];

  // JRの「詳細」を区切りにした / を第一優先で分割。
  let chunks = body.split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);

  // / が無いのに複数障害が連結した場合の保険。
  const expanded = [];
  for (const chunk of chunks) {
    const parts = chunk.split(INCIDENT_START_RE).map(x => x.trim()).filter(Boolean);
    expanded.push(...parts);
  }

  return [...new Set(expanded)]
    .map(formatIncident)
    .filter(Boolean)
    .filter(x => JR_STATUS_WORDS.some(w => x.includes(w)))
    .slice(0, 5);
}

function extractLineStatus(text, targetLine) {
  const block = extractTargetBlock(text, targetLine);
  console.log(`\n[JR] LINEWISE bounded block ${targetLine}:`);
  console.log(block || '(not found)');

  const cleaned = stripJrNoise(block, targetLine);
  const isAbnormal = JR_STATUS_WORDS.some(w => cleaned.includes(w));

  if (!block || !isAbnormal) {
    return {
      name: targetLine,
      status: '平常運転',
      memo: `${targetLine}：平常運転`,
      source: JR_URL,
      updated_at: nowIsoJst()
    };
  }

  const incidents = splitIncidents(block, targetLine);
  const memoBody = incidents.length ? incidents.join(' ／ ') : removeLineName(cleaned, targetLine);

  return {
    name: targetLine,
    status: '要確認',
    memo: `${targetLine}：${memoBody}`,
    source: JR_URL,
    updated_at: nowIsoJst()
  };
}

async function getJrStatuses() {
  const staticHtml = await fetchStaticHtml();
  const staticText = htmlToText(staticHtml);
  const renderedText = await fetchRenderedText();

  const text = renderedText && renderedText.length > staticText.length ? renderedText : staticText;
  console.log(`[JR] parser input=${renderedText ? 'rendered/static-best' : 'static-only'} length=${text.length}`);
  writeDebug('jr-parser-input.txt', text);

  const statuses = TARGET_LINES.map(line => extractLineStatus(text, line));

  console.log('\n[JR] extracted JR statuses:');
  for (const s of statuses) console.log(`- ${s.memo}`);

  return statuses;
}

async function main() {
  ensureDir(path.dirname(OUT_PATH));

  // Existing non-JR collectors should be merged in your current full file.
  // This standalone file intentionally writes only the JR records for safe verification.
  const jrStatuses = await getJrStatuses();

  const output = {
    updated_at: nowIsoJst(),
    items: jrStatuses,
    debug_note: 'v37 JR linewise parser. not found => 平常運転. Multiple incidents preserved. JR noise words removed.'
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[OK] wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

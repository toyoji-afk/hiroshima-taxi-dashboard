// update-status.js v34 JR debug + rendered text parser
// Node.js 20+ / GitHub Actions
// Optional but recommended: npm i playwright && npx playwright install --with-deps chromium

const fs = require('fs');
const path = require('path');

const JR_URL = 'https://trafficinfo.westjr.co.jp/chugoku.html';
const OUT_PATH = path.join(process.cwd(), 'auto/data/status.json');
const DEBUG_DIR = path.join(process.cwd(), 'auto/data/debug');

const TARGET_LINES = ['山陽線', '呉線', '可部線', '芸備線'];
const JR_STATUS_WORDS = [
  '運転見合わせ', '順次運転見合わせ', '運転取り止め', '運休',
  '遅れ', '遅延', '一部列車に遅れ', '運転再開', '運転を再開',
  '保守工事', '列車に遅れ', 'ダイヤ乱れ'
];

function nowIsoJst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T') + '+09:00';
}

function normalizeText(s) {
  return String(s || '')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/〜/g, '～')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactLine(s) {
  return normalizeText(s).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeDebug(name, body) {
  ensureDir(DEBUG_DIR);
  fs.writeFileSync(path.join(DEBUG_DIR, name), body, 'utf8');
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
      'user-agent': 'Mozilla/5.0 GitHubActions taxi-dashboard debug',
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
    }
  });
  const html = await res.text();
  console.log(`[JR DEBUG] static fetch status=${res.status} length=${html.length}`);
  writeDebug('jr-static.html', html);
  writeDebug('jr-static-text.txt', htmlToText(html));
  return html;
}

async function fetchRenderedText() {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 GitHubActions taxi-dashboard debug',
      locale: 'ja-JP'
    });

    const responses = [];
    page.on('response', async (response) => {
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

    console.log(`[JR DEBUG] rendered html length=${html.length} text length=${text.length}`);
    console.log('[JR DEBUG] network candidates:\n' + responses.slice(0, 80).join('\n'));

    for (const line of TARGET_LINES) {
      const idx = text.indexOf(line);
      console.log(`\n[JR DEBUG] around ${line}: index=${idx}`);
      if (idx >= 0) console.log(text.slice(Math.max(0, idx - 300), idx + 1200));
    }

    await browser.close();
    return text;
  } catch (e) {
    console.log('[JR DEBUG] Playwright unavailable or failed:', e.message);
    return null;
  }
}

function splitIncidentBlocks(text) {
  const t = normalizeText(text);
  const lines = t.split('\n').map(x => x.trim()).filter(Boolean);
  const blocks = [];

  // JR page often has separate cards/rows. Start a block whenever a target line appears.
  for (let i = 0; i < lines.length; i++) {
    if (!TARGET_LINES.includes(lines[i])) continue;
    const start = i;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (TARGET_LINES.includes(lines[j])) { end = j; break; }
      // broad area headers can also terminate cards
      if (/^\[.+地区\]$/.test(lines[j]) && j > i + 2) { end = j; break; }
    }
    const body = lines.slice(start, end).join('\n');
    blocks.push({ line: lines[i], body });
  }

  return blocks;
}

function extractLineStatus(text, targetLine) {
  const blocks = splitIncidentBlocks(text).filter(b => b.line === targetLine);
  const abnormal = [];

  for (const b of blocks) {
    const one = compactLine(b.body);
    if (JR_STATUS_WORDS.some(w => one.includes(w))) {
      abnormal.push(one);
    }
  }

  // Fallback: fixed window around every occurrence of line name.
  if (abnormal.length === 0) {
    const t = normalizeText(text);
    let pos = 0;
    while ((pos = t.indexOf(targetLine, pos)) >= 0) {
      const win = compactLine(t.slice(Math.max(0, pos - 200), pos + 1000));
      if (JR_STATUS_WORDS.some(w => win.includes(w))) abnormal.push(win);
      pos += targetLine.length;
    }
  }

  if (abnormal.length === 0) {
    return {
      name: targetLine,
      status: '平常運転',
      memo: `${targetLine}：平常運転`,
      source: JR_URL,
      updated_at: nowIsoJst()
    };
  }

  // Same line can have multiple incidents. Keep them separated.
  const unique = [...new Set(abnormal)]
    .map(s => s.replace(/^.*?(山陽線|呉線|可部線|芸備線)/, '$1'))
    .slice(0, 4);

  return {
    name: targetLine,
    status: '要確認',
    memo: `${targetLine}：${unique.join(' ／ ')}`,
    source: JR_URL,
    updated_at: nowIsoJst()
  };
}

async function getJrStatuses() {
  const staticHtml = await fetchStaticHtml();
  const staticText = htmlToText(staticHtml);
  const renderedText = await fetchRenderedText();

  const text = renderedText && renderedText.length > staticText.length ? renderedText : staticText;
  console.log(`[JR DEBUG] parser input=${renderedText ? 'rendered/static-best' : 'static-only'} length=${text.length}`);
  writeDebug('jr-parser-input.txt', text);

  const statuses = TARGET_LINES.map(line => extractLineStatus(text, line));
  console.log('[JR DEBUG] extracted JR statuses:');
  for (const s of statuses) console.log(`- ${s.memo}`);
  return statuses;
}

async function main() {
  ensureDir(path.dirname(OUT_PATH));

  // Existing non-JR collectors should be merged here in your current file.
  // This standalone debug version writes only JR records so the parser can be verified quickly.
  const jrStatuses = await getJrStatuses();

  const output = {
    updated_at: nowIsoJst(),
    items: jrStatuses,
    debug_note: 'v34 JR debug standalone. Merge getJrStatuses()/extractLineStatus() into existing update-status.js after verification.'
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[OK] wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

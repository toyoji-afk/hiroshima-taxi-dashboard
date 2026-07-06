// update-status.js v36 JR debug + LINEWISE route parser
// Node.js 20+ / GitHub Actions
// Optional but recommended: npm i playwright && npx playwright install --with-deps chromium

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
  '山口線', '可部線', '福塩線', '呉線',
  '東海道・山陽新幹線', '山陽新幹線', '博多南線',
  '広島電鉄'
];

const JR_STOP_WORDS = [
  '連絡私鉄運行情報', '山陰地区', '山陽地区', '運行情報履歴',
  'サービス概要', '利用規約', 'よくあるご質問', '関連リンク',
  '特急列車の遅れ', '特急列車カテゴリ'
];

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

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/〜/g, '～')
    .split('\n')
    .map(x => x.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
}

function isStopLine(line) {
  if (!line) return false;
  if (JR_STOP_WORDS.some(w => line.includes(w))) return true;

  // 「小野田線（長門本山方面）」のように括弧付きでも止める。
  // ただし対象路線名の本文中に出る「区間 山陽線内...」のような曖昧なものは避けるため、行頭一致を基本にする。
  return ALL_JR_CHUGOKU_LINES.some(name => {
    if (line === name) return true;
    if (line.startsWith(name + '（')) return true;
    if (line.startsWith(name + '(')) return true;
    if (line.startsWith(name + ' ')) return true;
    return false;
  });
}

function hasStatusNearby(lines, idx, windowSize = 40) {
  const chunk = lines.slice(idx, idx + windowSize).join(' ');
  return JR_STATUS_WORDS.some(w => chunk.includes(w));
}

function extractTargetBlock(text, targetLine) {
  const lines = normalizeLines(text);

  const candidateIndexes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === targetLine || line.startsWith(targetLine + ' ') || line.startsWith(targetLine + '（') || line.startsWith(targetLine + '(')) {
      candidateIndexes.push(i);
    }
  }

  if (!candidateIndexes.length) return '';

  // メニューや「列車走行位置」だけの山陽線を拾わないよう、異常語が近くにある候補を優先。
  const start = candidateIndexes.find(i => hasStatusNearby(lines, i)) ?? candidateIndexes[0];

  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (i > start && isStopLine(line)) {
      // 次のJR路線名やフッターに入ったら終了。
      break;
    }

    out.push(line);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanJrMemoText(s, targetLine) {
  return compactLine(s)
    .replace(new RegExp(`^.*?${targetLine}`), targetLine)
    .replace(/\s*列車走行位置\s*/g, ' ')
    .replace(/\s*詳細\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*$/g, '')
    .trim();
}

function splitSameLineIncidents(block, targetLine) {
  const cleaned = cleanJrMemoText(block, targetLine);
  if (!cleaned) return [];

  // 「詳細」を / にしてから、次の障害種別で分割する。
  const parts = cleaned
    .split(/\s+\/\s+(?=(順次運転見合わせ|運転見合わせ|一部列車運休・遅延|一部列車遅延|遅延あり|遅れ|運休|運転取り止め|運転再開|列車に遅れ))/g)
    .filter(x => x && !JR_STATUS_WORDS.includes(x));

  if (parts.length <= 1) return [cleaned];

  return parts.map((part, i) => {
    const p = part.trim();
    return i === 0 && p.startsWith(targetLine) ? p : `${targetLine} ${p}`;
  });
}

function extractLineStatus(text, targetLine) {
  const block = extractTargetBlock(text, targetLine);
  console.log(`\n[JR DEBUG] LINEWISE bounded block ${targetLine}:`);
  console.log(block || '(not found)');

  const one = cleanJrMemoText(block, targetLine);
  const isAbnormal = JR_STATUS_WORDS.some(w => one.includes(w));

  if (!block || !isAbnormal) {
    return {
      name: targetLine,
      status: '平常運転',
      memo: `${targetLine}：平常運転`,
      source: JR_URL,
      updated_at: nowIsoJst()
    };
  }

  const unique = [...new Set(splitSameLineIncidents(block, targetLine))]
    .filter(s => JR_STATUS_WORDS.some(w => s.includes(w)))
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
    debug_note: 'v36 JR linewise parser standalone. It extracts a route block by rendered text lines and stops at the next route/footer line.'
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[OK] wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

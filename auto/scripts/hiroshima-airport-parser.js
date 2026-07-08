// hiroshima-airport-parser.js v68
// 広島空港フライト情報パーサー
// Node.js 20+ / Playwright
//
// 広島空港公式のフライト表は、通常fetchでは便一覧が取れず、
// ページ表示後にJavaScriptで読み込まれるため、Playwrightで描画後のbodyテキストを見る。

const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(process.cwd(), 'auto/data/debug');

const URLS = {
  domesticDepartures: 'https://www.hij.airport.jp/flight/flight_dd.html',
  domesticArrivals: 'https://www.hij.airport.jp/flight/flight_da.html',
  internationalDepartures: 'https://www.hij.airport.jp/flight/flight_id.html',
  internationalArrivals: 'https://www.hij.airport.jp/flight/flight_ia.html',
};

const USER_AGENT = 'Mozilla/5.0 GitHubActions HiroshimaTaxiDashboard-AirportParser/68.0';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeDebug(name, body) {
  try {
    ensureDir(DEBUG_DIR);
    fs.writeFileSync(path.join(DEBUG_DIR, name), String(body || ''), 'utf8');
  } catch (e) {
    console.log(`[airport-debug] write skipped: ${name}: ${e.message}`);
  }
}

function compactText(s) {
  return String(s || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/〜/g, '～')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function addCacheBuster(url) {
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}_=${Date.now()}`;
}

function makeSimpleItem(message, status = '平常', url = URLS.domesticDepartures) {
  return {
    name: '広島空港',
    title: '広島空港',
    label: '広島空港',
    message,
    text: message,
    detail: message,
    summary: message,
    status,
    state: status,
    result: status,
    url,
    link: url,
    href: url,
    source: url,
  };
}

async function getRenderedText(page, label, url) {
  const targetUrl = addCacheBuster(url);

  await page.goto(targetUrl, {
    waitUntil: 'networkidle',
    timeout: 45000,
  });

  // フライト表の追加読み込みを待つ。サイト側が10分ごと更新の動的表示なので少し余裕を見る。
  await page.waitForTimeout(2500);

  const bodyText = await page.locator('body').innerText({ timeout: 10000 });
  const text = compactText(bodyText);

  console.log(`[airport-render] ${label}: length=${text.length} url=${url}`);
  writeDebug(`airport-${label}.rendered.txt`, text);

  return text;
}

function flagsFromText(text) {
  const t = compactText(text);
  const flags = [];

  if (t.includes('時刻変更')) flags.push('時刻変更');

  // 広島空港公式の表では「遅延」ではなく「遅れ」と出ることがある。
  if (/遅延|遅れ/.test(t)) flags.push('遅れ');

  const otherWords = ['欠航', '条件付き', '天候調査', '引き返し', '目的地変更', '欠便'];
  for (const word of otherWords) {
    if (t.includes(word)) flags.push(word);
  }

  return [...new Set(flags)];
}

function buildMessage(records) {
  const domesticText = compactText(records
    .filter(r => r.group === '国内線')
    .map(r => `${r.label} ${r.text}`)
    .join(' '));

  const internationalText = compactText(records
    .filter(r => r.group === '国際線')
    .map(r => `${r.label} ${r.text}`)
    .join(' '));

  const parts = [];

  const domesticFlags = flagsFromText(domesticText);
  if (domesticFlags.length) {
    parts.push(`国内線${domesticFlags.join('・')}あり`);
  }

  const internationalFlags = flagsFromText(internationalText);
  if (internationalFlags.length) {
    parts.push(`国際線${internationalFlags.join('・')}あり`);
  }

  if (parts.length) {
    return {
      message: `${parts.join('、')}。公式フライト情報確認`,
      status: '要確認',
    };
  }

  return {
    message: '平常運航',
    status: '平常運航',
  };
}

async function getAirportStatus() {
  const pages = [
    ['国内線出発', '国内線', URLS.domesticDepartures],
    ['国内線到着', '国内線', URLS.domesticArrivals],
    ['国際線出発', '国際線', URLS.internationalDepartures],
    ['国際線到着', '国際線', URLS.internationalArrivals],
  ];

  let chromium = null;
  let browser = null;

  try {
    ({ chromium } = require('playwright'));
    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage({
      userAgent: USER_AGENT,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });

    const records = [];
    for (const [label, group, url] of pages) {
      try {
        const text = await getRenderedText(page, label, url);
        records.push({ label, group, url, text });
      } catch (e) {
        console.log(`[airport-render] ${label} failed: ${e.message}`);
        writeDebug(`airport-${label}.error.txt`, e.stack || e.message || String(e));
      }
    }

    if (!records.length) {
      return makeSimpleItem('フライト情報未確認。公式フライト情報確認', '要確認', URLS.domesticDepartures);
    }

    const { message, status } = buildMessage(records);
    return makeSimpleItem(message, status, URLS.domesticDepartures);
  } catch (e) {
    return makeSimpleItem(`取得失敗：公式フライト情報確認（${e.message || e}）`, '取得失敗', URLS.domesticDepartures);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  getAirportStatus,
};

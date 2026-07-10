// update-status.js v70: carp home-game strict date-section fix
// 広島市タクシーダッシュボード：本日の自動巡回メモ生成
// Node.js 20+ / GitHub Actions
//
// 必須：同じフォルダに jr-west-parser.js を置いてください。
// 互換用に JR-WEST-Parser.js / jr-West-parser.js も読みに行きます。
//
// GitHub Actions では JR西日本ページ描画用に Playwright を入れてください：
//   npm i playwright
//   npx playwright install --with-deps chromium

const fs = require('fs');
const path = require('path');

const OUT_PATH = path.join(process.cwd(), 'auto/data/status.json');
const DEBUG_DIR = path.join(process.cwd(), 'auto/data/debug');

const URLS = {
  weather: 'https://api.open-meteo.com/v1/forecast',
  hiroden: 'https://www.hiroden.co.jp/traffic/info/',
  sanyoShinkansen: 'https://trafficinfo.westjr.co.jp/sanyo.html',
  hiroshimaBus: 'https://hirobus-info-rosen.jp/',
  hiroshimaKotsu: 'https://www.hiroko-group.co.jp/kotsu/rosen_unkou.htm',
  airportDomesticDepartures: 'https://www.hij.airport.jp/flight/flight_dd.html',
  airportDomesticArrivals: 'https://www.hij.airport.jp/flight/flight_da.html',
  airportInternationalDepartures: 'https://www.hij.airport.jp/flight/flight_id.html',
  airportInternationalArrivals: 'https://www.hij.airport.jp/flight/flight_ia.html',
  carp: 'https://www.ticket.carp.co.jp/calendar/',
  npbMonthly: 'https://npb.jp/games/',
  sanfrecce: 'https://www.sanfrecce.co.jp/matches/results',
};

const USER_AGENT = 'Mozilla/5.0 GitHubActions HiroshimaTaxiDashboard/70.0';

function nowIsoJst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T') + '+09:00';
}

function todayJstParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const pick = t => parts.find(p => p.type === t)?.value;
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    weekday: pick('weekday'),
    mdSlash: `${Number(pick('month'))}/${Number(pick('day'))}`,
    mdDot: `${Number(pick('month'))}.${Number(pick('day'))}`,
    mdKanji: `${Number(pick('month'))}月${Number(pick('day'))}日`,
    ymdSlash: `${pick('year')}/${Number(pick('month'))}/${Number(pick('day'))}`,
    ymdHyphen: `${pick('year')}-${pick('month')}-${pick('day')}`,
    yyyymm: `${pick('year')}${pick('month')}`,
    mm: pick('month'),
    dd: pick('day'),
  };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeDebug(name, body) {
  try {
    ensureDir(DEBUG_DIR);
    fs.writeFileSync(path.join(DEBUG_DIR, name), String(body || ''), 'utf8');
  } catch (e) {
    console.log(`[debug] write skipped: ${name}: ${e.message}`);
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

function htmlToText(html) {
  return compactText(String(html || '')
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

function slugifyName(name) {
  return String(name || '')
    .replace(/\s+/g, '-')
    .replace(/[：:]/g, '-')
    .trim();
}

function badgeForStatus(statusOrBody) {
  const s = String(statusOrBody || '');
  if (/取得失敗|失敗|error|ERROR|NG/i.test(s)) return 'NG';
  if (/要確認|注意|警戒|遅延|運休|見合わせ|欠航|運転取り止め|ダイヤ乱れ|warning|WARN/i.test(s)) return '注意';
  return 'OK';
}

function levelForStatus(statusOrBody) {
  const s = String(statusOrBody || '');
  if (/取得失敗|失敗|error|ERROR|NG/i.test(s)) return 'error';
  if (/要確認|注意|警戒|遅延|運休|見合わせ|欠航|運転取り止め|ダイヤ乱れ|warning|WARN/i.test(s)) return 'warning';
  return 'ok';
}

function statusCodeForLevel(level) {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  return 'ok';
}

function statusLabelForLevel(level) {
  if (level === 'error') return '取得失敗';
  if (level === 'warning') return '要確認';
  return '平常';
}

// auto/index.html 側の古い表示ロジックにも合うよう、同じ内容を複数フィールドに入れます。
// auto/index.html 側の古い表示ロジックにも合うよう、同じ内容を複数フィールドに入れます。
function makeItem(name, memoBody, status = '確認', source = '') {
  const checked = nowIsoJst();
  const title = String(name || '情報源');
  const body = String(memoBody || '確認してください');
  const memo = `${title}：${body}`;

  // 「大きな欠航・遅延表示なし」のような正常文で、欠航/遅延という単語だけに反応しないようにする。
  const normalMessage = /平常|平常運航|大きな乱れ情報なし|表示なし|検出なし|通常運行|通常通り|運行情報はありません/.test(`${status} ${body}`);
  const combined = `${status} ${title} ${body}`;
  let level = normalMessage ? 'ok' : levelForStatus(combined);
  const badge = level === 'error' ? 'NG' : level === 'warning' ? '注意' : 'OK';
  const statusCode = statusCodeForLevel(level);
  const statusLabel = statusLabelForLevel(level);
  const isOk = level === 'ok';
  const id = slugifyName(title);

  return {
    id,
    key: id,
    name: title,
    title,
    label: title,
    display_name: title,
    displayName: title,

    // 画面側の古い判定に合わせ、status/state は日本語寄りに戻します。
    // コード値は status_code/statusCode に保持します。
    status: level === 'warning' ? '注意' : statusLabel,
    state: level === 'warning' ? '注意' : statusLabel,
    result: level === 'warning' ? '注意' : statusLabel,
    status_code: statusCode,
    statusCode,
    status_label: level === 'warning' ? '注意' : statusLabel,
    statusLabel: level === 'warning' ? '注意' : statusLabel,
    original_status: status,
    originalStatus: status,

    badge,
    badge_text: badge,
    badgeText: badge,
    badge_label: badge,
    badgeLabel: badge,
    label_badge: badge,
    labelBadge: badge,
    level,
    severity: level,
    type: level,
    kind: level,
    className: level,
    statusClass: level,
    priority: level,

    ok: isOk,
    is_ok: isOk,
    isOk,
    alert: !isOk,
    has_alert: !isOk,
    hasAlert: !isOk,
    warning: level === 'warning',
    error: level === 'error',

    memo,
    message: body,
    text: body,
    detail: body,
    details: body,
    summary: body,
    description: body,
    note: body,
    body,
    content: body,
    value: body,

    url: source,
    link: source,
    href: source,
    source,
    source_url: source,
    sourceUrl: source,
    source_label: '情報源',
    sourceLabel: '情報源',
    source_name: '情報源',
    sourceName: '情報源',

    updated_at: checked,
    updatedAt: checked,
    checked_at: checked,
    checkedAt: checked,
  };
}

function normalizeDashboardItem(item) {
  if (!item || typeof item !== 'object') return item;

  const name = item.name || item.title || item.label || item.display_name || item.displayName || '情報源';
  const status = item.status || item.state || '確認';

  let body = item.message || item.text || item.detail || item.details || item.summary || item.description || item.note || item.body || item.content || item.value || '';
  if (!body && item.memo) {
    body = String(item.memo).replace(new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*[：:]\s*`), '');
  }
  if (!body) body = '確認してください';

  const source = item.url || item.link || item.href || item.source_url || item.sourceUrl || item.source || '';
  const out = makeItem(name, body, status, source);

  // 元の項目が持っている追加フィールドは残しつつ、表示互換フィールドを優先します。
  return { ...item, ...out };
}

function normalItem(name, source = '') {
  return makeItem(name, '平常運転', '平常運転', source);
}

function errorItem(name, err, source = '') {
  return makeItem(name, `取得失敗：公式ページを確認（${err.message || err}）`, '取得失敗', source);
}

async function fetchText(url, label, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache, no-store, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await res.text();
    console.log(`[fetch] ${label}: status=${res.status} length=${body.length} url=${url}`);
    writeDebug(`${label}.html`, body);
    const text = htmlToText(body);
    writeDebug(`${label}.txt`, text);
    return { ok: res.ok, status: res.status, html: body, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithRetry(url, label, timeoutMs = 30000, attempts = 2) {
  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const targetUrl = (typeof addCacheBuster === 'function') ? addCacheBuster(url) : url;
      return await fetchText(targetUrl, `${label}${i > 1 ? `-retry${i}` : ''}`, timeoutMs);
    } catch (e) {
      lastError = e;
      console.log(`[fetch] ${label}: attempt ${i}/${attempts} failed: ${e.message}`);
      if (i < attempts) {
        await new Promise(resolve => setTimeout(resolve, 1200 * i));
      }
    }
  }
  throw lastError || new Error('fetch failed');
}


function requireJrParser() {
  const candidates = [
    './jr-west-parser',
    './JR-WEST-Parser',
    './jr-West-parser',
    './JR-West-Parser',
  ];
  const errors = [];
  for (const p of candidates) {
    try {
      const mod = require(p);
      if (typeof mod.getJrStatuses === 'function') return mod;
      errors.push(`${p}: getJrStatuses not found`);
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }
  throw new Error(`JR parser not found. Put auto/scripts/jr-west-parser.js. Details: ${errors.join(' / ')}`);
}


async function fetchRenderedText(url, label, timeoutMs = 45000) {
  // JR西日本の運行情報ページはクライアント側描画が入るため、
  // fetchではなくPlaywrightで描画後のbodyテキストを見る。
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

    await page.goto(addCacheBuster(url), {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });

    await page.waitForTimeout(1200);

    const html = await page.content();
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const text = compactText(bodyText || htmlToText(html));

    console.log(`[render] ${label}: length=${text.length}`);
    writeDebug(`${label}.rendered.html`, html);
    writeDebug(`${label}.rendered.txt`, text);

    return { ok: true, status: 200, html, text };
  } finally {
    if (browser) await browser.close();
  }
}

function extractSanyoShinkansenOperations(text) {
  const raw = compactText(text);

  const noInfoWords = [
    '現在、運行情報はありません',
    '現在運行情報はありません',
    '現在、お知らせする情報はありません',
    'お知らせする情報はありません',
    'お知らせする情報がありません',
    '現在お知らせする情報はありません',
    '現在情報はありません',
    '平常通り運転しています',
    '平常運転しています',
  ];
  if (noInfoWords.some(w => raw.includes(w))) return '';

  // 説明文・凡例のキーワード誤検出を避けるため、日時付きの実エントリだけを見る。
  const abnormalStates = '遅延|運転見合わせ|運行見合わせ|運休|一部運休|運転取り止め|運転を取り止め|ダイヤ乱れ';
  const datedEntryRe = new RegExp(`(20\\d{2}[\\/\\-年]\\d{1,2}[\\/\\-月]\\d{1,2}日?\\s+\\d{1,2}:\\d{2}|\\d{1,2}月\\d{1,2}日\\s+\\d{1,2}:\\d{2}|\\d{1,2}:\\d{2})\\s*(?:現在|更新)?\\s*(${abnormalStates})`, 'g');

  const entries = [];
  let m;
  while ((m = datedEntryRe.exec(raw)) !== null) {
    const start = Math.max(0, m.index - 20);
    const end = Math.min(raw.length, m.index + 240);
    const chunk = raw.slice(start, end);

    if (/凡例|説明|このページ|ご利用上の注意|ナビゲーション|トップページ|履歴/.test(chunk)) continue;

    const state = m[2];
    const reason = (chunk.match(/(?:原因|理由)\s*[:：]?\s*([^。／\s]+(?:\s*[^。／]{0,24})?)/) || [])[1];
    const section = (chunk.match(/(?:区間|影響区間)\s*[:：]?\s*([^。／]{1,36})/) || [])[1];

    let msg = state;
    if (reason) msg += `：${compactText(reason).slice(0, 32)}`;
    if (section) msg += `（${compactText(section).slice(0, 36)}）`;

    if (!entries.some(x => x === msg)) entries.push(msg);
  }

  if (!entries.length) return '';

  return `${entries.slice(0, 4).join(' ／ ')}。広島駅新幹線口周辺の混雑に注意`;
}

async function getSanyoShinkansenStatus() {
  const name = '山陽新幹線';
  try {
    const { text } = await fetchRenderedText(URLS.sanyoShinkansen, 'sanyo-shinkansen');
    const ops = extractSanyoShinkansenOperations(text);
    if (ops) return makeItem(name, ops, '要確認', URLS.sanyoShinkansen);
    return makeItem(name, '平常運転', '平常運転', URLS.sanyoShinkansen);
  } catch (e) {
    return makeItem(name, `情報未確認。必要時はJR西日本公式を確認（${e.message || e}）`, '要確認', URLS.sanyoShinkansen);
  }
}


async function getWeatherStatus() {
  const name = '広島市中心天気';

  // 広島市中心部（紙屋町・八丁堀周辺を想定）の代表座標。
  // Open-Meteoは緯度経度指定なので、気象庁の「南部」より広島市中心部寄りにできます。
  const latitude = 34.3853;
  const longitude = 132.4553;
  const url = `${URLS.weather}?latitude=${latitude}&longitude=${longitude}` +
    '&current=temperature_2m,weather_code' +
    '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code' +
    '&daily=temperature_2m_max' +
    '&timezone=Asia%2FTokyo&forecast_days=1';

  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'ja,en-US;q=0.9' } });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    writeDebug('openmeteo-forecast.json', JSON.stringify(json, null, 2));

    const currentTemp = json?.current?.temperature_2m;
    const currentCode = Number(json?.current?.weather_code);
    const currentWeather = weatherCodeToJapanese(currentCode);
    const maxTemp = Array.isArray(json?.daily?.temperature_2m_max) ? json.daily.temperature_2m_max[0] : null;

    const blocks = buildOpenMeteoThreeHourBlocks(json, 4);
    const maxPop = blocks.reduce((m, b) => Math.max(m, b.pop ?? 0), 0);
    const hasRainOrThunder = blocks.some(b => /雨|雷|雪|霧/.test(b.weather || ''));

    const blockText = blocks.length
      ? `3時間予報 ${blocks.map(b => `${b.label} ${b.weather} ${b.pop}%${b.rain > 0 ? `/${b.rain}mm` : ''}`).join(' ／ ')}`
      : '';

    const body = [
      `${currentWeather}${currentTemp != null ? ` 現在${num(currentTemp)}℃` : ''}${maxTemp != null ? ` 最高${num(maxTemp)}℃` : ''}`,
      blockText,
    ].filter(Boolean).join('　');

    // タクシー乗務向け：3時間予報の降水確率が50%以上なら配車増・乗降注意として「注意」。
    // 雷雨・強雨・雪なども注意扱いにします。
    const severeWeather = blocks.some(b => /雷雨|強い雨|激しい|雪|強いにわか雨/.test(b.weather || ''));
    const status = (maxPop >= 50 || severeWeather || (maxPop >= 40 && hasRainOrThunder)) ? '要確認' : '平常';

    // APIのJSONに飛ばしても利用者には読みにくいので、自動巡回メモ側はリンクなし。
    return makeItem(name, body || 'Open-Meteo天気予報を確認', status, '');
  } catch (e) {
    return errorItem(name, e, '');
  }
}

function openMeteoHourlyIndexByTime(json) {
  const times = json?.hourly?.time || [];
  const map = new Map();
  times.forEach((t, i) => map.set(String(t), i));
  return map;
}

function openMeteoSeverity(code) {
  const c = Number(code);
  // 大まかな強さ。3時間ブロック内で一番強い天気を表示するためのもの。
  if ([95, 96, 99].includes(c)) return 90;
  if ([82, 65, 67, 75, 86].includes(c)) return 80;
  if ([63, 81, 73, 85].includes(c)) return 70;
  if ([61, 80, 71, 77].includes(c)) return 60;
  if ([51, 53, 55, 56, 57].includes(c)) return 50;
  if ([45, 48].includes(c)) return 40;
  if (c === 3) return 30;
  if (c === 2) return 20;
  if (c === 1) return 10;
  if (c === 0) return 0;
  return 0;
}

function buildOpenMeteoThreeHourBlocks(json, maxBlocks = 4) {
  const hourly = json?.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const pops = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const rains = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
  const codes = Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
  const timeIndex = openMeteoHourlyIndexByTime(json);

  const nowParts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(new Date());
  const pick = t => nowParts.find(p => p.type === t)?.value;
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  const nowHour = Number(pick('hour'));
  const startSlot = Math.floor(nowHour / 3) * 3;

  const blocks = [];
  for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
    if (h < startSlot) continue;
    const indexes = [];
    for (let k = 0; k < 3; k++) {
      const hh = String(h + k).padStart(2, '0');
      const key = `${y}-${m}-${d}T${hh}:00`;
      const idx = timeIndex.get(key);
      if (idx !== undefined) indexes.push(idx);
    }
    if (!indexes.length) continue;

    const popValues = indexes.map(i => Number(pops[i])).filter(n => !Number.isNaN(n));
    const rainValues = indexes.map(i => Number(rains[i])).filter(n => !Number.isNaN(n));
    const codeValues = indexes.map(i => Number(codes[i])).filter(n => !Number.isNaN(n));
    const pop = popValues.length ? Math.max(...popValues) : 0;
    const rain = rainValues.length ? Math.round(rainValues.reduce((a, b) => a + b, 0) * 10) / 10 : 0;
    const code = codeValues.length ? codeValues.sort((a, b) => openMeteoSeverity(b) - openMeteoSeverity(a))[0] : null;
    const label = `${h}-${Math.min(h + 3, 24)}時`;
    blocks.push({ label, pop, rain, weather: weatherCodeToJapanese(code), code });
    if (blocks.length >= maxBlocks) break;
  }
  return blocks;
}

function pickArea(areas, preferredNames) {
  if (!Array.isArray(areas) || !areas.length) return null;
  for (const name of preferredNames) {
    const found = areas.find(a => String(a?.area?.name || a?.name || '').includes(name));
    if (found) return found;
  }
  return areas[0];
}

function pickTodayIndex(timeDefines, todayDate, fallback = 0) {
  if (!Array.isArray(timeDefines)) return fallback;
  const idx = timeDefines.findIndex(t => String(t || '').startsWith(todayDate));
  return idx >= 0 ? idx : fallback;
}

function cleanJmaText(s) {
  return String(s || '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/所により/g, 'ところにより')
    .trim();
}



function cleanHiroshimaCityWeatherText(s) {
  let text = cleanJmaText(s);

  // 気象庁の「南部」予報には、広島市周辺ではなく
  // 「福山・三原では…」「備後では…」のような局地文が混じることがあります。
  // 広島市タクシー用なので、広島市周辺に直接関係しない局地句は落とします。
  const nonHiroshimaAreaWords = [
    '福山', '三原', '尾道', '府中', '竹原', '東広島',
    '庄原', '三次', '北広島', '安芸高田', '世羅', '神石高原',
    '備後', '北部'
  ];

  const areaGroup = `(?:${nonHiroshimaAreaWords.join('|')})(?:[・、,\s]*(?:${nonHiroshimaAreaWords.join('|')}))*`;

  // 例: 「くもり 福山・三原 では 夕方 雨 雷を伴い激しく降る」→「くもり」
  text = text.replace(new RegExp(`\\s*${areaGroup}\\s*では\\s*.*$`), '').trim();

  // 広島・呉は広島市周辺として残すが、表示を少し自然にする。
  text = text
    .replace(/広島\s*[・、,]\s*呉\s*では/g, '広島・呉では')
    .replace(/広島\s*では/g, '広島では')
    .replace(/呉\s*では/g, '呉では')
    .replace(/\s+/g, ' ')
    .trim();

  return text || '天気予報を確認';
}

function hourFromIso(t) {
  const m = String(t || '').match(/T(\d{2}):/);
  return m ? Number(m[1]) : null;
}

function buildPopParts(timeDefines, pops, todayDate) {
  const out = [];
  if (!Array.isArray(timeDefines) || !Array.isArray(pops)) return out;
  const nowHour = Number(new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(new Date()));

  for (let i = 0; i < timeDefines.length; i++) {
    const t = String(timeDefines[i] || '');
    if (!t.startsWith(todayDate)) continue;
    const start = hourFromIso(t);
    const next = String(timeDefines[i + 1] || '');
    const end = next.startsWith(todayDate) ? hourFromIso(next) : 24;
    const percent = pops[i];
    if (percent == null || percent === '') continue;

    // 現在時刻を過ぎた時間帯でも、その時間帯の中なら残します。
    if (end != null && end <= nowHour) continue;
    if (start == null || end == null) continue;
    out.push({ label: `${start}-${end}時`, percent: String(percent) });
  }
  return out;
}

function buildTempInfo(timeDefines, area, todayDate) {
  const pieces = [];
  const tempsMax = area.tempsMax || [];
  const tempsMin = area.tempsMin || [];
  const temps = area.temps || [];

  const todayIndexes = Array.isArray(timeDefines)
    ? timeDefines.map((t, i) => String(t || '').startsWith(todayDate) ? i : -1).filter(i => i >= 0)
    : [];

  const maxCandidates = [];
  const minCandidates = [];

  for (const i of todayIndexes) {
    if (tempsMax[i] !== undefined && tempsMax[i] !== '') maxCandidates.push(Number(tempsMax[i]));
    if (tempsMin[i] !== undefined && tempsMin[i] !== '') minCandidates.push(Number(tempsMin[i]));
    if (temps[i] !== undefined && temps[i] !== '') {
      const n = Number(temps[i]);
      if (!Number.isNaN(n)) {
        maxCandidates.push(n);
        minCandidates.push(n);
      }
    }
  }

  const max = maxCandidates.filter(n => !Number.isNaN(n)).length ? Math.max(...maxCandidates.filter(n => !Number.isNaN(n))) : null;
  const min = minCandidates.filter(n => !Number.isNaN(n)).length ? Math.min(...minCandidates.filter(n => !Number.isNaN(n))) : null;
  if (max != null) pieces.push(`最高${max}℃`);
  if (min != null && min !== max) pieces.push(`最低${min}℃`);
  return pieces.join('／');
}

function num(v) {
  if (v == null || Number.isNaN(Number(v))) return '';
  return Math.round(Number(v) * 10) / 10;
}

function weatherCodeToJapanese(code) {
  const map = {
    0: '快晴', 1: '晴れ', 2: '一部曇り', 3: '曇り',
    45: '霧', 48: '霧氷',
    51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨',
    56: '弱い着氷性霧雨', 57: '強い着氷性霧雨',
    61: '弱い雨', 63: '雨', 65: '強い雨',
    66: '弱い着氷性雨', 67: '強い着氷性雨',
    71: '弱い雪', 73: '雪', 75: '強い雪', 77: '雪粒',
    80: '弱いにわか雨', 81: 'にわか雨', 82: '強いにわか雨',
    85: '弱いにわか雪', 86: '強いにわか雪',
    95: '雷雨', 96: '雷雨・ひょう', 99: '激しい雷雨・ひょう',
  };
  return map[code] || '天気確認';
}

function detectTransitAbnormal(text) {
  const t = compactText(text);
  const abnormalWords = [
    '運転見合わせ', '運行見合わせ', '運休', '一部運休', '遅延', '大幅な遅れ', '遅れが発生',
    '迂回', '通行止め', '見合わせ', '運転を取り止め', '運行を中止', 'ダイヤ乱れ',
    '欠航', '条件付き', '天候調査', '引き返し', '欠便'
  ];
  return abnormalWords.some(w => t.includes(w));
}

function hasNoInfoText(text) {
  const t = compactText(text);
  return [
    '現在お知らせする情報はありません',
    '現在、運行情報はありません',
    '現在、通常通り運行',
    '平常通り運行',
    '通常運行',
    '通常通り運行',
    '現在情報はありません',
  ].some(w => t.includes(w));
}

function excerptAbnormal(text, maxLen = 110) {
  const t = compactText(text);
  const words = ['運転見合わせ', '運行見合わせ', '運休', '遅延', '大幅な遅れ', '迂回', '通行止め', '欠航', '条件付き', '天候調査'];
  const idxs = words.map(w => t.indexOf(w)).filter(i => i >= 0);
  if (!idxs.length) return t.slice(0, maxLen);
  const i = Math.max(0, Math.min(...idxs) - 35);
  return t.slice(i, i + maxLen).trim();
}


function addCacheBuster(url) {
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}_=${Date.now()}`;
}

function detectHirodenCategory(blockText) {
  const t = compactText(blockText);

  // ページ上の実カテゴリを優先して判定する。
  // 「5号線」「6号線」は路面電車にも路線バスにも存在するため、ここを絶対に落とさない。
  if (/(^|\s)電車(\s|$)|市内線|宮島線/.test(t)) return '路面電車';
  if (/(^|\s)路線バス(\s|$)|広島市中心部エリア|郊外エリア|宮島口エリア|エキまちループ/.test(t)) return '路線バス';
  if (/(^|\s)高速乗合バス(\s|$)/.test(t)) return '高速乗合バス';
  if (/(^|\s)空港連絡バス(\s|$)/.test(t)) return '空港連絡バス';

  // どうしてもカテゴリが取れない場合、無理に「路線バス」と決め打ちしない。
  return '広電';
}

function normalizeHirodenRouteName(routeText, category = '') {
  let r = compactText(routeText)
    .replace(/^現在の運行情報\s*/g, '')
    .replace(/^広島市中心部エリア\s*/g, '')
    .replace(/^郊外エリア\s*/g, '')
    .replace(/^宮島口エリア\s*/g, '')
    .replace(/^市内線\s*/g, '')
    .replace(/^宮島線\s*/g, '宮島線 ')
    .replace(/^電車\s*/g, '')
    .replace(/^路線バス\s*/g, '')
    .replace(/^高速乗合バス\s*/g, '')
    .replace(/^空港連絡バス\s*/g, '')
    .trim();

  // エキまちループは 101/102/103 の番号が前に付くため、専用処理。
  const ekimachi = r.match(/101\s+102\s+103\s+エキまちループ|エキまちループ/);
  if (ekimachi) return 'エキまちループ';

  // 高速・空港連絡は号線とは限らないので、先頭の短い名称を優先。
  if (category === '高速乗合バス' || category === '空港連絡バス') {
    const named = r.match(/^([^\s]+(?:線|号|便|方面|行き|リムジン|エアポート|空港)[^\s]*)/);
    if (named) return named[1].slice(0, 42);
  }

  // 「12 5号線（牛田早稲田）」のような表記。
  const routeWithParen = r.match(/(?:\d+\s+)?(\d+号線（[^）]+）)/);
  if (routeWithParen) return routeWithParen[1];

  // 路面電車・路線バス共通で号線は拾う。ただし表示側でカテゴリを必ず付ける。
  const simpleNumbered = r.match(/(?:\d+\s+)?(\d+号線)/);
  if (simpleNumbered) return simpleNumbered[1];

  // 路面電車の系統名・線名。
  const streetcar = r.match(/(本線|宇品線|横川線|江波線|白島線|宮島線)[^\s]*/);
  if (streetcar) return streetcar[0];

  // バス系統など、最低限読める範囲で返す。
  return r.slice(0, 42).trim();
}

function extractHirodenLatestOfficialUpdateTime(text) {
  const raw = compactText(text);
  const currentIdx = raw.indexOf('現在の運行情報');
  const body = currentIdx >= 0 ? raw.slice(currentIdx) : raw;
  const detailIdx = body.indexOf('運行情報の詳細は以下の通りです');
  const target = detailIdx >= 0 ? body.slice(0, detailIdx) : body;

  const matches = [...target.matchAll(/20\d{2}\/\d{1,2}\/\d{1,2}\s+(\d{1,2}:\d{2})\s+更新/g)]
    .map(m => m[1]);
  if (!matches.length) return '';
  return matches.sort().slice(-1)[0];
}

function appendHirodenOfficialUpdate(text, officialUpdateTime) {
  if (!officialUpdateTime) return text;
  if (String(text || '').includes('広電公式')) return text;
  return `${text}（広電公式 ${officialUpdateTime}更新）`;
}

function makeHirodenOperationText(items) {
  if (!items.length) return '';

  // カテゴリ → 状態ごとにまとめる。これで「路面電車 5号線」と「路線バス 5号線」を混同しない。
  const byCatState = new Map();
  for (const x of items) {
    const key = `${x.category}||${x.state}`;
    if (!byCatState.has(key)) byCatState.set(key, []);
    const arr = byCatState.get(key);
    if (!arr.some(y => y.route === x.route)) arr.push(x);
  }

  const categoryOrder = ['路面電車', '路線バス', '高速乗合バス', '空港連絡バス', '広電'];
  const stateOrder = ['運転見合わせ', '運行見合わせ', '運休', '一部運休', '遅延', '迂回', '通行止め', 'ダイヤ乱れ'];
  const keys = [...byCatState.keys()].sort((a, b) => {
    const [ca, sa] = a.split('||');
    const [cb, sb] = b.split('||');
    const ci = categoryOrder.indexOf(ca), cj = categoryOrder.indexOf(cb);
    if (ci !== cj) return (ci < 0 ? 99 : ci) - (cj < 0 ? 99 : cj);
    const si = stateOrder.indexOf(sa), sj = stateOrder.indexOf(sb);
    return (si < 0 ? 99 : si) - (sj < 0 ? 99 : sj);
  });

  const parts = [];
  for (const key of keys) {
    const [category, state] = key.split('||');
    const arr = byCatState.get(key);
    const routes = arr.slice(0, 8).map(x => x.route).join('、');
    const latest = arr.map(x => x.time).sort().slice(-1)[0];
    const more = arr.length > 8 ? ` ほか${arr.length - 8}件` : '';
    parts.push(`${category} ${state}：${routes}${more}${latest ? `（${latest}更新）` : ''}`);
  }

  return parts.join(' ／ ');
}


function hasHirodenNoInfoText(text) {
  const t = compactText(text);

  // 広電ページの平常時文言は「ありません」だけでなく
  // 「お知らせする情報がございません」系になることがあります。
  // 冒頭説明文には「運行を中止」「大幅な遅れ」が常に含まれるため、
  // 先にこの平常文を拾っておかないと説明文を注意扱いしてしまいます。
  return [
    'お知らせする情報がございません',
    'お知らせする情報はございません',
    '運行情報がございません',
    '運行情報はございません',
    '現在お知らせする情報がございません',
    '現在お知らせする情報はございません',
    '現在お知らせする運行情報がございません',
    '現在お知らせする運行情報はございません',
    '現在お知らせする情報はありません',
    '現在、運行情報はありません',
    '現在、お知らせする情報はありません',
    '現在情報はありません',
  ].some(w => t.includes(w)) ||
    /現在[、,\s]*(?:お知らせする)?(?:運行)?情報[がは]?(?:ございません|ありません)/.test(t) ||
    /(?:お知らせする)?(?:運行)?情報[がは](?:ございません|ありません)/.test(t);
}

function extractHirodenOperations(text) {
  const raw = compactText(text);

  // 広電ページ冒頭の説明文には「運行を中止」「大幅な遅れ」が常に含まれるため、
  // そこは判定対象から外し、「現在の運行情報」以降だけを見る。
  let body = raw;
  const currentIdx = body.indexOf('現在の運行情報');
  if (currentIdx >= 0) body = body.slice(currentIdx);

  // 本当に情報がない場合の文言。
  // 「ございません」系も平常として扱う。
  if (hasHirodenNoInfoText(body) || hasHirodenNoInfoText(raw)) {
    return '';
  }

  // 日時付きの運行障害エントリが1件もない場合は、冒頭説明文の
  // 「運行を中止」「大幅な遅れ」だけに反応しないよう平常扱いにする。
  const hasDatedAbnormalEntry = /(20\d{2}\/\d{1,2}\/\d{1,2})\s+\d{1,2}:\d{2}\s+更新\s+(遅延|運休|運転見合わせ|運行見合わせ|一部運休|迂回|通行止め|ダイヤ乱れ)/.test(body);
  if (!hasDatedAbnormalEntry) {
    return '';
  }

  const detailIdx = body.indexOf('運行情報の詳細は以下の通りです');
  const summaryPart = detailIdx >= 0 ? body.slice(0, detailIdx) : body;
  const detailPart = detailIdx >= 0 ? body.slice(detailIdx) : body;

  // 上部の「現在の運行情報」一覧から取得。
  // カテゴリも保持し、「路面電車 5号線」と「路線バス 5号線」を分離する。
  const headMatches = [...summaryPart.matchAll(/(20\d{2}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+更新\s+(遅延|運休|運転見合わせ|運行見合わせ|一部運休|迂回|通行止め|ダイヤ乱れ)\s+([\s\S]*?)(?=20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+更新\s+(?:遅延|運休|運転見合わせ|運行見合わせ|一部運休|迂回|通行止め|ダイヤ乱れ)|運行情報の詳細は以下の通りです|$)/g)];

  const summaries = [];
  for (const m of headMatches) {
    const time = m[2];
    const state = m[3];
    const block = compactText(m[4]);
    if (/このページでは|ナビゲーション|到着時間|運行情報メニュー|天災や道路通行止め/.test(block)) continue;
    const category = detectHirodenCategory(block);
    const route = normalizeHirodenRouteName(block, category);
    if (!route) continue;
    summaries.push({ time, state, category, route });
  }

  if (summaries.length) {
    const msg = makeHirodenOperationText(summaries);
    if (msg) return msg;
  }

  // 一覧が取れない場合は、詳細ブロックから拾う。
  const matches = [...detailPart.matchAll(/(20\d{2}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+更新\s+(遅延|運休|運転見合わせ|運行見合わせ|一部運休|迂回|通行止め|ダイヤ乱れ)([\s\S]*?)(?=20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+更新\s+(?:遅延|運休|運転見合わせ|運行見合わせ|一部運休|迂回|通行止め|ダイヤ乱れ)|バス延着証明書の発行はこちら|詳しい運行状況は|$)/g)];

  const details = [];
  for (const m of matches) {
    const time = m[2];
    const state = m[3];
    const block = compactText(m[4]);
    if (/このページでは|ナビゲーション|到着時間|運行情報メニュー|天災や道路通行止め/.test(block)) continue;
    const category = detectHirodenCategory(block);
    const route = normalizeHirodenRouteName(block, category);
    if (!route) continue;
    const section = (block.match(/区間\s+([^事由程度詳細備考]+)/) || [])[1];
    const degree = (block.match(/程度\s+([^事由詳細備考]+)/) || [])[1];
    let routeText = route;
    if (section) routeText += ` 区間：${compactText(section)}`;
    if (degree) routeText += ` 程度：${compactText(degree)}`;
    details.push({ time, state, category, route: routeText });
  }

  if (details.length) {
    const msg = makeHirodenOperationText(details.slice(0, 8));
    if (msg) return msg;
  }

  // 詳細側の構造が変わった場合の保険。
  // ただし冒頭説明文の「大幅な遅れ」「運行を中止」はここには入れない。
  const summaryIdx = body.indexOf('運行情報の表題');
  const summary = summaryIdx >= 0 && detailIdx >= 0 ? body.slice(summaryIdx, detailIdx) : body;
  if (/(20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+更新\s+)?(?:遅延|運休|運転見合わせ|運行見合わせ|一部運休|迂回|通行止め|ダイヤ乱れ)/.test(summary)) {
    return excerptAbnormal(summary, 180);
  }

  return '';
}

async function getHirodenStatus() {
  const name = '広島電鉄';
  try {
    // 広電は解除済み情報が残って見えると実務上まぎらわしいため、
    // GitHub Actions/CDN/中間キャッシュをできるだけ避けて毎回取り直します。
    const fetchUrl = addCacheBuster(URLS.hiroden);
    const { text } = await fetchText(fetchUrl, 'hiroden');
    const officialUpdateTime = extractHirodenLatestOfficialUpdateTime(text);
    const ops = extractHirodenOperations(text);

    if (ops) {
      return makeItem(name, appendHirodenOfficialUpdate(ops, officialUpdateTime), '要確認', URLS.hiroden);
    }

    return makeItem(name, '平常運転', '平常運転', URLS.hiroden);
  } catch (e) {
    return errorItem(name, e, URLS.hiroden);
  }
}

async function getHiroshimaBusStatus() {
  const name = '広島バス';
  try {
    // 広島バスの運行情報ページはGitHub Actions環境から一時的に fetch failed になることがあるため、
    // キャッシュ回避URLで短いリトライを行う。
    const { text } = await fetchTextWithRetry(URLS.hiroshimaBus, 'hiroshima-bus', 30000, 3);
    if (hasNoInfoText(text)) return normalItem(name, URLS.hiroshimaBus);
    if (detectTransitAbnormal(text)) return makeItem(name, excerptAbnormal(text), '要確認', URLS.hiroshimaBus);
    return normalItem(name, URLS.hiroshimaBus);
  } catch (e) {
    // 取得失敗そのものはシステムエラーではなく「情報未確認」として扱う。
    // NG表示にするとダッシュボード全体が壊れたように見えるため、タクシー実務上は要確認に落とす。
    return makeItem(
      name,
      `一時的に公式運行情報ページへ接続できません。必要時は広島バス公式ページまたはくるけんを確認（${e.message || e}）`,
      '要確認',
      URLS.hiroshimaBus
    );
  }
}

async function getHiroshimaKotsuStatus() {
  const name = '広島交通';
  try {
    const { text } = await fetchText(URLS.hiroshimaKotsu, 'hiroshima-kotsu');
    if (hasNoInfoText(text)) return normalItem(name, URLS.hiroshimaKotsu);

    // 広島交通ページは説明文にも「運行状況」が出るため、実障害語だけで判定します。
    const meaningful = compactText(text)
      .replace(/台風や雪など天災の際に、路線バスの運行状況をお知らせいたします。/g, '')
      .replace(/情報更新には細心の注意を払っております/g, '');

    if (detectTransitAbnormal(meaningful)) return makeItem(name, excerptAbnormal(meaningful), '要確認', URLS.hiroshimaKotsu);
    return normalItem(name, URLS.hiroshimaKotsu);
  } catch (e) {
    return errorItem(name, e, URLS.hiroshimaKotsu);
  }
}

async function getAirportStatus() {
  // 広島空港のフライト表はページ表示後にJavaScriptで読み込まれるため、
  // JR西日本と同じく専用パーサーでPlaywright描画後のテキストを見ます。
  const { getAirportStatus: getAirportStatusFromParser } = require('./hiroshima-airport-parser');
  return await getAirportStatusFromParser();
}


function buildNpbMonthlyUrl(today = todayJstParts()) {
  // NPB公式の月別詳細ページ。例: https://npb.jp/games/2026/schedule_07_detail.html
  return `${URLS.npbMonthly}${today.year}/schedule_${today.mm}_detail.html`;
}

function extractDateSectionByNextDate(text, today = todayJstParts(), radius = 900) {
  const t = compactText(text);
  const day = Number(today.day);
  const month = Number(today.month);
  const datePatterns = [
    `${month}/${day}`,
    `${month}.${day}`,
    `${month}月${day}日`,
    today.ymdHyphen,
    today.ymdSlash,
  ];

  const indexes = datePatterns
    .map(p => t.indexOf(p))
    .filter(i => i >= 0);

  if (!indexes.length) return '';

  const start = Math.min(...indexes);
  const after = t.slice(start + 1);

  // 次の日付らしい見出しまでを当日セクションにする。
  const nextDate = after.search(/\b\d{1,2}[\/.]\d{1,2}(?:[（(][月火水木金土日][）)])?|\d{1,2}月\d{1,2}日/);
  if (nextDate >= 0) {
    return t.slice(start, start + 1 + nextDate).trim();
  }
  return t.slice(start, start + radius).trim();
}

function findAllIndexes(haystack, needle) {
  const out = [];
  if (!needle) return out;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) break;
    out.push(idx);
    pos = idx + Math.max(1, needle.length);
  }
  return out;
}

function extractNpbCarpHomeGame(text, today = todayJstParts()) {
  const t = compactText(text);
  const day = Number(today.day);
  const month = Number(today.month);

  // NPB公式ページには、上部の簡易日付リンクと本文の詳細欄の両方に同じ日付が出ます。
  // 以前は今日の日付から広めに2600文字を見ていたため、別日の「マツダスタジアム」を拾う誤検出がありました。
  // ここでは「今日の日付ブロック」かつ「同じ試合らしい短い範囲」に
  // 広島 + マツダ + 時刻 が揃う場合だけ本拠地開催扱いにします。
  const datePatterns = [
    today.ymdHyphen,
    today.ymdSlash,
    `${month}/${day}`,
    `${month}.${day}`,
    `${month}月${day}日`,
    `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    `${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`,
  ];

  const starts = [...new Set(
    datePatterns.flatMap(p => findAllIndexes(t, p))
  )].sort((a, b) => a - b);

  if (!starts.length) return null;

  const teams = [
    'ヤクルト', '巨人', '阪神', 'DeNA', 'ＤｅＮＡ', '中日', '広島',
    '日本ハム', '楽天', '西武', 'ロッテ', 'オリックス', 'ソフトバンク'
  ];

  const nextDateRe = /\b\d{1,2}[\/.]\d{1,2}(?:\s*[A-Za-z]{3}\.?)?|\d{1,2}月\d{1,2}日|\b20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}\b/g;

  function todaySectionFrom(start) {
    const afterStart = t.slice(start + 1);
    let next = -1;
    let m;
    while ((m = nextDateRe.exec(afterStart)) !== null) {
      const idx = start + 1 + m.index;
      // 近すぎるものは同じ日付表記の揺れとして無視。
      if (idx - start < 12) continue;
      next = idx;
      break;
    }

    const end = next > 0 ? next : Math.min(t.length, start + 1800);
    return t.slice(start, end).trim();
  }

  function splitGameLikeChunks(section) {
    const chunks = [];

    // 時刻を中心に前後を見る。試合ごとの情報が連続していても、別試合を巻き込みにくい。
    const timeMatches = [...section.matchAll(/\b\d{1,2}:\d{2}\b/g)];
    for (const m of timeMatches) {
      const i = m.index;
      const start = Math.max(0, i - 220);
      const end = Math.min(section.length, i + 220);
      chunks.push(section.slice(start, end));
    }

    const rough = section.split(/(?=ヤクルト|巨人|阪神|DeNA|ＤｅＮＡ|中日|広島|日本ハム|楽天|西武|ロッテ|オリックス|ソフトバンク)/);
    for (const c of rough) {
      if (/\b\d{1,2}:\d{2}\b/.test(c)) chunks.push(c.slice(0, 360));
    }

    return chunks.map(compactText).filter(Boolean);
  }

  let bestCandidate = null;

  for (const start of starts) {
    const section = todaySectionFrom(start);

    // 今日ブロック内に時刻がないものは、上部の単なる日付リンクの可能性が高い。
    if (!/\b\d{1,2}:\d{2}\b/.test(section)) continue;

    const chunks = splitGameLikeChunks(section);

    for (const chunk of chunks) {
      const hasMazda = /マツダスタジアム|マツダ|MAZDA|Zoom-Zoom|ズムスタ/i.test(chunk);
      const hasHiroshima = /広島/.test(chunk);
      const time = (chunk.match(/\b\d{1,2}:\d{2}\b/) || [])[0] || '';

      // 本拠地判定は「同じ短い試合範囲」に広島・マツダ・時刻が揃う場合のみ。
      // これにより、7/11 中日－広島 バンテリンドームのようなビジター試合では検出しない。
      if (!hasMazda || !hasHiroshima || !time) continue;

      let opponent = '';
      for (const team of teams) {
        if (team === '広島') continue;
        const re1 = new RegExp(`広島.{0,80}${team}`);
        const re2 = new RegExp(`${team}.{0,80}広島`);
        if (re1.test(chunk) || re2.test(chunk)) {
          opponent = team.replace('ＤｅＮＡ', 'DeNA');
          break;
        }
      }

      const candidate = { opponent, time, section: chunk };
      if (opponent) return candidate;
      if (!bestCandidate) bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function extractSanfrecceTodayHomeGame(text, today = todayJstParts()) {
  const t = compactText(text);
  const month = Number(today.month);
  const day = Number(today.day);

  // サンフレッチェ公式は「8.8 土 19:15」のような試合カード。
  // 日付が一致する試合カードだけを見る。ページ上の別日のHOME/試合詳細に反応しない。
  const dateRegex = new RegExp(`(?:^|\\s)${month}[\\./]${day}\\s*(?:[月火水木金土日])?\\s+\\d{1,2}:\\d{2}`);
  const m = t.match(dateRegex);
  if (!m) return null;

  const start = Math.max(0, m.index - 120);
  const section = t.slice(start, m.index + 520);
  const isHome = /HOME/.test(section) && /エディオンピースウイング広島|Ｅピース|Eピース/.test(section);
  const isMatch = /明治安田|J1|Jリーグ|ルヴァン|天皇杯|試合詳細/.test(section);

  if (!isHome || !isMatch) return null;

  const time = (section.match(/\b\d{1,2}:\d{2}\b/) || [])[0] || '';
  const opponent = (section.match(/(?:Image\s*)?([^\s]+)\s+(?:試合詳細|放映|DAZN)/) || [])[1] || '';

  return { time, opponent, section };
}

function extractTodayWindow(text, radius = 220) {
  const today = todayJstParts();
  const t = compactText(text);
  const patterns = [
    today.ymdHyphen,
    today.ymdSlash,
    today.mdKanji,
    today.mdSlash,
    today.mdDot,
    `${Number(today.month)}${Number(today.day)}`,
  ];
  const idxs = patterns.map(p => t.indexOf(p)).filter(i => i >= 0);
  if (!idxs.length) return '';
  const i = Math.min(...idxs);
  return t.slice(Math.max(0, i - radius), i + radius).trim();
}

async function getCarpStatus() {
  const name = 'カープ本拠地開催';
  const today = todayJstParts();
  const npbUrl = buildNpbMonthlyUrl(today);

  try {
    // カープ公式カレンダーは月ページや表示形式の揺れがあるため、
    // 本拠地開催判定はNPB公式の月別詳細ページを主判定にする。
    const { text } = await fetchText(npbUrl, 'npb-carp');
    const game = extractNpbCarpHomeGame(text, today);

    if (game) {
      return makeItem(
        name,
        `本日${today.mdKanji} マツダスタジアム開催${game.opponent ? `：広島－${game.opponent}` : 'あり'}${game.time ? `（${game.time}）` : ''}。広島駅・球場周辺の混雑に注意`,
        '要確認',
        npbUrl
      );
    }

    return makeItem(name, '本拠地開催なし', '平常', npbUrl);
  } catch (e) {
    // NPB取得失敗時だけ、従来のカープ公式カレンダーにフォールバック。
    try {
      const { text } = await fetchText(URLS.carp, 'carp-fallback');
      const w = extractTodayWindow(text, 320);
      const isHome = Boolean(w) && /マツダ|MAZDA|Zoom-Zoom|ズムスタ/.test(w) && /(\d{1,2}:\d{2}|試合|空席|詳細|スポンサードゲーム)/.test(w);
      if (isHome) {
        const time = (w.match(/\b\d{1,2}:\d{2}\b/) || [])[0];
        return makeItem(name, `本日${today.mdKanji} マツダスタジアム開催の可能性あり${time ? `（${time}）` : ''}。広島駅・球場周辺の混雑に注意`, '要確認', URLS.carp);
      }
      return makeItem(name, '本拠地開催なし', '平常', URLS.carp);
    } catch (fallbackError) {
      return errorItem(name, fallbackError, npbUrl);
    }
  }
}

async function getSanfrecceStatus() {
  const name = 'サンフレッチェ開催';
  const today = todayJstParts();

  try {
    const { text } = await fetchText(URLS.sanfrecce, 'sanfrecce');
    const game = extractSanfrecceTodayHomeGame(text, today);

    if (game) {
      return makeItem(
        name,
        `本日${today.mdKanji} エディオンピースウイング広島開催の可能性あり${game.time ? `（${game.time}）` : ''}。紙屋町・基町周辺の混雑に注意`,
        '要確認',
        URLS.sanfrecce
      );
    }

    return makeItem(name, '本拠地開催なし', '平常', URLS.sanfrecce);
  } catch (e) {
    return errorItem(name, e, URLS.sanfrecce);
  }
}

async function safeGet(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[${label}] unexpected error`, e);
    return errorItem(label, e);
  }
}

async function main() {
  ensureDir(path.dirname(OUT_PATH));
  ensureDir(DEBUG_DIR);

  const { getJrStatuses } = requireJrParser();

  // 表示順固定：ユーザー指定どおり
  const weatherStatus = await safeGet('広島市中心天気', getWeatherStatus);
  const sanyoShinkansenStatus = await safeGet('山陽新幹線', getSanyoShinkansenStatus);
  const jrStatuses = await safeGet('JR西日本', getJrStatuses);
  const hirodenStatus = await safeGet('広島電鉄', getHirodenStatus);
  const hiroshimaBusStatus = await safeGet('広島バス 路線バス', getHiroshimaBusStatus);
  const hiroshimaKotsuStatus = await safeGet('広島交通 路線バス', getHiroshimaKotsuStatus);
  const airportStatus = await safeGet('広島空港', getAirportStatus);
  const carpStatus = await safeGet('カープ本拠地開催', getCarpStatus);
  const sanfrecceStatus = await safeGet('サンフレッチェ開催', getSanfrecceStatus);

  const items = [
    weatherStatus,
    sanyoShinkansenStatus,
    ...(Array.isArray(jrStatuses) ? jrStatuses : [jrStatuses]),
    hirodenStatus,
    hiroshimaBusStatus,
    hiroshimaKotsuStatus,
    airportStatus,
    carpStatus,
    sanfrecceStatus,
  ].filter(Boolean).map(normalizeDashboardItem);

  const checkedAt = nowIsoJst();
  const memo = items.map(x => x.memo || `${x.name || x.title || x.label}：${x.message || x.text || x.detail || x.status || ''}`).join('\n');

  const payload = {
    updated_at: checkedAt,
    updatedAt: checkedAt,
    generated_at: checkedAt,
    generatedAt: checkedAt,
    checked_at: checkedAt,
    checkedAt: checkedAt,

    // 新旧どちらの auto/index.html でも読めるように同じ配列を複数キーで保持します。
    items,
    checks: items,
    statuses: items,
    results: items,
    data: items,

    memo,
    auto_memo: memo,
    autoMemo: memo,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');

  console.log('\n[OK] wrote auto/data/status.json');
  console.log('[OK] auto巡回メモ:');
  for (const item of items) console.log(`- ${item.memo}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

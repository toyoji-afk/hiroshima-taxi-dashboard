// update-status.js v48: Hiroden category-aware parser fix + JMA/JR/airport stable version
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
  weather: 'https://www.jma.go.jp/bosai/forecast/data/forecast/340000.json',
  weatherOverview: 'https://www.jma.go.jp/bosai/forecast/data/overview_forecast/340000.json',
  hiroden: 'https://www.hiroden.co.jp/traffic/info/',
  hiroshimaBus: 'https://hirobus-info-rosen.jp/',
  hiroshimaKotsu: 'https://www.hiroko-group.co.jp/kotsu/rosen_unkou.htm',
  airportDomesticDepartures: 'https://www.hij.airport.jp/flight/flight_dd.html',
  airportDomesticArrivals: 'https://www.hij.airport.jp/flight/flight_ad.html',
  airportInternationalDepartures: 'https://www.hij.airport.jp/flight/flight_id.html',
  airportInternationalArrivals: 'https://www.hij.airport.jp/flight/flight_ia.html',
  carp: 'https://www.ticket.carp.co.jp/calendar/',
  sanfrecce: 'https://www.sanfrecce.co.jp/matches/results',
};

const USER_AGENT = 'Mozilla/5.0 GitHubActions HiroshimaTaxiDashboard/44.0';

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
  const normalMessage = /平常|大きな乱れ情報なし|表示なし|検出なし|通常運行|通常通り|運行情報はありません/.test(`${status} ${body}`);
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
  return makeItem(name, '平常・大きな乱れ情報なし', '平常運転', source);
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
      },
      signal: controller.signal,
    });
    const body = await res.text();
    console.log(`[fetch] ${label}: status=${res.status} length=${body.length}`);
    writeDebug(`${label}.html`, body);
    const text = htmlToText(body);
    writeDebug(`${label}.txt`, text);
    return { ok: res.ok, status: res.status, html: body, text };
  } finally {
    clearTimeout(timer);
  }
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

async function getWeatherStatus() {
  const name = '広島市周辺天気';
  const source = 'https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=340000';
  try {
    const res = await fetch(URLS.weather, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'ja,en-US;q=0.9' } });
    const json = await res.json();
    writeDebug('jma-forecast.json', JSON.stringify(json, null, 2));

    const first = Array.isArray(json) ? json[0] : json;
    const ts = first?.timeSeries || [];
    const today = todayJstParts();
    const todayDate = `${today.year}-${today.month}-${today.day}`;

    const weatherTs = ts[0] || {};
    const weatherArea = pickArea(weatherTs.areas, ['南部', '広島県南部', '広島']);
    const weatherIndex = pickTodayIndex(weatherTs.timeDefines, todayDate, 0);
    const weather = cleanJmaText(weatherArea?.weathers?.[weatherIndex] || weatherArea?.weathers?.[0] || '天気予報を確認');

    const popTs = ts.find(x => Array.isArray(x.areas) && x.areas.some(a => Array.isArray(a.pops))) || {};
    const popArea = pickArea(popTs.areas, ['南部', '広島県南部', '広島']);
    const popParts = buildPopParts(popTs.timeDefines || [], popArea?.pops || [], todayDate);

    const tempTs = ts.find(x => Array.isArray(x.areas) && x.areas.some(a => Array.isArray(a.temps) || Array.isArray(a.tempsMax) || Array.isArray(a.tempsMin))) || {};
    const tempArea = pickArea(tempTs.areas, ['広島', '南部', '広島県南部']);
    const tempInfo = buildTempInfo(tempTs.timeDefines || [], tempArea || {}, todayDate);

    const body = [
      weather,
      tempInfo ? tempInfo : '',
      popParts.length ? `降水確率 ${popParts.map(p => `${p.label}${p.percent}%`).join('／')}` : '',
    ].filter(Boolean).join('　');

    // 天気は本文に降水確率まで出せば十分なので、雨・雷でも取得成功ならOK扱いにします。
    return makeItem(name, body || '気象庁の天気予報を確認', '平常', source);
  } catch (e) {
    return errorItem(name, e, source);
  }
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

function extractHirodenOperations(text) {
  const raw = compactText(text);

  // 広電ページ冒頭の説明文には「運行を中止」「大幅な遅れ」が常に含まれるため、
  // そこは判定対象から外し、「現在の運行情報」以降だけを見る。
  let body = raw;
  const currentIdx = body.indexOf('現在の運行情報');
  if (currentIdx >= 0) body = body.slice(currentIdx);

  // 本当に情報がない場合の文言。
  if (/現在(お知らせする)?運行情報はありません|現在、お知らせする情報はありません|現在情報はありません/.test(body)) {
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
    const { text } = await fetchText(URLS.hiroden, 'hiroden');
    const ops = extractHirodenOperations(text);
    if (ops) return makeItem(name, ops, '要確認', URLS.hiroden);
    return normalItem(name, URLS.hiroden);
  } catch (e) {
    return errorItem(name, e, URLS.hiroden);
  }
}

async function getHiroshimaBusStatus() {
  const name = '広島バス 路線バス';
  try {
    const { text } = await fetchText(URLS.hiroshimaBus, 'hiroshima-bus');
    if (hasNoInfoText(text)) return normalItem(name, URLS.hiroshimaBus);
    if (detectTransitAbnormal(text)) return makeItem(name, excerptAbnormal(text), '要確認', URLS.hiroshimaBus);
    return makeItem(name, '公式運行情報ページを確認（大きな乱れ情報なし想定）', '確認', URLS.hiroshimaBus);
  } catch (e) {
    return errorItem(name, e, URLS.hiroshimaBus);
  }
}

async function getHiroshimaKotsuStatus() {
  const name = '広島交通 路線バス';
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
  const name = '広島空港';
  try {
    const pages = [
      ['国内線出発', URLS.airportDomesticDepartures],
      ['国内線到着', URLS.airportDomesticArrivals],
      ['国際線出発', URLS.airportInternationalDepartures],
      ['国際線到着', URLS.airportInternationalArrivals],
    ];
    const texts = [];
    for (const [label, url] of pages) {
      try {
        const { text } = await fetchText(url, `airport-${label}`);
        texts.push(`${label} ${text}`);
      } catch (e) {
        console.log(`[airport] ${label} failed: ${e.message}`);
      }
    }
    const all = texts.join(' ');
    const abnormalWords = ['欠航', '遅延', '条件付き', '天候調査', '引き返し', '目的地変更', '欠便'];
    const found = abnormalWords.filter(w => all.includes(w));
    if (found.length) {
      return makeItem(name, `${[...new Set(found)].join('・')}の表示あり。詳細は公式フライト情報を確認`, '要確認', URLS.airportDomesticDepartures);
    }
    return makeItem(name, '平常・大きな乱れ情報なし。空港送迎前は公式フライト情報を確認', '平常運転', URLS.airportDomesticDepartures);
  } catch (e) {
    return errorItem(name, e, URLS.airportDomesticDepartures);
  }
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
  try {
    const { text } = await fetchText(URLS.carp, 'carp');
    const w = extractTodayWindow(text, 260);
    const today = todayJstParts();
    const hasToday = Boolean(w);
    const isHome = /マツダ|MAZDA|Zoom-Zoom|ズムスタ|広島/.test(w) && /(\d{1,2}:\d{2}|試合|空席|詳細|スポンサードゲーム)/.test(w);
    if (hasToday && isHome) {
      const time = (w.match(/\b\d{1,2}:\d{2}\b/) || [])[0];
      return makeItem(name, `本日${today.mdKanji} マツダスタジアム開催の可能性あり${time ? `（${time}）` : ''}。広島駅・球場周辺の混雑に注意`, '要確認', URLS.carp);
    }
    return makeItem(name, `本日${today.mdKanji}の本拠地開催は検出なし`, '平常', URLS.carp);
  } catch (e) {
    return errorItem(name, e, URLS.carp);
  }
}

async function getSanfrecceStatus() {
  const name = 'サンフレッチェ広島開催';
  try {
    const { text } = await fetchText(URLS.sanfrecce, 'sanfrecce');
    const w = extractTodayWindow(text, 280);
    const today = todayJstParts();
    const isHome = /HOME|エディオンピースウイング|Ｅピース|Eピース|広島/.test(w) && /(\d{1,2}:\d{2}|試合詳細|明治安田|J1|ルヴァン|天皇杯)/.test(w);
    if (w && isHome) {
      const time = (w.match(/\b\d{1,2}:\d{2}\b/) || [])[0];
      return makeItem(name, `本日${today.mdKanji} エディオンピースウイング広島開催の可能性あり${time ? `（${time}）` : ''}。紙屋町・基町周辺の混雑に注意`, '要確認', URLS.sanfrecce);
    }
    return makeItem(name, `本日${today.mdKanji}の本拠地開催は検出なし`, '平常', URLS.sanfrecce);
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
  const weatherStatus = await safeGet('広島市周辺天気', getWeatherStatus);
  const jrStatuses = await safeGet('JR西日本', getJrStatuses);
  const hirodenStatus = await safeGet('広島電鉄', getHirodenStatus);
  const hiroshimaBusStatus = await safeGet('広島バス 路線バス', getHiroshimaBusStatus);
  const hiroshimaKotsuStatus = await safeGet('広島交通 路線バス', getHiroshimaKotsuStatus);
  const airportStatus = await safeGet('広島空港', getAirportStatus);
  const carpStatus = await safeGet('カープ本拠地開催', getCarpStatus);
  const sanfrecceStatus = await safeGet('サンフレッチェ広島開催', getSanfrecceStatus);

  const items = [
    weatherStatus,
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

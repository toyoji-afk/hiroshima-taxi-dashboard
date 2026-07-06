// update-status.js v39 final
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
  weather: 'https://api.open-meteo.com/v1/forecast?latitude=34.3853&longitude=132.4553&current=temperature_2m,weather_code,precipitation,wind_speed_10m&hourly=precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=1',
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

const USER_AGENT = 'Mozilla/5.0 GitHubActions HiroshimaTaxiDashboard/39.0';

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

function makeItem(name, memoBody, status = '確認', source = '') {
  return {
    name,
    title: name,
    status,
    memo: `${name}：${memoBody}`,
    url: source,
    source,
    updated_at: nowIsoJst(),
  };
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
  try {
    const res = await fetch(URLS.weather, { headers: { 'user-agent': USER_AGENT } });
    const json = await res.json();
    const current = json.current || {};
    const daily = json.daily || {};
    const code = Number(current.weather_code ?? daily.weather_code?.[0]);
    const desc = weatherCodeToJapanese(code);
    const temp = num(current.temperature_2m);
    const wind = num(current.wind_speed_10m);
    const precip = num(current.precipitation);
    const pop = daily.precipitation_probability_max?.[0];
    const max = daily.temperature_2m_max?.[0];
    const min = daily.temperature_2m_min?.[0];

    const caution = [];
    if (Number(pop) >= 50) caution.push(`降水確率${pop}%`);
    if (Number(precip) > 0) caution.push(`現在降水${precip}mm`);
    if (Number(wind) >= 8) caution.push(`風${wind}m/s`);

    const body = [
      desc,
      temp !== '' ? `現在${temp}℃` : '',
      max != null && min != null ? `最高${num(max)}℃／最低${num(min)}℃` : '',
      pop != null ? `降水確率${pop}%` : '',
      wind !== '' ? `風${wind}m/s` : '',
      caution.length ? `注意：${caution.join('・')}` : '',
    ].filter(Boolean).join('　');

    const status = caution.length ? '注意' : '確認';
    return makeItem(name, body || '天気情報を確認', status, 'https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=340000');
  } catch (e) {
    return errorItem(name, e, 'https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=340000');
  }
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

async function getHirodenStatus() {
  const name = '広島電鉄';
  try {
    const { text } = await fetchText(URLS.hiroden, 'hiroden');
    if (hasNoInfoText(text)) return normalItem(name, URLS.hiroden);
    if (detectTransitAbnormal(text)) return makeItem(name, excerptAbnormal(text), '要確認', URLS.hiroden);
    return makeItem(name, '公式運行情報ページを確認（大きな乱れ情報なし想定）', '確認', URLS.hiroden);
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
    return makeItem(name, '公式運行状況ページを確認（掲載障害なし想定）', '確認', URLS.hiroshimaKotsu);
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
    return makeItem(name, '大きな欠航・遅延表示なし想定。空港送迎前は公式フライト情報を確認', '確認', URLS.airportDomesticDepartures);
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
  ].filter(Boolean);

  const payload = {
    updated_at: nowIsoJst(),
    generated_at: nowIsoJst(),
    items,
    memo: items.map(x => x.memo || `${x.name}：${x.status || ''}`).join('\n'),
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

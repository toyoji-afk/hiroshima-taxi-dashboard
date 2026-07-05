const fs = require("fs/promises");

const sources = [
  {
    id: "jartic",
    label: "JARTIC 広島",
    url: "https://www.jartic.or.jp/map/?p=R34",
    keywords: ["通行止", "渋滞", "事故", "規制", "注意"]
  },
  {
    id: "roadnavi",
    label: "ひろしま道路ナビ",
    url: "https://www.roadnavi.pref.hiroshima.lg.jp/",
    keywords: ["通行止", "規制", "片側交互", "冬用タイヤ", "災害"]
  },
  {
    id: "jr",
    label: "JR西日本 中国エリア",
    url: "https://trafficinfo.westjr.co.jp/chugoku.html",
    keywords: ["遅延", "運転見合わせ", "運休", "お知らせ", "列車に遅れ"]
  },
  {
    id: "hiroden",
    label: "広島電鉄",
    url: "https://www.hiroden.co.jp/traffic/info/",
    keywords: ["運休", "遅れ", "遅延", "運転見合わせ", "運行情報"]
  },
  {
    id: "hiroshima-airport",
    label: "広島空港",
    url: "https://www.hij.airport.jp/flight/flight_da.html",
    keywords: ["遅延", "欠航", "条件付", "到着済", "出発済"]
  },
  {
    id: "carp",
    label: "カープ日程",
    url: "https://www.ticket.carp.co.jp/calendar/",
    keywords: ["マツダ スタジアム", "試合", "広島", "チケット"]
  },
  {
    id: "sanfrecce",
    label: "サンフレッチェ日程",
    url: "https://www.sanfrecce.co.jp/matches/results",
    keywords: ["試合", "エディオンピースウイング", "広島", "チケット"]
  }
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toJstString(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  }).format(date);
}

async function checkSource(source) {
  try {
    const res = await fetch(source.url, {
      headers: {
        "user-agent": "Mozilla/5.0 GitHubActions hiroshima-taxi-dashboard personal checker"
      }
    });

    if (!res.ok) {
      return {
        label: source.label,
        url: source.url,
        level: "error",
        message: `取得失敗（HTTP ${res.status}）。公式リンクで確認`
      };
    }

    const html = await res.text();
    const text = stripHtml(html);
    const hits = source.keywords.filter(k => text.includes(k));

    if (hits.length) {
      return {
        label: source.label,
        url: source.url,
        level: "alert",
        message: `要確認キーワードあり：${hits.slice(0, 4).join("、")}`
      };
    }

    return {
      label: source.label,
      url: source.url,
      level: "ok",
      message: "取得OK。目立つ要確認語なし"
    };
  } catch (error) {
    return {
      label: source.label,
      url: source.url,
      level: "error",
      message: "取得できませんでした。公式リンクで確認"
    };
  }
}

async function main() {
  const items = [];
  for (const source of sources) {
    items.push(await checkSource(source));
  }

  const now = new Date();
  const data = {
    updatedAt: now.toISOString(),
    updatedAtJst: toJstString(now),
    items
  };

  await fs.mkdir("auto/data", { recursive: true });
  await fs.writeFile("auto/data/status.json", JSON.stringify(data, null, 2), "utf8");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

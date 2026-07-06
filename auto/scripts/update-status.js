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
    keywords: ["遅延", "運転見合わせ", "運休", "列車に遅れ"]
  },
  {
    id: "hiroden",
    label: "広島電鉄",
    url: "https://www.hiroden.co.jp/traffic/info/",
    keywords: ["運休", "遅れ", "遅延", "運転見合わせ"]
  },
  {
    id: "hiroshima-bus",
    label: "広島バス 路線バス",
    url: "https://hirobus-info-rosen.jp/",
    keywords: ["通常運行", "運休", "遅延発生", "大幅遅延", "運行見合わせ", "迂回運行", "欠便"],
    mode: "bus-operation"
  },
  {
    id: "hiroshima-kotsu",
    label: "広島交通 路線バス",
    url: "https://www.hiroko-group.co.jp/kotsu/rosen_unkou.htm",
    keywords: ["通常運行", "平常運行", "運休", "遅延発生", "大幅遅延", "運行見合わせ", "迂回運行", "欠便"],
    mode: "bus-operation"
  },
  {
    id: "hiroshima-airport",
    label: "広島空港",
    url: "https://www.hij.airport.jp/flight/flight_da.html",
    keywords: ["遅延", "欠航", "条件付"]
  }
];

const eventSources = [
  {
    id: "carp-home",
    label: "カープ本拠地開催",
    url: "https://www.ticket.carp.co.jp/calendar/",
    venueKeywords: ["マツダ スタジアム", "マツダスタジアム", "MAZDA Zoom-Zoom スタジアム", "ズムスタ"]
  },
  {
    id: "sanfrecce-home",
    label: "サンフレッチェ広島開催",
    url: "https://www.sanfrecce.co.jp/matches/results",
    venueKeywords: ["エディオンピースウイング", "エディオンピースウイング広島", "Eピース", "広島"]
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

function toJstDate(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
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

function todayPatternsJst() {
  const now = toJstDate();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return [
    `${y}/${mm}/${dd}`,
    `${y}-${mm}-${dd}`,
    `${m}/${d}`,
    `${mm}/${dd}`,
    `${m}月${d}日`,
    `${mm}月${dd}日`
  ];
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 GitHubActions hiroshima-taxi-dashboard personal checker"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}


function stripNoticeLikeText(text) {
  return text
    .replace(/お知らせ[\s\S]*/g, "")
    .replace(/ニュース[\s\S]*/g, "")
    .replace(/新着情報[\s\S]*/g, "")
    .replace(/工事のお知らせ[\s\S]*/g, "")
    .replace(/イベント[\s\S]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function judgeBusOperation(rawText) {
  const text = stripNoticeLikeText(rawText);

  // 「遅延する恐れ」「可能性」「予定」「工事」などは、
  // “現在発生中の異常”としては拾いすぎない。
  const uncertainPattern = /(恐れ|おそれ|可能性|予定|工事|交通規制|規制に伴|事前案内|予告|見込み)/;
  const seriousPattern = /(運休|運転見合わせ|見合わせ|運行見合わせ|欠便|大幅な遅れ|大幅遅延|遅延発生|遅れが発生|迂回運行|運行休止|運行停止)/;
  const normalPattern = /(通常運行|平常運行|正常運行|概ね通常|おおむね通常|現在、?平常どおり|現在、?通常どおり)/;

  const seriousMatch = text.match(seriousPattern);
  if (seriousMatch) {
    const idx = text.indexOf(seriousMatch[0]);
    const context = text.slice(Math.max(0, idx - 40), idx + 80);

    if (uncertainPattern.test(context)) {
      return {
        level: "ok",
        message: "明確な遅延・運休情報なし。お知らせ欄は必要時確認"
      };
    }

    return {
      level: "alert",
      message: "遅延・運休などの可能性あり。公式ページで確認"
    };
  }

  if (normalPattern.test(text)) {
    return {
      level: "ok",
      message: "通常運行"
    };
  }

  return {
    level: "ok",
    message: "明確な遅延・運休情報なし。詳細は公式ページで確認"
  };
}

async function checkSource(source) {
  try {
    const html = await fetchText(source.url);

    if (source.mode === "bus-operation") {
      const result = judgeBusOperation(html);
      return {
        label: source.label,
        url: source.url,
        level: result.level,
        message: result.message
      };
    }
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

async function checkHomeEvent(source) {
  try {
    const html = await fetchText(source.url);
    const text = stripHtml(html);
    const dateHit = todayPatternsJst().some(p => text.includes(p));
    const venueHit = source.venueKeywords.some(k => text.includes(k));

    if (dateHit && venueHit) {
      return {
        label: source.label,
        url: source.url,
        level: "alert",
        message: "本日、広島市内開催の可能性あり。公式日程を確認"
      };
    }

    if (dateHit && !venueHit) {
      return {
        label: source.label,
        url: source.url,
        level: "ok",
        message: "本日の日付は検出。ただし広島市内開催語は未検出"
      };
    }

    return {
      label: source.label,
      url: source.url,
      level: "ok",
      message: "本日の広島市内開催は検出なし"
    };
  } catch (error) {
    return {
      label: source.label,
      url: source.url,
      level: "error",
      message: "取得できませんでした。公式日程で確認"
    };
  }
}

function findAreaTimeSeries(data, areaNames) {
  for (const block of data) {
    for (const ts of block.timeSeries || []) {
      for (const area of ts.areas || []) {
        if (areaNames.some(name => area.area?.name?.includes(name))) {
          return { timeSeries: ts, area };
        }
      }
    }
  }
  return null;
}

async function checkWeather() {
  const url = "https://www.jma.go.jp/bosai/forecast/data/forecast/340000.json";
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 GitHubActions hiroshima-taxi-dashboard weather checker" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 気象庁JSONは時系列が複数に分かれているため、
    // 「今日」の先頭データだけを使う。明日の概況は表示しない。
    const firstBlock = data[0];
    const timeSeries = firstBlock?.timeSeries || [];

    const weatherTs = timeSeries.find(ts =>
      (ts.areas || []).some(area =>
        area.weathers && (area.area?.name?.includes("広島") || area.area?.name?.includes("南部"))
      )
    );

    const weatherArea = weatherTs?.areas?.find(area =>
      area.weathers && (area.area?.name?.includes("広島") || area.area?.name?.includes("南部"))
    );

    const popTs = timeSeries.find(ts =>
      (ts.areas || []).some(area =>
        area.pops && (area.area?.name?.includes("広島") || area.area?.name?.includes("南部"))
      )
    );

    const popArea = popTs?.areas?.find(area =>
      area.pops && (area.area?.name?.includes("広島") || area.area?.name?.includes("南部"))
    );

    // 気温は2つ目のブロックにあることが多い。
    // 広島エリアの今日の最高気温らしき値だけを拾う。
    let maxTemp = "";
    for (const block of data) {
      for (const ts of block.timeSeries || []) {
        for (const area of ts.areas || []) {
          const areaName = area.area?.name || "";
          if ((areaName.includes("広島") || areaName.includes("南部")) && area.temps) {
            const nums = area.temps
              .map(v => Number(v))
              .filter(v => Number.isFinite(v));
            if (nums.length) {
              maxTemp = String(Math.max(...nums));
              break;
            }
          }
        }
        if (maxTemp) break;
      }
      if (maxTemp) break;
    }

    const todayWeather = weatherArea?.weathers?.[0] || "";

    // popsは発表時刻により 00-06 / 06-12 / 12-18 / 18-24 など。
    // 乗務前チェック用に、前半・後半の目安としてまとめる。
    const pops = (popArea?.pops || []).filter(v => v !== "");
    let popText = "";
    if (pops.length >= 4) {
      const morningVals = pops.slice(0, 2).map(Number).filter(Number.isFinite);
      const afternoonVals = pops.slice(2, 4).map(Number).filter(Number.isFinite);
      const morning = morningVals.length ? Math.max(...morningVals) : pops[0];
      const afternoon = afternoonVals.length ? Math.max(...afternoonVals) : pops[2];
      popText = `降水確率 午前目安 ${morning}%、午後目安 ${afternoon}%`;
    } else if (pops.length >= 2) {
      popText = `降水確率 午前目安 ${pops[0]}%、午後目安 ${pops[1]}%`;
    } else if (pops.length === 1) {
      popText = `降水確率 ${pops[0]}%`;
    }

    const tempText = maxTemp ? `最高気温 ${maxTemp}℃` : "";
    const msg = [
      todayWeather ? `今日 ${todayWeather}` : "",
      popText,
      tempText
    ].filter(Boolean).join("／") || "今日の天気情報を取得。詳細は気象庁で確認";

    const level = /雨|雪|雷|荒/.test(msg) || /([6-9]0|100)%/.test(msg) ? "alert" : "ok";

    return {
      label: "広島市周辺天気",
      url: "https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=340000",
      level,
      message: msg
    };
  } catch (error) {
    return {
      label: "広島市周辺天気",
      url: "https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=340000",
      level: "error",
      message: "天気情報を取得できませんでした。気象庁で確認"
    };
  }
}
async function main() {
  const items = [];

  // Weather first because it affects the whole shift.
  items.push(await checkWeather());

  for (const source of sources) {
    items.push(await checkSource(source));
  }

  for (const source of eventSources) {
    items.push(await checkHomeEvent(source));
  }

  const now = new Date();
  const data = {
    updatedAt: now.toISOString(),
    updatedAtJst: toJstString(now),
    scheduleNote: "JST 00:00 / 06:00 / 12:00 / 18:00 目安で更新",
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

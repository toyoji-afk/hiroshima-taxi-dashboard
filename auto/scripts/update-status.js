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





function checkKeywords(textOrHtml, keywords) {
  const text = stripHtml(textOrHtml);
  const found = keywords.filter(k => text.includes(k));
  return {
    level: found.length ? "alert" : "ok",
    found
  };
}

function toCleanLinesFromHtml(html) {
  return stripHtml(html)
    .replace(/。/g, "。\n")
    .replace(/詳細・備考/g, "\n詳細・備考 ")
    .replace(/復旧見込/g, "\n復旧見込 ")
    .replace(/程度/g, "\n程度 ")
    .replace(/事由/g, "\n事由 ")
    .replace(/区間/g, "\n区間 ")
    .replace(/\s+/g, " ")
    .split(/\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractHirodenBusText(html) {
  const text = stripHtml(html)
    .replace(/。/g, "。\n")
    .replace(/(20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+更新)/g, "\n$1")
    .replace(/(区間|程度|復旧見込|事由|詳細・備考)/g, "\n$1 ");

  // まず「詳細」欄から探す。上部の一覧やナビを誤って拾わないため。
  const detailMarker = "運行情報の詳細は以下の通りです";
  const detailStart = text.indexOf(detailMarker);
  const detailText = detailStart !== -1 ? text.slice(detailStart + detailMarker.length) : text;

  // 詳細欄の中で「路線バス」を探す。
  // 実際のHTMLをstripHtmlした文字列では "## 路線バス" ではなく
  // 単に "路線バス" になるため、ここを広く見る。
  const busStart = detailText.indexOf("路線バス");
  if (busStart === -1) return "";

  const afterBus = detailText.slice(busStart);

  // 路線バス欄の終端。高速・空港バスなどが続く場合はそこで切る。
  const endMarkers = [
    "高速乗合バス",
    "空港連絡バス",
    "遅延証明",
    "電車運行案内"
  ];

  let end = afterBus.length;
  for (const marker of endMarkers) {
    const idx = afterBus.indexOf(marker, 10);
    if (idx !== -1 && idx < end) end = idx;
  }

  return afterBus.slice(0, end);
}

function splitHirodenBusRecords(busText) {
  const normalized = busText
    .replace(/\r/g, "")
    .replace(/(20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+更新)/g, "\n$1")
    .replace(/\n\s+/g, "\n")
    .trim();

  return normalized
    .split(/\n(?=20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s+更新)/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.includes("更新"));
}

function getHirodenRouteStatus(record) {
  const statusMatch = record.match(/更新\s+(運休|運行見合わせ|運転見合わせ|見合わせ|遅延|迂回|欠便)/);
  let status = statusMatch ? statusMatch[1] : "";

  if (!status) {
    if (/運休|運行見合わせ|運転見合わせ|見合わせ|欠便/.test(record)) status = "運休等";
    else if (/迂回/.test(record)) status = "迂回";
    else if (/遅延|遅れ/.test(record)) status = "遅延";
  }

  if (/運休|運行見合わせ|運転見合わせ|見合わせ|欠便/.test(status)) return "運休等";
  if (/迂回/.test(status)) return "迂回";
  if (/遅延|遅れ/.test(status)) return "遅延";
  return status || "要確認";
}

function extractHirodenDetail(record) {
  const degree = record.match(/程度\s+(.{2,80}?)(?=\s+(区間|復旧見込|事由|詳細・備考|詳しい運行状況|バス延着証明書)|$)/);
  if (degree && degree[1]) return degree[1].replace(/\s+/g, " ").trim();

  const recovery = record.match(/復旧見込\s+(.{2,80}?)(?=\s+(区間|程度|事由|詳細・備考|詳しい運行状況|バス延着証明書)|$)/);
  if (recovery && recovery[1]) return recovery[1].replace(/\s+/g, " ").trim();

  const detail = record.match(/詳細・備考\s+(.{2,100})/);
  if (detail && detail[1]) {
    const d = detail[1].replace(/\s+/g, " ").trim();
    const m = d.match(/(最大\s*[0-9０-９]+\s*分[^。 ]*|[0-9０-９]+分[〜～\-−][0-9０-９]+分程度|[0-9０-９]+分程度|遅れが発生[^。 ]*)/);
    return (m ? m[1] : d.slice(0, 32)).trim();
  }

  return "";
}

function judgeHirodenPriorityRoutes(rawHtml) {
  const busText = extractHirodenBusText(rawHtml);
  const records = splitHirodenBusRecords(busText);

  const routes = [
    {
      key: "5号線",
      matchers: [/(\s|^)5\s*5号線/, /5号線（[^）]*牛田早稲田/, /牛田早稲田.*広島駅新幹線口/]
    },
    {
      key: "6号線",
      matchers: [/(\s|^)6\s*6号線/, /6号線（[^）]*牛田早稲田/, /牛田早稲田.*江波/]
    },
    {
      key: "2号線",
      matchers: [/(\s|^)2\s*2号線/, /2号線（[^）]*(府中永田|府中山田|府中ニュータウン|温品)/, /(府中永田|府中山田|府中ニュータウン|温品4丁目)/]
    }
  ];

  const results = [];

  for (const route of routes) {
    const hit = records.find(record => route.matchers.some(re => re.test(record)));

    if (!hit) {
      results.push(`${route.key}○`);
      continue;
    }

    const status = getHirodenRouteStatus(hit);
    const detail = extractHirodenDetail(hit);
    const suffix = detail ? `${status}（${detail}）` : status;
    results.push(`${route.key}${suffix}`);
  }

  const hasAlert = results.some(v => !v.endsWith("○"));

  return {
    level: hasAlert ? "alert" : "ok",
    message: results.join("／")
  };
}


function stripNoticeLikeText(textOrHtml) {
  return stripHtml(textOrHtml)
    .replace(/。/g, "。\n")
    .replace(/／/g, "\n")
    .replace(/\|/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function judgeHiroshimaBusOperation(rawText) {
  const text = stripNoticeLikeText(rawText);
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  const allText = lines.join(" ");

  // 広島バスは「お知らせ」に将来の遅延可能性が多い。
  // 現在の状態としては、エリア別の通常運行を最優先する。
  const areaSectionMatch = allText.match(/■エリア別の運行状況([\s\S]*?)(■路線別の運行状況|遅延証明書|運行状況「くるけん」|$)/);
  const areaSection = areaSectionMatch ? areaSectionMatch[1] : allText;

  if (/通常運行/.test(areaSection) && !/(運休|運行見合わせ|運転見合わせ|欠便|遅延発生|大幅遅延)/.test(areaSection)) {
    return {
      level: "ok",
      message: "通常運行、詳細は公式ページで確認"
    };
  }

  // 「お知らせ」「恐れ」「可能性」「工事予定」は現在の異常扱いにしない。
  const ignorePattern = /(お知らせ|恐れ|おそれ|可能性|予定|工事|交通規制|規制に伴|事前案内|予告|見込み|場合があります|ライブにお伝えするものではありません)/;

  for (const line of lines) {
    if (ignorePattern.test(line)) continue;
    if (/(現在.*?(運休|運行見合わせ|運転見合わせ|欠便|遅延発生|大幅遅延)|(?:運休|運行見合わせ|運転見合わせ|欠便|遅延発生|大幅遅延).*?(発生|しています|中です))/.test(line)) {
      return {
        level: "alert",
        message: "一部遅延・運休状況あり、詳細は公式ページで確認"
      };
    }
  }

  if (/通常運行/.test(allText)) {
    return {
      level: "ok",
      message: "通常運行、詳細は公式ページで確認"
    };
  }

  return {
    level: "ok",
    message: "明確な遅延・運休情報なし、詳細は公式ページで確認"
  };
}

function judgeHiroshimaKotsuOperation(rawText) {
  const text = stripNoticeLikeText(rawText);
  const allText = text.replace(/\n/g, " ");

  const routeStatusSection = allText.includes("路線名 運行状況")
    ? allText.slice(allText.indexOf("路線名 運行状況"))
    : allText;

  const normalCount = (routeStatusSection.match(/平常運行/g) || []).length;
  const alertPattern = /(運休|運行見合わせ|運転見合わせ|見合わせ|欠便|遅延|大幅な遅れ|大幅遅延|迂回|運行休止|運行停止)/;

  // 問い合わせ先や注意書きではなく、路線一覧内に異常語がある場合だけalert
  const withoutNotes = routeStatusSection
    .replace(/ご利用上のご注意[\s\S]*?路線名 運行状況/g, "")
    .replace(/お問合せ先[\s\S]*?路線名 運行状況/g, "");

  if (alertPattern.test(withoutNotes.replace(/平常運行/g, ""))) {
    return {
      level: "alert",
      message: "一部遅延・運休状況あり、詳細は公式ページで確認"
    };
  }

  if (normalCount > 0) {
    return {
      level: "ok",
      message: "平常運行、詳細は公式ページで確認"
    };
  }

  return {
    level: "ok",
    message: "明確な遅延・運休情報なし、詳細は公式ページで確認"
  };
}

function judgeBusOperation(rawText, sourceId = "") {
  if (sourceId === "hiroshima-bus") return judgeHiroshimaBusOperation(rawText);
  if (sourceId === "hiroshima-kotsu") return judgeHiroshimaKotsuOperation(rawText);

  const text = stripNoticeLikeText(rawText);
  if (/(通常運行|平常運行|正常運行)/.test(text)) {
    return {
      level: "ok",
      message: "通常運行、詳細は公式ページで確認"
    };
  }
  if (/(運休|運行見合わせ|運転見合わせ|欠便|遅延発生|大幅遅延)/.test(text)) {
    return {
      level: "alert",
      message: "一部遅延・運休状況あり、詳細は公式ページで確認"
    };
  }
  return {
    level: "ok",
    message: "明確な遅延・運休情報なし、詳細は公式ページで確認"
  };
}

async function checkSource(source) {
  try {
    const html = await fetchText(source.url);

    if (source.id === "hiroden") {
      const routeResult = judgeHirodenPriorityRoutes(html);
      const keywordResult = checkKeywords(html, source.keywords);
      const baseMessage = keywordResult.found.length
        ? `要確認キーワードあり：${keywordResult.found.slice(0, 4).join("、")}`
        : "取得OK";

      return {
        label: source.label,
        url: source.url,
        level: routeResult.level === "alert" ? "alert" : keywordResult.level,
        message: `${routeResult.message}｜全体：${baseMessage}`
      };
    }

    if (source.mode === "bus-operation") {
      const result = judgeBusOperation(html, source.id);
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

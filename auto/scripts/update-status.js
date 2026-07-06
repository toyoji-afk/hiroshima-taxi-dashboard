const fs = require("fs/promises");

const sources = [
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
  const urls = [url];

  // 広島バスだけ、まれにGitHub Actionsからの取得に失敗することがあるため、
  // 念のため http 版も最後に試す。
  if (url.includes("hirobus-info-rosen.jp") && url.startsWith("https://")) {
    urls.push(url.replace("https://", "http://"));
  }

  let lastError = null;

  for (const targetUrl of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);

      try {
        const res = await fetch(targetUrl, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 hiroshima-taxi-dashboard",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "ja,en-US;q=0.8,en;q=0.6",
            "cache-control": "no-cache"
          }
        });

        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 900 * attempt));
      }
    }
  }

  throw lastError || new Error("fetch failed");
}








const jrLocalLines = [
  {
    id: "jr-sanyo",
    label: "山陽線",
    names: ["山陽線", "山陽本線"],
    url: "https://trafficinfo.westjr.co.jp/chugoku.html"
  },
  {
    id: "jr-kure",
    label: "呉線",
    names: ["呉線"],
    url: "https://trafficinfo.westjr.co.jp/chugoku.html"
  },
  {
    id: "jr-kabe",
    label: "可部線",
    names: ["可部線"],
    url: "https://trafficinfo.westjr.co.jp/chugoku.html"
  },
  {
    id: "jr-geibi",
    label: "芸備線",
    names: ["芸備線"],
    url: "https://trafficinfo.westjr.co.jp/chugoku.html"
  }
];

function normalizeJrText(html) {
  return stripHtml(html)
    .replace(/&nbsp;/g, " ")
    .replace(/。/g, "。\n")
    .replace(/(【[^】]+】)/g, "\n$1\n")
    .replace(/(〖[^〗]+〗)/g, "\n$1\n")
    .replace(/(20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/g, "\n$1 ")
    .replace(/(山陽線|山陽本線|呉線|可部線|芸備線)/g, "\n$1")
    .replace(/(順次運転見合わせ|運転見合わせ|運転取り止め|運休|徐行運転|遅延|遅れ|再開見込|再開見込み|区間|原因|理由|影響)/g, "\n$1")
    .replace(/\s+/g, " ")
    .split(/\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractHiroshimaYamaguchiSection(text) {
  const startMarkers = ["広島・山口地区", "Hiroshima・Yamaguchi Area"];
  let start = -1;
  for (const marker of startMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      start = idx;
      break;
    }
  }
  if (start === -1) return text;

  const tail = text.slice(start);
  const endMarkers = ["山陰地区", "San-in Area", "岡山・福山地区", "Okayama・Fukuyama Area"];
  let end = tail.length;

  for (const marker of endMarkers) {
    const idx = tail.indexOf(marker, 20);
    if (idx !== -1 && idx < end) end = idx;
  }

  return tail.slice(0, end);
}

function getJrRecordsFromText(text, lineDef) {
  const records = [];
  const linePattern = lineDef.names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const allLineNames = jrLocalLines
    .flatMap(l => l.names)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  // 1. 【山陽線】... / 〖山陽線〗... のようなタイトル形式を優先
  const titledRe = new RegExp(`(?:【|〖)\\s*(?:${linePattern})\\s*(?:】|〗)([\\s\\S]{0,900}?)(?=(?:【|〖)\\s*(?:${allLineNames})\\s*(?:】|〗)|$)`, "g");
  let m;
  while ((m = titledRe.exec(text)) !== null) {
    records.push(`${lineDef.label} ${m[1]}`.replace(/\s+/g, " ").trim());
  }

  // 2. 路線名から次の路線名までの範囲
  const lineRe = new RegExp(`(?:${linePattern})([\\s\\S]{0,900}?)(?=(?:${allLineNames})|$)`, "g");
  while ((m = lineRe.exec(text)) !== null) {
    records.push(`${lineDef.label} ${m[1]}`.replace(/\s+/g, " ").trim());
  }

  // 3. 山陽線だけは、同一ページ内で複数レコードが続くことが多いため、
  //    「順次運転見合わせ」などを起点にした周辺も拾う。
  //    ただし路線名や駅名の範囲が山陽線に関係するものに絞る。
  const incidentRe = /(順次運転見合わせ|運転見合わせ|運転取り止め|運休|徐行運転|遅延|遅れ)([\s\S]{0,550}?)(?=(順次運転見合わせ|運転見合わせ|運転取り止め|運休|徐行運転|遅延|遅れ|【|〖|$))/g;
  while ((m = incidentRe.exec(text)) !== null) {
    const rec = `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
    if (isJrRecordRelatedToLine(rec, lineDef)) records.push(rec);
  }

  return [...new Set(records.map(r => r.replace(/\s+/g, " ").trim()))]
    .filter(r => /(順次運転見合わせ|運転見合わせ|運転取り止め|運休|徐行運転|遅延|遅れ)/.test(r))
    .filter(r => !isIgnorableJrRecord(r));
}

function isIgnorableJrRecord(record) {
  // 明日以降の予告・長期工事・単なる説明文は除外。
  if (/(明日|明後日|長期運転見合わせ|保守工事|払い戻し|利用規約|このページ|ご案内)/.test(record)
      && !/(本日|現在|発生|運転見合わせ|遅延|順次運転見合わせ)/.test(record)) {
    return true;
  }
  return false;
}

function isJrRecordRelatedToLine(record, lineDef) {
  if (lineDef.names.some(name => record.includes(name))) return true;

  // 駅名での補助判定。完璧ではないが、広島近郊の主要区間に絞る。
  if (lineDef.id === "jr-sanyo") {
    return /(岩国|大竹|宮島口|五日市|横川|広島|新白島|天神川|向洋|海田市|瀬野|八本松|西条|白市|三原|糸崎|尾道)/.test(record);
  }
  if (lineDef.id === "jr-kure") {
    return /(三原|須波|安芸幸崎|竹原|安浦|安芸川尻|広|呉|坂|矢野|海田市)/.test(record);
  }
  if (lineDef.id === "jr-kabe") {
    return /(横川|三滝|安芸長束|下祇園|古市橋|大町|緑井|可部|あき亀山)/.test(record);
  }
  if (lineDef.id === "jr-geibi") {
    return /(広島|矢賀|戸坂|安芸矢口|玖村|下深川|狩留家|志和口|三次|備後庄原|備後落合)/.test(record);
  }
  return false;
}

function parseJrIncident(record) {
  let status = "";
  const statusMatch = record.match(/(順次運転見合わせ|運転見合わせ|運転取り止め|運休|徐行運転|遅延|遅れ)/);
  if (statusMatch) status = statusMatch[1] === "遅れ" ? "遅延" : statusMatch[1];

  let section = "";
  const sectionPatterns = [
    /(?:区間|一部区間)\s*[:：]?\s*([^。]{2,70}?)(?=\s*(?:原因|理由|再開見込|再開見込み|影響|$))/,
    /([一-龥ぁ-んァ-ヶA-Za-z0-9]+駅?\s*[〜～\-－]\s*[一-龥ぁ-んァ-ヶA-Za-z0-9]+駅?)/,
    /([一-龥ぁ-んァ-ヶA-Za-z0-9]+駅?\s*から\s*[一-龥ぁ-んァ-ヶA-Za-z0-9]+駅?\s*まで)/,
    /([一-龥ぁ-んァ-ヶA-Za-z0-9]+)\s*と\s*([一-龥ぁ-んァ-ヶA-Za-z0-9]+)\s*の間/
  ];
  for (const p of sectionPatterns) {
    const m = record.match(p);
    if (m) {
      if (m[2]) section = `${m[1]}〜${m[2]}`;
      else section = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }

  let reason = "";
  const reasonPatterns = [
    /(?:原因|理由)\s*[:：]?\s*([^。]{2,45}?)(?=\s*(?:再開見込|再開見込み|区間|影響|$))/,
    /(人と接触|倒木|踏切確認|車両確認|信号確認|線路確認|沿線火災|大雨|強風|落石|動物と接触|架線確認|設備確認)/
  ];
  for (const p of reasonPatterns) {
    const m = record.match(p);
    if (m && m[1]) {
      reason = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }

  let resume = "";
  const resumePatterns = [
    /(?:再開見込|再開見込み)\s*[:：]?\s*([^。]{2,50}?)(?=\s*(?:原因|理由|区間|影響|$))/,
    /([0-9０-９]{1,2}\s*時\s*[0-9０-９]{0,2}\s*分?\s*頃(?:以降)?)/,
    /(未定)/
  ];
  for (const p of resumePatterns) {
    const m = record.match(p);
    if (m && m[1]) {
      resume = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }

  const parts = [];
  if (status) parts.push(status);
  if (section) parts.push(section);
  if (reason) parts.push(reason);
  if (resume) parts.push(`再開見込 ${resume}`);

  return parts.length ? parts.join("／") : "要確認";
}

function summarizeJrLineFromHtml(html, lineDef) {
  const fullText = stripHtml(html)
    .replace(/&nbsp;/g, " ")
    .replace(/。/g, "。 ")
    .replace(/\s+/g, " ");

  const localText = extractHiroshimaYamaguchiSection(fullText);
  let records = getJrRecordsFromText(localText, lineDef);

  // 念のため、広島・山口地区の切り出しがうまくいかない場合は全体でも見る。
  if (!records.length) {
    records = getJrRecordsFromText(fullText, lineDef);
  }

  if (!records.length) {
    return {
      level: "ok",
      message: "平常運転"
    };
  }

  const incidents = records
    .map(parseJrIncident)
    .filter(Boolean);

  if (!incidents.length) {
    return {
      level: "ok",
      message: "平常運転"
    };
  }

  const shown = incidents.slice(0, 4);
  const suffix = incidents.length > 4 ? `／ほか${incidents.length - 4}件` : "";

  return {
    level: "alert",
    message: shown.map((s, i) => incidents.length > 1 ? `${i + 1}) ${s}` : s).join("　") + suffix
  };
}

async function checkJrLocalLine(lineDef, cachedHtml = null) {
  const url = lineDef.url;
  try {
    const html = cachedHtml || await fetchText(url);
    const result = summarizeJrLineFromHtml(html, lineDef);

    return {
      label: lineDef.label,
      url,
      level: result.level,
      message: result.message
    };
  } catch (error) {
    return {
      label: lineDef.label,
      url,
      level: "error",
      message: "取得できませんでした。公式ページで確認"
    };
  }
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

      // 広電ページ全体には「遅れ」「運休」などの一般説明文が含まれるため、
      // ページ全体のキーワード判定はしない。
      // 重点路線判定がalertでなければ、全体は取得OK扱いにする。
      const overallMessage = routeResult.level === "alert"
        ? "詳細は公式ページで確認"
        : "取得OK";

      return {
        label: source.label,
        url: source.url,
        level: routeResult.level,
        message: `${routeResult.message}｜全体：${overallMessage}`
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
    const msg = source.id === "hiroshima-bus"
      ? "取得できませんでした。公式ページで確認"
      : "取得できませんでした。公式リンクで確認";

    return {
      label: source.label,
      url: source.url,
      level: "error",
      message: msg
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

function getTodayTokensJst() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(now);

  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;

  return [
    `${y}/${m}/${d}`,
    `${y}年${m}月${d}日`,
    `${m}/${d}`,
    `${m}月${d}日`
  ];
}

async function checkEventSource(source) {
  try {
    const html = await fetchText(source.url);
    const text = stripHtml(html).replace(/\s+/g, " ");
    const todayTokens = getTodayTokensJst();

    const hasToday = todayTokens.some(token => text.includes(token));
    const hasVenue = (source.venueKeywords || []).some(keyword => text.includes(keyword));

    if (hasToday && hasVenue) {
      return {
        label: source.label,
        url: source.url,
        level: "alert",
        message: "本日広島開催の可能性あり。公式ページで確認"
      };
    }

    return {
      label: source.label,
      url: source.url,
      level: "ok",
      message: "本日広島開催なし"
    };
  } catch (error) {
    return {
      label: source.label,
      url: source.url,
      level: "error",
      message: "取得できませんでした。公式ページで確認"
    };
  }
}

async function main() {
  const items = [];

  // 1. 天気
  items.push(await checkWeather());

  // 2. JR広島近郊。JRは1回だけ取得して、4路線に分けて判定する。
  let jrHtml = null;
  try {
    jrHtml = await fetchText("https://trafficinfo.westjr.co.jp/chugoku.html");
  } catch (error) {
    jrHtml = null;
  }

  for (const line of jrLocalLines) {
    items.push(await checkJrLocalLine(line, jrHtml));
  }

  // 3. 広電・バス・空港
  for (const source of sources) {
    items.push(await checkSource(source));
  }

  // 4. カープ・サンフレッチェ
  for (const source of eventSources) {
    items.push(await checkEventSource(source));
  }

  const now = new Date();
  const updatedAtJst = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(now);

  const data = {
    updatedAtJst,
    generatedAt: now.toISOString(),
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

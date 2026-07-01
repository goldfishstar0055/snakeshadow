import Papa from "papaparse";

const DEFAULT_LAT = 33.9737;
const DEFAULT_LNG = 134.3601;

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR6mD2OmSSaN6QD80j5O0XARw7tGiovprDrDcFDJXXrlmc_r7XoQKtZj81k_reh13G9epvqfvEQp14p/pub?gid=1292865550&single=true&output=csv";

const REPORT_FORM_BASE =
  "https://docs.google.com/forms/d/e/1FAIpQLSci1aL3mdn_JX8razqEc7B3AGfw8SIgfAqkYGxY-KkjqJvVvg/viewform?usp=pp_url";

const $location = document.getElementById("location-status");
const $weather  = document.getElementById("weather-status");
const $shadow   = document.getElementById("shadow-status");
const $snakeCount   = document.getElementById("snake-count");
const $snakeUpdated = document.getElementById("snake-updated");
const $notification = document.getElementById("notification");

function notify(msg) {
  $notification.textContent = msg;
  $notification.classList.remove("hidden");
  setTimeout(() => $notification.classList.add("hidden"), 6000);
}

// --- Location ---

async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 }
    );
  });
}

// --- Weather ---

async function getWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=cloud_cover,weather_code&timezone=Asia/Tokyo`;
  const res = await fetch(url);
  const data = await res.json();
  return { cloudCover: data.current.cloud_cover, weatherCode: data.current.weather_code };
}

function weatherCodeLabel(code) {
  if (code <= 1) return "晴れ";
  if (code <= 3) return "曇り";
  if (code <= 49) return "霧";
  if (code <= 69) return "雨";
  if (code <= 79) return "雪";
  if (code <= 99) return "雷雨";
  return "不明";
}

function weatherEmoji(code) {
  if (code === undefined || code === null) return "⏳";
  if (code <= 1)  return "☀️";
  if (code <= 3)  return "⛅";
  if (code <= 49) return "🌫️";
  if (code <= 69) return "🌧️";
  if (code <= 79) return "❄️";
  if (code <= 99) return "⛈️";
  return "❓";
}

function isOvercast(cloudCover, weatherCode) {
  return cloudCover >= 70 || (weatherCode > 3 && weatherCode !== undefined);
}

// --- 座標の正規化 ---

function toHalfWidth(s) {
  return s.replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function parseCoord(raw) {
  if (!raw) return NaN;
  let s = toHalfWidth(raw.trim());
  if (s === "" || s === "不明") return NaN;
  const dms = s.match(/^(\d+(?:\.\d+)?)\s*[°度]\s*(\d+(?:\.\d+)?)\s*['''′]\s*(\d+(?:\.\d+)?)?/);
  if (dms) {
    return parseFloat(dms[1]) + parseFloat(dms[2]) / 60 + (dms[3] ? parseFloat(dms[3]) : 0) / 3600;
  }
  return parseFloat(s);
}

function isValidLat(v) { return v >= 20 && v <= 46; }
function isValidLng(v) { return v >= 122 && v <= 154; }

// --- CSV ヘッダー正規化（引用符・改行・括弧以降を除去） ---

function normalizeHeader(f) {
  return f.replace(/"/g, "").replace(/[\r\n]/g, "").replace(/[（(].*/, "").trim();
}

// --- Spreadsheet CSV parsing ---

const HEADER_KEYWORDS = {
  lat: "緯度", lng: "経度", date: "日付", time: "時間",
  place: "場所", situation: "状況", species: "種類",
};

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const fields = rows[i].map(normalizeHeader);
    if (fields.some((f) => f.includes("緯度")) && fields.some((f) => f.includes("経度"))) {
      return { index: i, fields };
    }
    const lower = fields.map((f) => f.toLowerCase());
    if (lower.includes("lat") && lower.includes("lng")) return { index: i, fields };
  }
  return null;
}

function buildColumnMap(headerFields) {
  const colMap = {};
  for (const [key, keyword] of Object.entries(HEADER_KEYWORDS)) {
    const idx = headerFields.findIndex((f) => f.includes(keyword));
    if (idx !== -1) colMap[key] = idx;
  }
  if (colMap.lat === undefined) {
    const lower = headerFields.map((f) => f.toLowerCase());
    ["lat","lng","date","time","place","situation","species"].forEach((k) => {
      if (colMap[k] === undefined && lower.includes(k)) colMap[k] = lower.indexOf(k);
    });
  }
  return colMap;
}

function parseSnakeCSV(text) {
  const result = Papa.parse(text, { header: false, skipEmptyLines: true });
  const rows = result.data;
  const header = findHeaderRow(rows);
  if (!header) {
    console.warn("ヘビCSV: ヘッダー行（緯度/経度）が見つかりません", rows[0]);
    return [];
  }
  const colMap = buildColumnMap(header.fields);
  if (colMap.lat === undefined || colMap.lng === undefined) {
    console.warn("ヘビCSV: 緯度/経度の列が特定できません", header.fields);
    return [];
  }

  const records = [];
  let totalRows = 0, skipped = 0;

  for (let i = header.index + 1; i < rows.length; i++) {
    const fields = rows[i];
    if (fields.every((f) => String(f).trim() === "")) continue;
    totalRows++;
    const lat = parseCoord(String(fields[colMap.lat] ?? "").trim());
    const lng = parseCoord(String(fields[colMap.lng] ?? "").trim());
    if (isNaN(lat) || isNaN(lng) || !isValidLat(lat) || !isValidLng(lng)) { skipped++; continue; }

    records.push({
      _lat: lat, _lng: lng,
      date:      colMap.date      !== undefined ? String(fields[colMap.date]      ?? "").trim() : "",
      time:      colMap.time      !== undefined ? String(fields[colMap.time]      ?? "").trim() : "",
      place:     colMap.place     !== undefined ? String(fields[colMap.place]     ?? "").trim() : "",
      situation: colMap.situation !== undefined ? String(fields[colMap.situation] ?? "").trim() : "",
      species:   colMap.species   !== undefined ? (String(fields[colMap.species]  ?? "").trim() || "不明") : "不明",
    });
  }
  console.log(`ヘビCSV: 総行数=${totalRows}, 有効=${records.length}, スキップ=${skipped}`);
  return records;
}

// --- Fetch snake data ---

async function fetchSnakeCSV() {
  const res = await fetch(`${CSV_URL}&t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  console.log("CSVヘッダー1行目:", text.split("\n")[0]);
  return text;
}

// --- Date utils for filter ---

function parseSightingDate(str) {
  if (!str) return null;
  let m = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.match(/(\d+)年(\d+)月(\d+)日/);
  if (m) {
    let y = +m[1];
    if (y < 100) y += 2018; // 令和換算
    return new Date(y, +m[2] - 1, +m[3]);
  }
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return new Date(new Date().getFullYear(), +m[1] - 1, +m[2]);
  return null;
}

function filterByPeriod(records, filter) {
  if (filter === "all") return records;
  const cutoff = new Date();
  if (filter === "1m") cutoff.setMonth(cutoff.getMonth() - 1);
  else if (filter === "3m") cutoff.setMonth(cutoff.getMonth() - 3);
  else if (filter === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
  return records.filter((r) => {
    const d = parseSightingDate(r.date);
    return d && d >= cutoff;
  });
}

function sortByDateDesc(records) {
  return [...records].sort((a, b) => {
    const da = parseSightingDate(a.date);
    const db = parseSightingDate(b.date);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
}

// --- Today badge ---

function todayBadge() {
  const n = new Date();
  const days = ["日","月","火","水","木","金","土"];
  return `${n.getMonth()+1}/${n.getDate()} (${days[n.getDay()]})`;
}

// --- Init ---
// ArcGIS の import はすべて動的に行う。
// static import にすると Rollup のチャンク分割後に初期化順序が乱れ TDZ エラーが発生するため。

async function init() {
  const [
    { default: esriConfig },
    { default: Map },
    { default: SceneView },
    { default: SceneLayer },
    { default: GraphicsLayer },
    { default: Graphic },
    { default: Point },
    { default: PopupTemplate },
  ] = await Promise.all([
    import("@arcgis/core/config"),
    import("@arcgis/core/Map"),
    import("@arcgis/core/views/SceneView"),
    import("@arcgis/core/layers/SceneLayer"),
    import("@arcgis/core/layers/GraphicsLayer"),
    import("@arcgis/core/Graphic"),
    import("@arcgis/core/geometry/Point"),
    import("@arcgis/core/PopupTemplate"),
  ]);

  esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;

  // ④ 日付バッジを即時表示
  document.getElementById("info-date-badge").textContent = todayBadge();

  // 1. Location
  let loc = await getLocation();
  let usingDefault = false;
  if (!loc) {
    loc = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    usingDefault = true;
    notify("位置情報が取得できないため神山高専周辺を表示中");
  }
  $location.textContent = `現在地: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}${usingDefault ? "（デフォルト）" : ""}`;

  // 2. Weather
  let weather;
  try {
    weather = await getWeather(loc.lat, loc.lng);
    $weather.textContent = `天気: ${weatherCodeLabel(weather.weatherCode)}　雲量: ${weather.cloudCover}%`;
    // ④ 天気アイコンをヘッダーに表示
    document.getElementById("info-weather-badge").textContent = weatherEmoji(weather.weatherCode);
  } catch {
    weather = { cloudCover: 0, weatherCode: 0 };
    $weather.textContent = "天気: 取得失敗（晴れとして処理）";
    document.getElementById("info-weather-badge").textContent = "❓";
  }

  const overcast = isOvercast(weather.cloudCover, weather.weatherCode);

  // 3. Map
  const userLayer = new GraphicsLayer({ title: "現在地", elevationInfo: { mode: "relative-to-ground", offset: 3 } });
  const snakeLayer = new GraphicsLayer({ title: "ヘビ出現", elevationInfo: { mode: "relative-to-ground", offset: 5 } });
  const reportLayer = new GraphicsLayer({ title: "報告仮ピン", elevationInfo: { mode: "relative-to-ground", offset: 5 } });

  const map = new Map({
    basemap: "arcgis/topographic",
    ground: "world-elevation",
    layers: [snakeLayer, reportLayer, userLayer],
  });

  const userCenter = new Point({ latitude: loc.lat, longitude: loc.lng });

  function weatherCodeToType(code) {
    if (code <= 1) return "sunny";
    if (code <= 3) return "cloudy";
    if (code <= 49) return "foggy";
    if (code <= 69) return "rainy";
    if (code <= 79) return "snowy";
    return "rainy";
  }

  const view = new SceneView({
    container: "viewDiv",
    map,
    camera: { position: { latitude: loc.lat - 0.003, longitude: loc.lng, z: 600 }, tilt: 65, heading: 0 },
    environment: {
      lighting: { type: "sun", date: new Date(), directShadowsEnabled: !overcast },
      atmosphere: { quality: "high" },
    },
    popup: { defaultPopupTemplateEnabled: false },
    ui: { components: ["attribution"] },
  });

  view.environment.weather = { type: weatherCodeToType(weather.weatherCode), cloudCover: weather.cloudCover / 100 };
  view.when(() => view.goTo({ target: userCenter, tilt: 65, zoom: 17 }, { duration: 0 }));

  function updateShadowStatus(shadowing) {
    $shadow.textContent = shadowing
      ? "影: ON（建物・地形の影＝日陰の目安です）"
      : "影: OFF（曇り/雨のため屋外は全体的に日陰です）";
  }

  if (overcast) {
    updateShadowStatus(false);
    notify("今は曇り/雨のため屋外は全体的に日陰です");
  } else {
    updateShadowStatus(true);
  }

  // User location pin
  userLayer.add(new Graphic({
    geometry: new Point({ latitude: loc.lat, longitude: loc.lng }),
    symbol: { type: "point-3d", symbolLayers: [{ type: "icon", size: 18, resource: { primitive: "circle" }, material: { color: [30, 120, 255, 0.9] }, outline: { color: [255, 255, 255], size: 3 } }] },
    popupTemplate: { title: "現在地", content: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` },
  }));

  document.getElementById("btn-locate").addEventListener("click", () => {
    view.goTo({ target: userCenter, tilt: 65, zoom: 17 }, { duration: 1000 });
  });
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    view.goTo({ zoom: view.zoom + 1 }, { duration: 300 });
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    view.goTo({ zoom: view.zoom - 1 }, { duration: 300 });
  });

  const btnTop = document.getElementById("btn-top");
  const btnAngle = document.getElementById("btn-angle");
  btnTop.addEventListener("click", () => {
    btnTop.classList.add("active"); btnAngle.classList.remove("active");
    view.goTo({ target: userCenter, tilt: 0, zoom: view.zoom }, { duration: 800 });
  });
  btnAngle.addEventListener("click", () => {
    btnAngle.classList.add("active"); btnTop.classList.remove("active");
    view.goTo({ target: userCenter, tilt: 65, zoom: view.zoom }, { duration: 800 });
  });

  try {
    map.add(new SceneLayer({ portalItem: { id: "ca0470dbbddb4db28bad74ed39949e25" } }));
  } catch (e) { console.error("3D建物レイヤー読み込みエラー:", e); }

  // =============================================
  // 4. Snake pins + ② sightings list + ③ filter
  // =============================================

  const snakePopupTpl = new PopupTemplate({
    title: "{place}",
    content: [{ type: "fields", fieldInfos: [
      { fieldName: "date", label: "日付" },
      { fieldName: "time", label: "時間" },
      { fieldName: "place", label: "場所" },
      { fieldName: "species", label: "種類" },
      { fieldName: "situation", label: "状況" },
    ]}],
  });

  function updateTimestamp() {
    const n = new Date();
    $snakeUpdated.textContent = `最終取得: ${n.getFullYear()}/${(n.getMonth()+1).toString().padStart(2,"0")}/${n.getDate().toString().padStart(2,"0")} ${n.getHours()}:${n.getMinutes().toString().padStart(2,"0")}`;
    $snakeUpdated.style.cssText = "font-size:11px;color:#888";
  }

  let allRecords = [];
  let currentFilter = "all";

  // ② Render sightings list (top 5 of filtered, sorted newest first)
  function renderSightingsList(filtered) {
    const container = document.getElementById("sightings-list");
    if (!container) return;
    if (filtered.length === 0) {
      container.innerHTML = '<p class="no-sightings">この期間の目撃情報はありません</p>';
      return;
    }
    const top5 = sortByDateDesc(filtered).slice(0, 5);
    container.innerHTML = "";
    top5.forEach((r) => {
      const card = document.createElement("div");
      card.className = "sighting-card";
      card.innerHTML = `
        <div class="sighting-date">${r.date}${r.time ? "　" + r.time : ""}</div>
        <div class="sighting-place">${r.place || "場所不明"}</div>
        <div class="sighting-species">🐍 ${r.species}</div>
        ${r.situation ? `<div class="sighting-situation">${r.situation}</div>` : ""}
      `;
      card.addEventListener("click", () => {
        view.goTo({ target: new Point({ latitude: r._lat, longitude: r._lng }), zoom: 18, tilt: 65 }, { duration: 800 });
        // モバイルドロワーを閉じる
        document.getElementById("sightings-panel").classList.remove("open");
      });
      container.appendChild(card);
    });
  }

  // ③ Apply filter: update both map pins and list
  function applyFilter() {
    const filtered = filterByPeriod(allRecords, currentFilter);

    snakeLayer.removeAll();
    for (const r of filtered) {
      snakeLayer.add(new Graphic({
        geometry: new Point({ latitude: r._lat, longitude: r._lng }),
        symbol: { type: "point-3d", symbolLayers: [{ type: "icon", size: 16, resource: { primitive: "circle" }, material: { color: [220, 40, 40, 0.9] }, outline: { color: [255, 255, 255], size: 2 } }] },
        attributes: { date: r.date, time: r.time, place: r.place, species: r.species, situation: r.situation },
        popupTemplate: snakePopupTpl,
      }));
    }

    $snakeCount.textContent = `ヘビ出現データ: ${filtered.length} 件（全${allRecords.length}件中）`;
    updateInfoSummary();
    renderSightingsList(filtered);
  }

  async function loadSnakeData() {
    snakeLayer.removeAll();
    $snakeCount.textContent = "読み込み中…";
    try {
      const csvText = await fetchSnakeCSV();
      allRecords = parseSnakeCSV(csvText);
      applyFilter();
      updateTimestamp();
    } catch (e) {
      console.error("ヘビCSV読み込みエラー:", e);
      $snakeCount.textContent = "ヘビデータの取得に失敗しました。ネットワークを確認してください。";
      document.getElementById("sightings-list").innerHTML = '<p class="no-sightings">データを取得できませんでした</p>';
    }
  }

  await loadSnakeData();

  document.getElementById("btn-reload-data").addEventListener("click", async () => {
    $snakeCount.textContent = "再読み込み中…";
    await loadSnakeData();
    notify("ヘビデータを再読み込みしました");
  });

  // ③ Filter buttons
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      applyFilter();
    });
  });

  // Mobile drawer toggle
  const $sightingsPanel = document.getElementById("sightings-panel");
  document.getElementById("btn-sightings-toggle").addEventListener("click", () => {
    $sightingsPanel.classList.toggle("open");
  });
  document.getElementById("sightings-close").addEventListener("click", () => {
    $sightingsPanel.classList.remove("open");
  });

  // =============================================
  // 5. Report mode
  // =============================================

  const $btnReport    = document.getElementById("btn-report");
  const $reportBanner  = document.getElementById("report-banner");
  const $reportConfirm = document.getElementById("report-confirm");
  const $reportCoords  = document.getElementById("report-coords");
  let reportClickHandler = null;
  let reportCoords = null;

  function enterReportMode() {
    $btnReport.style.display = "none";
    $reportBanner.classList.remove("hidden");
    $reportConfirm.classList.add("hidden");
    reportLayer.removeAll();
    view.popup.close();

    reportClickHandler = view.on("click", (event) => {
      event.stopPropagation();
      const mp = event.mapPoint;
      if (!mp) return;
      reportCoords = { lat: mp.latitude, lng: mp.longitude };
      reportLayer.removeAll();
      reportLayer.add(new Graphic({
        geometry: new Point({ latitude: reportCoords.lat, longitude: reportCoords.lng }),
        symbol: { type: "point-3d", symbolLayers: [{ type: "icon", size: 20, resource: { primitive: "circle" }, material: { color: [37, 99, 235, 0.9] }, outline: { color: [255, 255, 255], size: 3 } }] },
      }));
      $reportCoords.textContent = `緯度: ${reportCoords.lat.toFixed(6)}, 経度: ${reportCoords.lng.toFixed(6)}`;
      $reportConfirm.classList.remove("hidden");
    });
  }

  function exitReportMode() {
    $btnReport.style.display = "";
    $reportBanner.classList.add("hidden");
    $reportConfirm.classList.add("hidden");
    reportLayer.removeAll();
    reportCoords = null;
    if (reportClickHandler) { reportClickHandler.remove(); reportClickHandler = null; }
  }

  $btnReport.addEventListener("click", enterReportMode);
  document.getElementById("report-cancel").addEventListener("click", exitReportMode);
  document.getElementById("report-back").addEventListener("click", () => {
    $reportConfirm.classList.add("hidden");
    reportLayer.removeAll();
    reportCoords = null;
  });
  document.getElementById("report-submit").addEventListener("click", () => {
    if (!reportCoords) return;
    const url = `${REPORT_FORM_BASE}&entry.1411652182=${encodeURIComponent(reportCoords.lat.toFixed(6))}&entry.410305265=${encodeURIComponent(reportCoords.lng.toFixed(6))}`;
    window.open(url, "_blank");
    exitReportMode();
    notify("報告ありがとうございます。反映には時間がかかる場合があります。");
  });

  // =============================================
  // 6. Mode control (Realtime / Preview)
  // =============================================

  const $modeStatus   = document.getElementById("mode-status");
  const $modeRealtime = document.getElementById("mode-realtime");
  const $modePreview  = document.getElementById("mode-preview");
  const $previewPanel = document.getElementById("preview-panel");
  const $pvTimeSlider = document.getElementById("pv-time-slider");
  const $pvTimeDisplay = document.getElementById("pv-time-display");
  const $pvDatePicker = document.getElementById("pv-date-picker");
  const $pvPlay       = document.getElementById("pv-play");
  const $pvCloudSlider = document.getElementById("pv-cloud-slider");
  const $pvCloudDisplay = document.getElementById("pv-cloud-display");
  const previewTabs   = document.querySelectorAll(".preview-tab");
  const weatherBtns   = document.querySelectorAll(".weather-btn");

  let playAnimId = null;

  const $infoPanel  = document.getElementById("info-panel");
  const $infoHeader = document.getElementById("info-header");
  const $infoSummary = document.getElementById("info-summary");

  function updateInfoSummary() {
    $infoSummary.textContent = `ヘビ日陰マップ — ${$snakeCount.textContent}`;
  }

  $infoHeader.addEventListener("click", () => {
    $infoPanel.classList.toggle("collapsed");
    setTimeout(positionModeUI, 310);
  });

  document.getElementById("preview-close").addEventListener("click", () => {
    $previewPanel.classList.add("minimized");
  });
  document.querySelectorAll(".preview-tab").forEach((tab) => {
    tab.addEventListener("click", () => $previewPanel.classList.remove("minimized"));
  });

  function positionModeUI() {
    const rect = document.getElementById("info-panel").getBoundingClientRect();
    const modeToggle = document.getElementById("mode-toggle");
    if (window.innerWidth > 500) {
      modeToggle.style.top = (rect.bottom + 8) + "px";
      $previewPanel.style.top = (rect.bottom + 8 + modeToggle.offsetHeight + 8) + "px";
    } else {
      modeToggle.style.top = "";
      $previewPanel.style.top = "86px";
    }
  }

  $modeStatus.textContent = "モード: リアルタイム";

  function throttle(fn, ms) {
    let last = 0;
    return (...args) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...args); } };
  }

  function buildJSTDate(dateStr, minutes) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), Math.round(minutes % 60)) - 9 * 3600000);
  }

  function formatTime(minutes) {
    return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${Math.round(minutes % 60).toString().padStart(2, "0")} JST`;
  }

  function todayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${(n.getMonth()+1).toString().padStart(2,"0")}-${n.getDate().toString().padStart(2,"0")}`;
  }

  function nowMinutes() {
    const n = new Date(); return n.getHours() * 60 + n.getMinutes();
  }

  let pvWeatherType = "sunny";
  let pvCloudCover = 30;

  const applyPreviewEnv = throttle(() => {
    const minutes = parseInt($pvTimeSlider.value);
    const dateStr = $pvDatePicker.value;
    $pvTimeDisplay.textContent = formatTime(minutes);
    const shadowing = !(pvWeatherType !== "sunny" && pvCloudCover >= 70);
    view.environment.lighting.date = buildJSTDate(dateStr, minutes);
    view.environment.lighting.directShadowsEnabled = shadowing;
    view.environment.weather = { type: pvWeatherType, cloudCover: pvCloudCover / 100 };
    updateShadowStatus(shadowing);
    const wLabels = { sunny: "晴れ", cloudy: "曇り", rainy: "雨", snowy: "雪", foggy: "霧" };
    $modeStatus.textContent = `プレビュー: ${dateStr} ${formatTime(minutes)} ${wLabels[pvWeatherType]}`;
    $weather.textContent = `天気: ${wLabels[pvWeatherType]}　雲量: ${pvCloudCover}%`;
  }, 30);

  previewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      previewTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  $pvTimeSlider.addEventListener("input", applyPreviewEnv);
  $pvDatePicker.addEventListener("change", applyPreviewEnv);

  function stopPlay() {
    if (playAnimId !== null) { cancelAnimationFrame(playAnimId); playAnimId = null; }
    $pvPlay.textContent = "▶"; $pvPlay.classList.remove("playing");
  }

  $pvPlay.addEventListener("click", () => {
    if (playAnimId !== null) { stopPlay(); return; }
    $pvPlay.textContent = "■"; $pvPlay.classList.add("playing");
    let val = parseInt($pvTimeSlider.value);
    if (val >= 1440) val = 0;
    let lastTs = null;
    function step(ts) {
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs; lastTs = ts;
      val += dt * 0.15;
      if (val >= 1440) { val = 1440; $pvTimeSlider.value = val; applyPreviewEnv(); stopPlay(); return; }
      $pvTimeSlider.value = Math.round(val);
      applyPreviewEnv();
      playAnimId = requestAnimationFrame(step);
    }
    playAnimId = requestAnimationFrame(step);
  });

  weatherBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      weatherBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      pvWeatherType = btn.dataset.weather;
      applyPreviewEnv();
    });
  });

  $pvCloudSlider.addEventListener("input", () => {
    pvCloudCover = parseInt($pvCloudSlider.value);
    $pvCloudDisplay.textContent = pvCloudCover + "%";
    applyPreviewEnv();
  });

  function activateRealtime() {
    $modeRealtime.classList.add("active"); $modePreview.classList.remove("active");
    $previewPanel.classList.add("hidden");
    stopPlay();
    $modeStatus.textContent = "モード: リアルタイム";
    (async () => {
      try {
        const w = await getWeather(loc.lat, loc.lng);
        weather = w;
        $weather.textContent = `天気: ${weatherCodeLabel(w.weatherCode)}　雲量: ${w.cloudCover}%`;
        document.getElementById("info-weather-badge").textContent = weatherEmoji(w.weatherCode);
        const oc = isOvercast(w.cloudCover, w.weatherCode);
        view.environment.lighting.date = new Date();
        view.environment.lighting.directShadowsEnabled = !oc;
        view.environment.weather = { type: weatherCodeToType(w.weatherCode), cloudCover: w.cloudCover / 100 };
        updateShadowStatus(!oc);
      } catch {
        view.environment.lighting.date = new Date();
        view.environment.lighting.directShadowsEnabled = true;
        updateShadowStatus(true);
      }
    })();
  }

  function activatePreview() {
    $modePreview.classList.add("active"); $modeRealtime.classList.remove("active");
    $previewPanel.classList.remove("hidden"); $previewPanel.classList.remove("minimized");
    positionModeUI();
    $pvDatePicker.value = todayStr();
    const mins = nowMinutes();
    $pvTimeSlider.value = mins;
    $pvTimeDisplay.textContent = formatTime(mins);
    pvWeatherType = weatherCodeToType(weather.weatherCode);
    weatherBtns.forEach((b) => b.classList.toggle("active", b.dataset.weather === pvWeatherType));
    pvCloudCover = weather.cloudCover;
    $pvCloudSlider.value = pvCloudCover;
    $pvCloudDisplay.textContent = pvCloudCover + "%";
    applyPreviewEnv();
  }

  $modeRealtime.addEventListener("click", activateRealtime);
  $modePreview.addEventListener("click", activatePreview);
  view.when(() => positionModeUI());
  window.addEventListener("resize", positionModeUI);
}

init();

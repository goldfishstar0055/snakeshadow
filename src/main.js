import Papa from "papaparse";

const DEFAULT_LAT = 33.9737;
const DEFAULT_LNG = 134.3601;

// ヘビ出現データ（Googleフォーム回答シート・公開済み）
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR6mD2OmSSaN6QD80j5O0XARw7tGiovprDrDcFDJXXrlmc_r7XoQKtZj81k_reh13G9epvqfvEQp14p/pub?gid=1292865550&single=true&output=csv";

// Googleフォーム事前入力URL
const REPORT_FORM_BASE =
  "https://docs.google.com/forms/d/e/1FAIpQLSci1aL3mdn_JX8razqEc7B3AGfw8SIgfAqkYGxY-KkjqJvVvg/viewform?usp=pp_url";

const $location = document.getElementById("location-status");
const $weather = document.getElementById("weather-status");
const $shadow = document.getElementById("shadow-status");
const $snakeCount = document.getElementById("snake-count");
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
    const d = parseFloat(dms[1]);
    const m = parseFloat(dms[2]);
    const sec = dms[3] ? parseFloat(dms[3]) : 0;
    return d + m / 60 + sec / 3600;
  }
  return parseFloat(s);
}

function isValidLat(v) { return v >= 20 && v <= 46; }
function isValidLng(v) { return v >= 122 && v <= 154; }

// --- CSV ヘッダー正規化（引用符・改行・括弧以降を除去） ---

function normalizeHeader(f) {
  return f
    .replace(/"/g, "")
    .replace(/[\r\n]/g, "")
    .replace(/[（(].*/, "")
    .trim();
}

// --- Spreadsheet CSV parsing (PapaParse + 部分一致ヘッダー検出) ---

const HEADER_KEYWORDS = {
  lat: "緯度",
  lng: "経度",
  date: "日付",
  time: "時間",
  place: "場所",
  situation: "状況",
  species: "種類",
};

// rows: string[][] （PapaParse の result.data）
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const fields = rows[i].map(normalizeHeader);
    const hasLat = fields.some((f) => f.includes("緯度"));
    const hasLng = fields.some((f) => f.includes("経度"));
    if (hasLat && hasLng) return { index: i, fields };
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
    if (lower.includes("lat")) colMap.lat = lower.indexOf("lat");
    if (lower.includes("lng")) colMap.lng = lower.indexOf("lng");
    if (colMap.date === undefined && lower.includes("date")) colMap.date = lower.indexOf("date");
    if (colMap.time === undefined && lower.includes("time")) colMap.time = lower.indexOf("time");
    if (colMap.place === undefined && lower.includes("place")) colMap.place = lower.indexOf("place");
    if (colMap.situation === undefined && lower.includes("situation")) colMap.situation = lower.indexOf("situation");
    if (colMap.species === undefined && lower.includes("species")) colMap.species = lower.indexOf("species");
  }
  return colMap;
}

function parseSnakeCSV(text) {
  const result = Papa.parse(text, { header: false, skipEmptyLines: true });
  const rows = result.data;

  const header = findHeaderRow(rows);
  if (!header) {
    console.warn("ヘビCSV: ヘッダー行（緯度/経度）が見つかりません");
    console.warn("先頭行:", rows[0]);
    return [];
  }

  const colMap = buildColumnMap(header.fields);
  if (colMap.lat === undefined || colMap.lng === undefined) {
    console.warn("ヘビCSV: 緯度/経度の列が特定できません", header.fields);
    return [];
  }

  const records = [];
  let totalRows = 0;
  let skipped = 0;

  for (let i = header.index + 1; i < rows.length; i++) {
    const fields = rows[i];
    if (fields.every((f) => String(f).trim() === "")) continue;
    totalRows++;

    const rawLat = String(fields[colMap.lat] ?? "").trim();
    const rawLng = String(fields[colMap.lng] ?? "").trim();
    const lat = parseCoord(rawLat);
    const lng = parseCoord(rawLng);

    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }
    if (!isValidLat(lat)) { console.warn(`行${i + 1}: 緯度が範囲外 (${lat})`); skipped++; continue; }
    if (!isValidLng(lng)) { console.warn(`行${i + 1}: 経度が範囲外 (${lng})`); skipped++; continue; }

    records.push({
      _lat: lat,
      _lng: lng,
      date: colMap.date !== undefined ? String(fields[colMap.date] ?? "").trim() : "",
      time: colMap.time !== undefined ? String(fields[colMap.time] ?? "").trim() : "",
      place: colMap.place !== undefined ? String(fields[colMap.place] ?? "").trim() : "",
      situation: colMap.situation !== undefined ? String(fields[colMap.situation] ?? "").trim() : "",
      species: colMap.species !== undefined ? (String(fields[colMap.species] ?? "").trim() || "不明") : "不明",
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

// --- Init ---
// ArcGIS の import はすべてここで動的に行う。
// トップレベルの static import にすると Rollup のチャンク分割後に
// 初期化順序が乱れ "Cannot access 'X' before initialization" (TDZ) が発生するため。

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
  } catch {
    weather = { cloudCover: 0, weatherCode: 0 };
    $weather.textContent = "天気: 取得失敗（晴れとして処理）";
  }

  const overcast = isOvercast(weather.cloudCover, weather.weatherCode);

  // 3. Map
  const userLayer = new GraphicsLayer({
    title: "現在地",
    elevationInfo: { mode: "relative-to-ground", offset: 3 },
  });

  const snakeLayer = new GraphicsLayer({
    title: "ヘビ出現",
    elevationInfo: { mode: "relative-to-ground", offset: 5 },
  });

  const reportLayer = new GraphicsLayer({
    title: "報告仮ピン",
    elevationInfo: { mode: "relative-to-ground", offset: 5 },
  });

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
    camera: {
      position: { latitude: loc.lat - 0.003, longitude: loc.lng, z: 600 },
      tilt: 65,
      heading: 0,
    },
    environment: {
      lighting: {
        type: "sun",
        date: new Date(),
        directShadowsEnabled: !overcast,
      },
      atmosphere: { quality: "high" },
    },
    popup: { defaultPopupTemplateEnabled: false },
    ui: { components: ["attribution"] },
  });

  view.environment.weather = {
    type: weatherCodeToType(weather.weatherCode),
    cloudCover: weather.cloudCover / 100,
  };

  view.when(() => {
    view.goTo({ target: userCenter, tilt: 65, zoom: 17 }, { duration: 0 });
  });

  // Shadow status
  function updateShadowStatus(shadowing) {
    if (shadowing) {
      $shadow.textContent = "影: ON（建物・地形の影＝日陰の目安です）";
    } else {
      $shadow.textContent = "影: OFF（曇り/雨のため屋外は全体的に日陰です）";
    }
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
    symbol: {
      type: "point-3d",
      symbolLayers: [{
        type: "icon",
        size: 18,
        resource: { primitive: "circle" },
        material: { color: [30, 120, 255, 0.9] },
        outline: { color: [255, 255, 255], size: 3 },
      }],
    },
    attributes: { label: "現在地" },
    popupTemplate: { title: "現在地", content: `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` },
  }));

  // Locate button
  document.getElementById("btn-locate").addEventListener("click", () => {
    view.goTo({ target: userCenter, tilt: 65, zoom: 17 }, { duration: 1000 });
  });

  // Zoom buttons
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    view.goTo({ zoom: view.zoom + 1 }, { duration: 300 });
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    view.goTo({ zoom: view.zoom - 1 }, { duration: 300 });
  });

  // Camera toggle
  const btnTop = document.getElementById("btn-top");
  const btnAngle = document.getElementById("btn-angle");

  btnTop.addEventListener("click", () => {
    btnTop.classList.add("active");
    btnAngle.classList.remove("active");
    view.goTo({ target: userCenter, tilt: 0, zoom: view.zoom }, { duration: 800 });
  });

  btnAngle.addEventListener("click", () => {
    btnAngle.classList.add("active");
    btnTop.classList.remove("active");
    view.goTo({ target: userCenter, tilt: 65, zoom: view.zoom }, { duration: 800 });
  });

  // 3D buildings
  try {
    const buildings = new SceneLayer({
      portalItem: { id: "ca0470dbbddb4db28bad74ed39949e25" },
    });
    map.add(buildings);
  } catch (e) {
    console.error("3D建物レイヤー読み込みエラー:", e);
  }

  // =============================================
  // 4. Snake pins (from Google Form response sheet)
  // =============================================

  const snakePopupTpl = new PopupTemplate({
    title: "{place}",
    content: [{
      type: "fields",
      fieldInfos: [
        { fieldName: "date", label: "日付" },
        { fieldName: "time", label: "時間" },
        { fieldName: "place", label: "場所" },
        { fieldName: "species", label: "種類" },
        { fieldName: "situation", label: "状況" },
      ],
    }],
  });

  function updateTimestamp() {
    const now = new Date();
    $snakeUpdated.textContent = `最終取得: ${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,"0")}/${now.getDate().toString().padStart(2,"0")} ${now.getHours()}:${now.getMinutes().toString().padStart(2,"0")}`;
    $snakeUpdated.style.fontSize = "11px";
    $snakeUpdated.style.color = "#888";
  }

  async function loadSnakeData() {
    snakeLayer.removeAll();
    try {
      const csvText = await fetchSnakeCSV();
      const records = parseSnakeCSV(csvText);

      for (const r of records) {
        snakeLayer.add(new Graphic({
          geometry: new Point({ latitude: r._lat, longitude: r._lng }),
          symbol: {
            type: "point-3d",
            symbolLayers: [{
              type: "icon",
              size: 16,
              resource: { primitive: "circle" },
              material: { color: [220, 40, 40, 0.9] },
              outline: { color: [255, 255, 255], size: 2 },
            }],
          },
          attributes: {
            date: r.date,
            time: r.time,
            place: r.place,
            species: r.species,
            situation: r.situation,
          },
          popupTemplate: snakePopupTpl,
        }));
      }

      $snakeCount.textContent = `ヘビ出現データ: ${records.length} 件`;
      updateInfoSummary();
      updateTimestamp();
    } catch (e) {
      console.error("ヘビCSV読み込みエラー:", e);
      $snakeCount.textContent = "ヘビデータの取得に失敗しました。ネットワークを確認してください。";
    }
  }

  await loadSnakeData();

  // Reload button
  document.getElementById("btn-reload-data").addEventListener("click", async () => {
    $snakeCount.textContent = "再読み込み中…";
    await loadSnakeData();
    notify("ヘビデータを再読み込みしました");
  });

  // =============================================
  // 5. Report mode (目撃情報を報告)
  // =============================================

  const $btnReport = document.getElementById("btn-report");
  const $reportBanner = document.getElementById("report-banner");
  const $reportConfirm = document.getElementById("report-confirm");
  const $reportCoords = document.getElementById("report-coords");
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
      const mapPoint = event.mapPoint;
      if (!mapPoint) return;

      reportCoords = { lat: mapPoint.latitude, lng: mapPoint.longitude };
      reportLayer.removeAll();
      reportLayer.add(new Graphic({
        geometry: new Point({ latitude: reportCoords.lat, longitude: reportCoords.lng }),
        symbol: {
          type: "point-3d",
          symbolLayers: [{
            type: "icon",
            size: 20,
            resource: { primitive: "circle" },
            material: { color: [37, 99, 235, 0.9] },
            outline: { color: [255, 255, 255], size: 3 },
          }],
        },
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
    if (reportClickHandler) {
      reportClickHandler.remove();
      reportClickHandler = null;
    }
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
    const lat = encodeURIComponent(reportCoords.lat.toFixed(6));
    const lng = encodeURIComponent(reportCoords.lng.toFixed(6));
    const url = `${REPORT_FORM_BASE}&entry.1411652182=${lat}&entry.410305265=${lng}`;
    window.open(url, "_blank");
    exitReportMode();
    notify("報告ありがとうございます。反映には時間がかかる場合があります。");
  });

  // =============================================
  // 6. Mode control (Realtime / Preview)
  // =============================================

  const $modeStatus = document.getElementById("mode-status");
  const $modeRealtime = document.getElementById("mode-realtime");
  const $modePreview = document.getElementById("mode-preview");
  const $previewPanel = document.getElementById("preview-panel");
  const $pvTimeSlider = document.getElementById("pv-time-slider");
  const $pvTimeDisplay = document.getElementById("pv-time-display");
  const $pvDatePicker = document.getElementById("pv-date-picker");
  const $pvPlay = document.getElementById("pv-play");
  const $pvCloudSlider = document.getElementById("pv-cloud-slider");
  const $pvCloudDisplay = document.getElementById("pv-cloud-display");
  const previewTabs = document.querySelectorAll(".preview-tab");
  const weatherBtns = document.querySelectorAll(".weather-btn");

  let playAnimId = null;

  // --- Info panel collapse/expand ---
  const $infoPanel = document.getElementById("info-panel");
  const $infoHeader = document.getElementById("info-header");
  const $infoSummary = document.getElementById("info-summary");

  function updateInfoSummary() {
    const countEl = document.getElementById("snake-count");
    const count = countEl ? countEl.textContent : "";
    $infoSummary.textContent = `ヘビ日陰マップ — ${count}`;
  }

  $infoHeader.addEventListener("click", () => {
    $infoPanel.classList.toggle("collapsed");
    setTimeout(positionModeUI, 310);
  });

  // --- Preview close button ---
  document.getElementById("preview-close").addEventListener("click", () => {
    $previewPanel.classList.add("minimized");
  });

  document.querySelectorAll(".preview-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $previewPanel.classList.remove("minimized");
    });
  });

  function positionModeUI() {
    const infoPanel = document.getElementById("info-panel");
    const modeToggle = document.getElementById("mode-toggle");
    const rect = infoPanel.getBoundingClientRect();
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
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...args); }
    };
  }

  function buildJSTDate(dateStr, minutes) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const h = Math.floor(minutes / 60);
    const min = Math.round(minutes % 60);
    const utc = Date.UTC(y, m - 1, d, h, min, 0) - 9 * 60 * 60000;
    return new Date(utc);
  }

  function formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} JST`;
  }

  function todayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${(n.getMonth() + 1).toString().padStart(2, "0")}-${n.getDate().toString().padStart(2, "0")}`;
  }

  function nowMinutes() {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  }

  let pvWeatherType = "sunny";
  let pvCloudCover = 30;

  function shouldShadowPreview() {
    return !(pvWeatherType !== "sunny" && pvCloudCover >= 70);
  }

  const applyPreviewEnv = throttle(() => {
    const minutes = parseInt($pvTimeSlider.value);
    const dateStr = $pvDatePicker.value;
    $pvTimeDisplay.textContent = formatTime(minutes);

    const shadowing = shouldShadowPreview();
    view.environment.lighting.date = buildJSTDate(dateStr, minutes);
    view.environment.lighting.directShadowsEnabled = shadowing;
    view.environment.weather = {
      type: pvWeatherType,
      cloudCover: pvCloudCover / 100,
    };

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
    if (playAnimId !== null) {
      cancelAnimationFrame(playAnimId);
      playAnimId = null;
    }
    $pvPlay.textContent = "▶";
    $pvPlay.classList.remove("playing");
  }

  $pvPlay.addEventListener("click", () => {
    if (playAnimId !== null) { stopPlay(); return; }
    $pvPlay.textContent = "■";
    $pvPlay.classList.add("playing");
    let val = parseInt($pvTimeSlider.value);
    if (val >= 1440) val = 0;
    let lastTs = null;

    function step(ts) {
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      val += dt * 0.15;
      if (val >= 1440) {
        val = 1440;
        $pvTimeSlider.value = val;
        applyPreviewEnv();
        stopPlay();
        return;
      }
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
    $modeRealtime.classList.add("active");
    $modePreview.classList.remove("active");
    $previewPanel.classList.add("hidden");
    stopPlay();

    $modeStatus.textContent = "モード: リアルタイム";
    (async () => {
      try {
        const w = await getWeather(loc.lat, loc.lng);
        weather = w;
        $weather.textContent = `天気: ${weatherCodeLabel(w.weatherCode)}　雲量: ${w.cloudCover}%`;
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
    $modePreview.classList.add("active");
    $modeRealtime.classList.remove("active");
    $previewPanel.classList.remove("hidden");
    $previewPanel.classList.remove("minimized");
    positionModeUI();

    $pvDatePicker.value = todayStr();
    const mins = nowMinutes();
    $pvTimeSlider.value = mins;
    $pvTimeDisplay.textContent = formatTime(mins);

    pvWeatherType = weatherCodeToType(weather.weatherCode);
    weatherBtns.forEach((b) => {
      b.classList.toggle("active", b.dataset.weather === pvWeatherType);
    });

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

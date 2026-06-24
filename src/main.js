import esriConfig from "@arcgis/core/config";
import Map from "@arcgis/core/Map";
import SceneView from "@arcgis/core/views/SceneView";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import PopupTemplate from "@arcgis/core/PopupTemplate";

const DEFAULT_LAT = 33.9737;
const DEFAULT_LNG = 134.3601;

// ヘビ出現データ（公開Googleスプレッドシート）
const SNAKE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1uyzzSIniWKDAk1QEGD7lXpi26nC3u_HGApOHQDfLY7E/export?format=csv&gid=850697240";
const SNAKE_LOCAL_URL = import.meta.env.BASE_URL + "data/snakes.csv";

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

esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;

// --- Location ---

async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
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
  return {
    cloudCover: data.current.cloud_cover,
    weatherCode: data.current.weather_code,
  };
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

// --- CSV parsing (引用符対応) ---

function splitCSVLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  fields.push(cur);
  return fields;
}

// --- 座標の正規化 ---

function toHalfWidth(s) {
  return s.replace(/[０-９．]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

function parseCoord(raw) {
  if (!raw) return NaN;
  let s = toHalfWidth(raw.trim());
  if (s === "" || s === "不明") return NaN;

  // 度分秒: 33°57'59.1 or 134°21′22.2 etc.
  const dms = s.match(/^(\d+(?:\.\d+)?)\s*[°度]\s*(\d+(?:\.\d+)?)\s*['''′]\s*(\d+(?:\.\d+)?)?/);
  if (dms) {
    const d = parseFloat(dms[1]);
    const m = parseFloat(dms[2]);
    const sec = dms[3] ? parseFloat(dms[3]) : 0;
    return d + m / 60 + sec / 3600;
  }

  const num = parseFloat(s);
  return num;
}

function isValidLat(v) { return v >= 20 && v <= 46; }
function isValidLng(v) { return v >= 122 && v <= 154; }

// --- Spreadsheet CSV parsing ---

const HEADER_MAP = {
  lat: ["緯度"],
  lng: ["経度"],
  date: ["ヘビ目撃（発見）年月日", "date"],
  time: ["ヘビ目撃（発見）時間", "time"],
  place: ["ヘビ目撃（発見）場所", "place"],
  situation: ["状況", "situation"],
  species: ["ヘビの種類", "species"],
  no: ["データno.", "データno", "no"],
};

function findHeaderRow(lines) {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const fields = splitCSVLine(lines[i]);
    const lower = fields.map((f) => f.trim().toLowerCase());
    if (lower.some((f) => f === "緯度") && lower.some((f) => f === "経度")) {
      return { index: i, fields: fields.map((f) => f.trim()) };
    }
    if (lower.some((f) => f === "lat") && lower.some((f) => f === "lng")) {
      return { index: i, fields: fields.map((f) => f.trim()) };
    }
  }
  return null;
}

function buildColumnMap(headerFields) {
  const colMap = {};
  const lowerFields = headerFields.map((f) => f.toLowerCase());
  for (const [key, candidates] of Object.entries(HEADER_MAP)) {
    for (const c of candidates) {
      const idx = lowerFields.indexOf(c.toLowerCase());
      if (idx !== -1) {
        colMap[key] = idx;
        break;
      }
    }
  }
  return colMap;
}

function parseSnakeCSV(text) {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.trim().split(/\r?\n/);
  const header = findHeaderRow(lines);
  if (!header) {
    console.warn("ヘビCSV: ヘッダー行（緯度/経度）が見つかりません");
    return [];
  }

  const colMap = buildColumnMap(header.fields);
  if (colMap.lat === undefined || colMap.lng === undefined) {
    console.warn("ヘビCSV: 緯度/経度の列が特定できません");
    return [];
  }

  const records = [];
  let totalRows = 0;
  let skipped = 0;

  for (let i = header.index + 1; i < lines.length; i++) {
    const fields = splitCSVLine(lines[i]);
    const noVal = colMap.no !== undefined ? fields[colMap.no]?.trim() : "";
    if (colMap.no !== undefined && !noVal) continue;
    totalRows++;

    const rawLat = fields[colMap.lat]?.trim() ?? "";
    const rawLng = fields[colMap.lng]?.trim() ?? "";
    const lat = parseCoord(rawLat);
    const lng = parseCoord(rawLng);

    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }
    if (!isValidLat(lat)) {
      console.warn(`行${i + 1}: 緯度が範囲外 (${lat})、スキップ`);
      skipped++; continue;
    }
    if (!isValidLng(lng)) {
      console.warn(`行${i + 1}: 経度が範囲外 (${lng})、スキップ`);
      skipped++; continue;
    }

    records.push({
      _lat: lat,
      _lng: lng,
      date: fields[colMap.date]?.trim() ?? "",
      time: fields[colMap.time]?.trim() ?? "",
      place: fields[colMap.place]?.trim() ?? "",
      situation: fields[colMap.situation]?.trim() ?? "",
      species: fields[colMap.species]?.trim() || "不明",
    });
  }

  console.log(`ヘビCSV: 総行数=${totalRows}, 有効=${records.length}, スキップ=${skipped}`);
  return records;
}

// --- Fetch snake data (spreadsheet → local fallback) ---

async function fetchSnakeCSV() {
  try {
    const res = await fetch(SNAKE_SHEET_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn("Googleスプレッドシートからの取得失敗（CORSエラーの可能性あり）:", e.message);
    console.log("フォールバック: ローカルCSVを読み込みます");
    const res = await fetch(SNAKE_LOCAL_URL);
    if (!res.ok) throw new Error(`ローカルCSVも取得失敗: HTTP ${res.status}`);
    return await res.text();
  }
}

// --- Init ---

async function init() {
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

  const map = new Map({
    basemap: "arcgis/topographic",
    ground: "world-elevation",
    layers: [snakeLayer, userLayer],
  });

  const userCenter = new Point({ latitude: loc.lat, longitude: loc.lng });

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

  view.when(() => {
    view.goTo({ target: userCenter, tilt: 65, zoom: 17 }, { duration: 0 });
  });

  // Shadow status
  if (overcast) {
    $shadow.textContent = "影: OFF（曇り/雨のため屋外は全体的に日陰です）";
    notify("今は曇り/雨のため屋外は全体的に日陰です");
  } else {
    $shadow.textContent = "影: ON（建物・地形の影＝日陰の目安です）";
  }

  // User location pin
  userLayer.add(new Graphic({
    geometry: new Point({ latitude: loc.lat, longitude: loc.lng }),
    symbol: {
      type: "point-3d",
      symbolLayers: [
        {
          type: "icon",
          size: 18,
          resource: { primitive: "circle" },
          material: { color: [30, 120, 255, 0.9] },
          outline: { color: [255, 255, 255], size: 3 },
        },
      ],
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

  // 4. Snake pins (from Google Spreadsheet)
  try {
    const csvText = await fetchSnakeCSV();
    const records = parseSnakeCSV(csvText);

    const popupTpl = new PopupTemplate({
      title: "{place}",
      content: [
        {
          type: "fields",
          fieldInfos: [
            { fieldName: "date", label: "日付" },
            { fieldName: "time", label: "時間" },
            { fieldName: "place", label: "場所" },
            { fieldName: "species", label: "種類" },
            { fieldName: "situation", label: "状況" },
          ],
        },
      ],
    });

    for (const r of records) {
      const graphic = new Graphic({
        geometry: new Point({ latitude: r._lat, longitude: r._lng }),
        symbol: {
          type: "point-3d",
          symbolLayers: [
            {
              type: "icon",
              size: 16,
              resource: { primitive: "circle" },
              material: { color: [220, 40, 40, 0.9] },
              outline: { color: [255, 255, 255], size: 2 },
            },
          ],
        },
        attributes: {
          date: r.date,
          time: r.time,
          place: r.place,
          species: r.species,
          situation: r.situation,
        },
        popupTemplate: popupTpl,
      });
      snakeLayer.add(graphic);
    }

    $snakeCount.textContent = `ヘビ出現データ: ${records.length} 件`;
    const now = new Date();
    $snakeUpdated.textContent = `最終取得: ${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,"0")}/${now.getDate().toString().padStart(2,"0")} ${now.getHours()}:${now.getMinutes().toString().padStart(2,"0")}`;
    $snakeUpdated.style.fontSize = "11px";
    $snakeUpdated.style.color = "#888";
  } catch (e) {
    console.error("ヘビCSV読み込みエラー:", e);
    $snakeCount.textContent = "ヘビデータ: 読み込み失敗";
  }
}

init();

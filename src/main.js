import esriConfig from "@arcgis/core/config";
import Map from "@arcgis/core/Map";
import SceneView from "@arcgis/core/views/SceneView";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import PopupTemplate from "@arcgis/core/PopupTemplate";

const DEFAULT_LAT = 33.9737;
const DEFAULT_LNG = 134.3601;

const $location = document.getElementById("location-status");
const $weather = document.getElementById("weather-status");
const $shadow = document.getElementById("shadow-status");
const $snakeCount = document.getElementById("snake-count");
const $notification = document.getElementById("notification");

function notify(msg) {
  $notification.textContent = msg;
  $notification.classList.remove("hidden");
  setTimeout(() => $notification.classList.add("hidden"), 6000);
}

esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;

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

function parseCSV(text) {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.trim().split("\n");
  const headers = lines[0].split(",");
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",");
    if (vals.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => (row[h.trim()] = vals[idx]?.trim() ?? ""));
    const lat = parseFloat(row.lat);
    const lng = parseFloat(row.lng);
    if (isNaN(lat) || isNaN(lng)) continue;
    row._lat = lat;
    row._lng = lng;
    records.push(row);
  }
  return records;
}

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

  // 4. Snake pins
  try {
    const res = await fetch(import.meta.env.BASE_URL + "data/snakes.csv");
    const text = await res.text();
    const records = parseCSV(text);

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
          species: r.species || "不明",
          situation: r.situation,
        },
        popupTemplate: popupTpl,
      });
      snakeLayer.add(graphic);
    }

    $snakeCount.textContent = `ヘビ出現データ: ${records.length} 件`;
  } catch (e) {
    console.error("ヘビCSV読み込みエラー:", e);
    $snakeCount.textContent = "ヘビデータ: 読み込み失敗";
  }
}

init();

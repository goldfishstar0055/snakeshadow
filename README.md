# ヘビ日陰マップ 🗺️

「ヘビの出ない日陰で過ごしたい」を叶える、ArcGIS 3Dマップのブラウザアプリです。

**デモ**: https://goldfishstar0055.github.io/snakeshadow/

## 機能

- 現在地の自動取得（取得できない場合は神山まるごと高専周辺を表示）
- Open-Meteo API で現在の天気・雲量を取得
- 晴れの場合: 太陽位置に基づく建物・地形の3D影（日陰の目安）を表示
- 曇り/雨の場合: 影表示OFF＋「全体的に日陰」メッセージ
- ヘビ出現ポイントを赤ピンで表示（クリックで日付・種類・場所などをポップアップ）
- カメラ切り替え（真上 / 斜め）

## ローカル開発

```bash
npm install
cp .env.example .env
# .env に ArcGIS API キーを設定
# public/data/snakes.csv にヘビ出現CSVを配置
npm run dev
```

## 技術スタック

- Vite + Vanilla JavaScript
- ArcGIS Maps SDK for JavaScript（3D SceneView）
- Open-Meteo API（天気・雲量取得、APIキー不要）

## データ

`public/data/snakes.csv` — 神山町周辺でのヘビ目撃記録（有志による収集データ）

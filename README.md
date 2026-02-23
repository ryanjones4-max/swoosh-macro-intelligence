# Swoosh Macro Intelligence

Real-time macroeconomic dashboard covering US Economy, Global Markets, and Footwear & Apparel Industry data — powered by FRED, Yahoo Finance, live news feeds, and Gemini AI.

## Live Dashboard

**URL:** `https://swoosh-macro-intelligence.onrender.com`

## Features

- **12 AI-powered insight sections** via Google Gemini 2.5 Flash with Google Search grounding
- **80+ FRED economic series** — GDP, unemployment, inflation, rates, housing, and more
- **Live commodity prices** — Gold, WTI Crude, Brent Crude via Yahoo Finance
- **Real-time news** — Aggregated from Google News, CNBC, MarketWatch, BBC, Yahoo Finance RSS feeds
- **AI podcast** — Two-speaker daily macro briefing script
- **Three scopes** — US Economy, Global, Industry (Footwear & Apparel)
- **Dark theme** with trend color-coding (green/red arrows for period-over-period changes)

## Quick Start

```bash
npm install
npm start
# → http://localhost:3000
```

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

Or connect your GitHub repo at [render.com/new](https://render.com/new) — the included `render.yaml` handles all configuration.

## Architecture

```
Browser (public/)
  ├── index.html        — Static shell
  ├── styles.css        — Full dark theme
  ├── app.js            — Application logic, all tab renderers
  ├── fred-api.js       — FRED data client
  ├── charts.js         — Chart.js rendering
  └── events.js         — Calendar & analytics

Server (server.js)
  ├── GET /api/fred         — FRED API proxy
  ├── GET /api/prices       — Yahoo Finance commodity prices
  ├── GET /api/gold-history — Gold price history
  ├── GET /api/news         — RSS news aggregation
  ├── GET /api/insights     — Gemini AI insights (12 sections)
  └── GET /api/podcast      — Gemini AI podcast script
```

## Tech Stack

- **Runtime:** Node.js + Express
- **AI:** Google Gemini 2.5 Flash (REST API with Google Search grounding)
- **Data:** FRED API, Yahoo Finance, RSS feeds
- **Frontend:** Vanilla JS, Chart.js, Material Icons, Inter font
- **No build step** — pure HTML/CSS/JS

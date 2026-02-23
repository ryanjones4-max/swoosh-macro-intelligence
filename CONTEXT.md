# Macro Dashboard Clone — Project Context

## What This Is
A clone of https://macro-chi-henna.vercel.app/ — a real-time macroeconomic dashboard showing US Economy, Global, and Industry (Footwear & Apparel) data with charts, AI-generated insights, live news, and a podcast player.

## Current Status: 100% Complete ✓

All data sources are live. No mock data remains.

### How To Run

```bash
# Node.js is installed at ~/.local/node-v22.14.0-darwin-arm64/
export PATH="$HOME/.local/node-v22.14.0-darwin-arm64/bin:$PATH"

# Install dependencies (if node_modules is missing)
npm install

# Start the server
npm start
# → http://localhost:3000
```

**Note:** Node.js was installed locally (not via Homebrew) because the system lacks sudo/admin access. The PATH export is needed in each new terminal session. To make it permanent, add the export line to `~/.zshrc`.

### Project Files

| File | Lines | Description |
|------|-------|-------------|
| `server.js` | ~670 | Express server — FRED proxy, Yahoo Finance prices, RSS news scraping, Gemini AI insights (all 12 sections), podcast generation |
| `public/index.html` | 181 | HTML shell — splash screen, header with scope toggle (US/Global/Industry), tab bars, ticker tape, podcast overlay, footer |
| `public/styles.css` | 2712 | Full dark theme CSS — all components, animations, responsive breakpoints |
| `public/app.js` | 3389 | Main application — tab rendering, data loading, 20+ tab views, AI section rendering, news, industry dashboards |
| `public/fred-api.js` | 284 | FRED API client — 80+ economic series definitions, fetch/cache logic, YoY calculations |
| `public/charts.js` | 242 | Chart.js wrapper — line, bar, sparkline charts with crosshair plugin |
| `public/events.js` | 149 | Economic calendar (FOMC 2026, recurring releases), briefing generator, recession indicators, health score |
| `package.json` | 14 | Dependencies: express, xml2js |

### API Endpoints (all live)

| Endpoint | Data Source | Cache TTL | Details |
|----------|------------|-----------|---------|
| `GET /api/fred` | FRED API (api.stlouisfed.org) | 30 min | Proxies requests, adds API key. Key: `98a1be06...` |
| `GET /api/prices` | Yahoo Finance chart API | 5 min | Gold (GC=F), WTI Crude (CL=F), Brent Crude (BZ=F) |
| `GET /api/gold-history?years=N` | Yahoo Finance chart API | 1 hour | Daily gold closing prices, 1-5 year range |
| `GET /api/news[?scope=global]` | RSS feeds (Google News, CNBC, MarketWatch, BBC, Yahoo Finance) | 10 min | Scraped, deduplicated, relevance-scored, sorted |
| `GET /api/insights?s=SECTION` | Google Gemini 2.5 Flash + Google Search grounding | 6 hours | 12 sections (see below). JSON responses with `_sources` |
| `GET /api/podcast` | Google Gemini 2.5 Flash + Google Search grounding | 6 hours | 7-10 line two-speaker podcast script |

### Gemini AI Sections (12 insight endpoints)

Each is requested via `/api/insights?s=SECTION_KEY`:

| Key | Powers | Scope |
|-----|--------|-------|
| `us_economy` | Macro, inflation, jobs, markets, consumer, housing briefings | US > Daily Read, Overview |
| `us_industry` | Footwear & apparel demand, pricing, youth, digital, trends | US > Daily Read, Overview |
| `us_youth` | 9 youth culture insight cards (sneakers, BNPL, resale, etc.) | US > Industry Overview |
| `collectibles` | Sneaker resale, trading cards, watches, vintage fashion deep dive | US > Overview |
| `global_daily` | Europe, China, Asia, EM, commodities, gold, risk | Global > Daily Read |
| `global_regional` | Regional economic pulse (Europe, Asia, China, EM) | Global > Overview |
| `global_industry` | Euro luxury, China consumer, Asia manufacturing, digital, sustainability | Global > Overview |
| `industry_trends` | 12 trend cards (6 macro + 6 cultural) | Industry > Macro Trends |
| `industry_footwear` | Silhouettes, brand momentum (6 brands), category breakdown | Industry > Footwear |
| `industry_apparel` | Aesthetics, brand momentum, categories | Industry > Apparel |
| `industry_color` | Color palettes (6+), materials (4+), design details (5+) | Industry > Color & Material |
| `industry_consumer` | Generational profiles, shopping behavior, cultural influences | Industry > Consumer |

### API Keys

| Service | Key | Location |
|---------|-----|----------|
| FRED API | `98a1be06f9fa0a9aefa91e1dbaa888bb` | `server.js` line 10, `public/fred-api.js` |
| Google Gemini | `AIzaSyBYV2K9632Pqf5hL0_wXaPd48zMAl32UuQ` | `server.js` line 12 (also accepts `GEMINI_API_KEY` env var) |

### Technical Details

- **Gemini Model:** `gemini-2.5-flash` (via v1beta REST API with Google Search grounding)
- **Rate limiting:** Server queues Gemini calls — max 2 concurrent, 4s delay between calls
- **JSON parsing:** Gemini responses are text (not JSON mode) because `responseMimeType: 'application/json'` is incompatible with Google Search grounding tools. JSON is extracted via regex from the text response.
- **SSL:** `rejectUnauthorized: false` is set on HTTP requests to handle corporate/proxy SSL certificate issues
- **Error handling:** `uncaughtException` and `unhandledRejection` handlers prevent server crashes from individual Gemini failures
- **CDN dependencies** (loaded in index.html, no npm needed): Chart.js 4.4.1, chartjs-adapter-date-fns 3.0.0, Google Fonts: Inter, Material Icons Outlined
- **No build step** — Pure vanilla JS, no React/Vue/bundler
- **Node.js:** v22.14.0 installed at `~/.local/node-v22.14.0-darwin-arm64/`

### Trend Color Coding (▲/▼ arrows)

The `md()` function in `app.js` (line ~2423) post-processes all AI text to color-code directional data:
- `▲` + number + change descriptor (%, MoM, YoY, bps, jobs, etc.) → wrapped in `<span class="trend-up">` (green `#22c55e`)
- `▼` + number + change descriptor → wrapped in `<span class="trend-down">` (red `#ef4444`)
- Arrows are ONLY for period-over-period changes — never for absolute levels, market sizes, or static shares
- Standalone `▲`/`▼` without a recognized change pattern are silently removed (not colored)
- CSS classes `.trend-up` and `.trend-down` in `styles.css` (line ~1128) handle the coloring
- All 12 Gemini prompts share an `ARROW_RULES` constant in `server.js` with strict examples of correct vs incorrect usage
- The `md()` function also handles nested objects from Gemini (flattens them by joining string values)

## Architecture

```
Browser (public/)
  ├── index.html        — Static shell
  ├── styles.css        — All styling
  ├── fred-api.js       — FRED data client (calls /api/fred)
  ├── charts.js         — Chart.js rendering
  ├── events.js         — Calendar & analytics
  └── app.js            — Application logic, all tab renderers

Server (server.js)
  ├── GET /api/fred         — Proxies to FRED API (adds API key)
  ├── GET /api/prices       — Live commodity prices (Yahoo Finance)
  ├── GET /api/gold-history — Gold price history (Yahoo Finance)
  ├── GET /api/news         — Real news from RSS feeds (scored & ranked)
  ├── GET /api/insights     — AI-generated insights (Gemini 2.5 Flash + Google Search)
  └── GET /api/podcast      — AI-generated podcast script (Gemini 2.5 Flash)
```

## Dashboard Sections (Tabs)

### US Economy scope
- Daily Read (AI briefings + news)
- Overview (health score, recession indicators, yield curve, S&P 500, collectibles deep dive)
- Industry Overview (footwear & apparel deep dive, youth insights)
- Growth & Output, Labor Market, Inflation, Rates & Policy, Markets, Consumer & Business, Housing, Population & Migration
- Key Events (economic calendar)
- Headlines (news)

### Global scope
- Daily Read, Overview, Commodities, Currencies, Headlines

### Industry scope
- Macro Trends, Footwear, Apparel, Color & Material, Consumer

## Potential Future Work
- Add TTS audio to podcast (edge-tts or Google Cloud TTS)
- Add a `.env` file for API keys instead of hardcoding
- Add persistent disk caching (file-based) so insights survive server restarts
- Set up the PATH export in `~/.zshrc` for permanent Node.js availability
- Deploy to Vercel/Railway for public hosting

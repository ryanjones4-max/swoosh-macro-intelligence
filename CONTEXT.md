# Swoosh Macro Intelligence — Project Context

## What This Is
A clone of https://macro-chi-henna.vercel.app/ — a real-time macroeconomic dashboard showing US Economy, Global, and Industry (Footwear & Apparel) data with charts, AI-generated insights, live news, and a podcast player. Rebranded as **Swoosh Macro Intelligence**.

## Current Status

### Working
- All FRED API charts populate correctly (80+ economic series)
- Yahoo Finance commodity prices (Gold, WTI Crude, Brent Crude) working
- RSS news aggregation from Google News, CNBC, MarketWatch, BBC, Yahoo Finance working
- Trend color-coding (▲/▼ arrows) fixed — only shows on period-over-period changes
- Dashboard fully styled with dark theme, responsive
- All 3 scopes (US Economy, Global, Industry) with full tab navigation

### Deployed
- **Vercel:** https://swoosh-macro-intelligence.vercel.app
- **GitHub:** Connected to ryanjones4-2821s-projects (pushed via `origin`)
- Vercel routes all requests through `server.js` with 30s function timeout for slow FRED API calls

### Known Issues
- **Gemini AI insights:** Active with replacement API key. The original key was leaked in a public GitHub commit and revoked by Google; a new key has been set.
- **Gemini free tier limits:** Even with a valid key, the free Gemini tier can hit quota limits under heavy load (12 insight sections + podcast = 13 API calls per page load)
- **Chart.js canvas warnings:** Minor "Canvas is already in use" warnings may appear in console when switching tabs; non-blocking

## How To Run Locally

```bash
# Node.js is installed at ~/.local/node-v22.14.0-darwin-arm64/
export PATH="$HOME/.local/node-v22.14.0-darwin-arm64/bin:$PATH"

# Install dependencies (if node_modules is missing)
npm install

# Gemini API key is loaded from .env file (gitignored) via dotenv
# If .env is missing, create it: echo 'GEMINI_API_KEY=your_key_here' > .env

# Start the server
npm start
# → http://localhost:3000
```

**Note:** Node.js was installed locally (not via Homebrew) because the system lacks sudo/admin access. The PATH export is needed in each new terminal session. To make it permanent, add the export line to `~/.zshrc`.

## Project Files

| File | Lines | Description |
|------|-------|-------------|
| `server.js` | ~689 | Express server — FRED proxy, Yahoo Finance prices, RSS news scraping, Gemini AI insights (all 12 sections), podcast generation |
| `public/index.html` | 181 | HTML shell — splash screen, header with scope toggle (US/Global/Industry), tab bars, ticker tape, podcast overlay, footer |
| `public/styles.css` | 2715 | Full dark theme CSS — all components, animations, responsive breakpoints |
| `public/app.js` | 3403 | Main application — tab rendering, data loading, 20+ tab views, AI section rendering, news, industry dashboards |
| `public/fred-api.js` | 284 | FRED API client — 80+ economic series definitions, fetch/cache logic, YoY calculations |
| `public/charts.js` | 242 | Chart.js wrapper — line, bar, sparkline charts with crosshair plugin |
| `public/events.js` | 149 | Economic calendar (FOMC 2026, recurring releases), briefing generator, recession indicators, health score |
| `package.json` | 14 | Dependencies: express, xml2js |
| `vercel.json` | 13 | Vercel deployment config — routes all requests to server.js, 30s function timeout |
| `render.yaml` | 12 | Render.com deployment config (alternative to Vercel) |
| `README.md` | 60 | Public-facing readme with architecture and deploy instructions |
| `CONTEXT.md` | this | Full project context for AI assistants |

## API Endpoints (all live)

| Endpoint | Data Source | Cache TTL | Details |
|----------|------------|-----------|---------|
| `GET /api/fred` | FRED API (api.stlouisfed.org) | 30 min | Proxies requests, adds API key. Key: `98a1be06...` |
| `GET /api/prices` | Yahoo Finance chart API | 5 min | Gold (GC=F), WTI Crude (CL=F), Brent Crude (BZ=F) |
| `GET /api/gold-history?years=N` | Yahoo Finance chart API | 1 hour | Daily gold closing prices, 1-5 year range |
| `GET /api/news[?scope=global]` | RSS feeds (Google News, CNBC, MarketWatch, BBC, Yahoo Finance) | 10 min | Scraped, deduplicated, relevance-scored, sorted |
| `GET /api/insights?s=SECTION` | Google Gemini 2.5 Flash + Google Search grounding | 6 hours | 12 sections (see below). JSON responses with `_sources` |
| `GET /api/podcast` | Google Gemini 2.5 Flash + Google Search grounding | 6 hours | 7-10 line two-speaker podcast script |

## Gemini AI Sections (12 insight endpoints)

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

## API Keys

| Service | Key | Location | Status |
|---------|-----|----------|--------|
| FRED API | `98a1be06f9fa0a9aefa91e1dbaa888bb` | `server.js` line 10, `public/fred-api.js` | **Active** |
| Google Gemini | *(env var only)* | `GEMINI_API_KEY` env var — loaded via `dotenv` from `.env` file or set in hosting dashboard | **Active** — never hardcoded in source to prevent leaks. |

## Technical Details

- **Gemini Model:** `gemini-2.5-flash` (via v1beta REST API with Google Search grounding)
- **Rate limiting:** Server queues Gemini calls — max 2 concurrent, 4s delay between calls
- **JSON parsing:** Gemini responses are text (not JSON mode) because `responseMimeType: 'application/json'` is incompatible with Google Search grounding tools. JSON is extracted via regex from the text response.
- **SSL:** `rejectUnauthorized: false` is set on HTTP requests to handle corporate/proxy SSL certificate issues
- **Error handling:** `uncaughtException` and `unhandledRejection` handlers prevent server crashes from individual Gemini failures
- **CDN dependencies** (loaded in index.html, no npm needed): Chart.js 4.4.1, chartjs-adapter-date-fns 3.0.0, Google Fonts: Inter, Material Icons Outlined
- **No build step** — Pure vanilla JS, no React/Vue/bundler
- **Node.js:** v22.14.0 installed at `~/.local/node-v22.14.0-darwin-arm64/`

## Trend Color Coding (▲/▼ arrows)

The `md()` function in `app.js` (line ~2423) post-processes all AI text to color-code directional data:
- `▲` + number + change descriptor (%, MoM, YoY, bps, jobs, etc.) → wrapped in `<span class="trend-up">` (green `#22c55e`)
- `▼` + number + change descriptor → wrapped in `<span class="trend-down">` (red `#ef4444`)
- Arrows are ONLY for period-over-period changes — never for absolute levels, market sizes, or static shares
- Standalone `▲`/`▼` without a recognized change pattern are silently removed (not colored)
- CSS classes `.trend-up` and `.trend-down` in `styles.css` (line ~1128) handle the coloring
- All 12 Gemini prompts share an `ARROW_RULES` constant in `server.js` (line ~355) with strict examples of correct vs incorrect usage
- The `md()` function also handles nested objects from Gemini (flattens them by joining string values)

## Architecture

```
Browser (public/)
  ├── index.html        — Static shell
  ├── styles.css        — All styling
  ├── fred-api.js       — FRED data client (calls /api/fred proxy)
  ├── charts.js         — Chart.js rendering
  ├── events.js         — Calendar & analytics
  └── app.js            — Application logic, all tab renderers

Server (server.js)
  ├── GET /api/fred         — Proxies to FRED API (adds API key, avoids CORS)
  ├── GET /api/prices       — Live commodity prices (Yahoo Finance)
  ├── GET /api/gold-history — Gold price history (Yahoo Finance)
  ├── GET /api/news         — Real news from RSS feeds (scored & ranked)
  ├── GET /api/insights     — AI-generated insights (Gemini 2.5 Flash + Google Search)
  └── GET /api/podcast      — AI-generated podcast script (Gemini 2.5 Flash)
```

**IMPORTANT:** FRED API calls MUST go through the server proxy (`/api/fred`). Direct browser-to-FRED calls are blocked by CORS (FRED does not send `Access-Control-Allow-Origin` headers). This was tested and confirmed during development.

## Deployment Details

### Vercel (current)
- **URL:** https://swoosh-macro-intelligence.vercel.app
- **Config:** `vercel.json` routes all requests `/(.*) → server.js` using `@vercel/node`
- **Function timeout:** 30 seconds (`config.maxDuration: 30` in vercel.json) — required because FRED API responses can be slow
- **Git integration:** GitHub repo connected for auto-deploys on push to `main`
- **Branch:** `main` with 6 commits

### Render (alternative)
- **Config:** `render.yaml` defines a free-tier web service
- **Not currently deployed** — available as a backup platform

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

## Git History

```
f13ff09 Fix vercel.json: use config.maxDuration inside builds
774b4b4 Revert direct FRED calls (CORS blocked), increase function timeout
e972ae0 Call FRED API directly from browser when deployed
24ca87a Fix Vercel routing: route all requests through Express server
9844947 Add Vercel config, render.yaml, and README
1b6ba84 Initial commit: Swoosh Macro Intelligence dashboard
```

## Priority Next Steps

1. ~~**Update Vercel env var**~~ — Done. `GEMINI_API_KEY` set in Vercel dashboard.
2. ~~**Add `.env` support**~~ — Done. `dotenv` installed, `.env` file created (gitignored), hardcoded keys removed from source.
3. **Optional:** Add TTS audio to podcast, persistent disk caching for insights, improved error UI when AI is unavailable

## Previous Conversation Reference

Full transcript of all prior development work is at:
`/Users/rjon51/.cursor/projects/Users-rjon51-Documents-Macro-Dashboard-Clone/agent-transcripts/2306fe8b-27d2-4a5f-b379-413a38fc8aa7.txt`

Key topics covered in that conversation:
- Initial clone/build of entire dashboard from scratch
- FRED API integration and all 80+ economic series
- Gemini AI prompt engineering for all 12 sections
- Fixing trend arrow color coding (regex in `md()` + `ARROW_RULES` prompt constant)
- Deployment to Vercel (routing fixes, timeout increases, CORS proxy restoration)
- Branding as "Swoosh Macro Intelligence"
- API key leak and revocation incident (replaced with new key)

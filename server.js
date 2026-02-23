const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { parseString } = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;
const FRED_API_KEY = '98a1be06f9fa0a9aefa91e1dbaa888bb';
const FRED_BASE = 'https://api.stlouisfed.org/fred';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBYV2K9632Pqf5hL0_wXaPd48zMAl32UuQ';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── HTTP helpers ────────────────────────────────────────────

function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;
    const reqOpts = {
      timeout: opts.timeout || 15000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': opts.accept || '*/*',
        ...opts.headers,
      },
    };
    mod.get(url, reqOpts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, opts).then(resolve, reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpPost(url, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const payload = JSON.stringify(body);
    const reqOpts = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      timeout: opts.timeout || 60000,
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...opts.headers,
      },
    };
    const req = https.request(reqOpts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function fetchJSON(url, opts) {
  return httpGet(url, opts).then(d => JSON.parse(d));
}

function parseXML(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false, trim: true }, (err, result) => {
      err ? reject(err) : resolve(result);
    });
  });
}

// ── Cache ───────────────────────────────────────────────────

const cache = new Map();
function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data);
  return fn().then(data => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ── FRED Proxy ──────────────────────────────────────────────

app.get('/api/fred', async (req, res) => {
  try {
    const { _endpoint, ...params } = req.query;
    if (!_endpoint) return res.status(400).json({ error: 'Missing _endpoint' });
    const qs = new URLSearchParams({ ...params, api_key: FRED_API_KEY, file_type: 'json' });
    const url = `${FRED_BASE}/${_endpoint}?${qs}`;
    const data = await fetchJSON(url);
    res.set('Cache-Control', 'public, max-age=1800');
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'FRED API error', detail: e.message });
  }
});

// ── Live Prices (Yahoo Finance) ─────────────────────────────

async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`;
  const data = await fetchJSON(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose || meta.previousClose;
  const change = +(price - prev).toFixed(2);
  const changePct = +((change / prev) * 100).toFixed(2);
  return { price: +price.toFixed(2), prev: +prev.toFixed(2), change, changePct, direction: change >= 0 ? 'up' : 'down', currency: meta.currency || 'USD' };
}

app.get('/api/prices', async (req, res) => {
  try {
    const data = await cached('prices', 5 * 60 * 1000, async () => {
      const [gold, wti, brent] = await Promise.all([
        fetchYahooPrice('GC=F'), fetchYahooPrice('CL=F'), fetchYahooPrice('BZ=F'),
      ]);
      return { gold, oil_wti: wti, oil_brent: brent };
    });
    res.json(data);
  } catch (e) {
    console.error('Prices error:', e.message);
    res.json({
      gold: { price: 0, change: 0, changePct: 0, direction: 'up', error: true },
      oil_wti: { price: 0, change: 0, changePct: 0, direction: 'up', error: true },
      oil_brent: { price: 0, change: 0, changePct: 0, direction: 'up', error: true },
    });
  }
});

// ── Gold History (Yahoo Finance) ────────────────────────────

app.get('/api/gold-history', async (req, res) => {
  const years = parseInt(req.query.years) || 2;
  try {
    const data = await cached(`gold_history_${years}`, 60 * 60 * 1000, async () => {
      const period = years <= 1 ? '1y' : years <= 2 ? '2y' : '5y';
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=${period}&interval=1d`;
      const raw = await fetchJSON(url, { timeout: 15000 });
      const result = raw?.chart?.result?.[0];
      if (!result) throw new Error('No gold data');
      const timestamps = result.timestamp;
      const closes = result.indicators?.quote?.[0]?.close;
      if (!timestamps || !closes) throw new Error('Missing gold data fields');
      const points = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        points.push({ date: d.toISOString().slice(0, 10), value: +closes[i].toFixed(1) });
      }
      return points;
    });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (e) {
    console.error('Gold history error:', e.message);
    res.status(502).json({ error: 'Failed to fetch gold history' });
  }
});

// ── News (RSS scraping) ─────────────────────────────────────

const US_RSS_FEEDS = [
  { url: 'https://www.marketwatch.com/rss/topstories', source: 'MarketWatch — Top Stories', category: 'markets', icon: 'newspaper' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', source: 'CNBC — Economy', category: 'economy', icon: 'account_balance' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069', source: 'CNBC — Finance', category: 'markets', icon: 'candlestick_chart' },
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance — Markets', category: 'markets', icon: 'trending_up' },
  { url: 'https://news.google.com/rss/search?q=Nike+OR+Adidas+OR+footwear+OR+apparel+OR+sneakers+OR+Skechers+when:7d&hl=en-US&gl=US&ceid=US:en', source: 'Retail & Apparel', category: 'industry', icon: 'checkroom' },
  { url: 'https://news.google.com/rss/search?q=footwear+industry+OR+shoe+market+OR+athletic+apparel+when:30d&hl=en-US&gl=US&ceid=US:en', source: 'Footwear News', category: 'industry', icon: 'storefront' },
];

const GLOBAL_RSS_FEEDS = [
  { url: 'https://news.google.com/rss/search?q=central+bank+interest+rates+monetary+policy+when:3d&hl=en-US&gl=US&ceid=US:en', source: 'Central Banks', category: 'policy', icon: 'balance' },
  { url: 'https://news.google.com/rss/search?q=global+economy+GDP+trade+when:3d&hl=en-US&gl=US&ceid=US:en', source: 'Reuters — Europe & Asia', category: 'economy', icon: 'language' },
  { url: 'https://news.google.com/rss/search?q=tariff+OR+trade+deal+OR+trade+war+when:3d&hl=en-US&gl=US&ceid=US:en', source: 'FT — Global Trade', category: 'trade', icon: 'local_shipping' },
  { url: 'https://news.google.com/rss/search?q=gold+price+OR+oil+price+OR+commodity+when:3d&hl=en-US&gl=US&ceid=US:en', source: 'Gold & Commodities', category: 'commodities', icon: 'diamond' },
  { url: 'https://news.google.com/rss/search?q=forex+OR+dollar+OR+euro+OR+currency+when:3d&hl=en-US&gl=US&ceid=US:en', source: 'EM FX', category: 'currencies', icon: 'currency_exchange' },
  { url: 'https://news.google.com/rss/search?q=geopolitics+OR+election+OR+conflict+when:3d&hl=en-US&gl=US&ceid=US:en', source: 'BBC — World', category: 'geopolitics', icon: 'public' },
  { url: 'http://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC — Business', category: 'economy', icon: 'account_balance' },
  { url: 'http://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC — World', category: 'geopolitics', icon: 'public' },
  { url: 'https://news.google.com/rss/search?q=Nike+OR+Adidas+OR+Puma+OR+LVMH+OR+sneaker+OR+fashion+week+when:7d&hl=en-US&gl=US&ceid=US:en', source: 'Global Sportswear', category: 'industry', icon: 'directions_run' },
  { url: 'https://news.google.com/rss/search?q=luxury+fashion+OR+Gucci+OR+Prada+OR+Hermes+when:7d&hl=en-US&gl=US&ceid=US:en', source: 'European Luxury', category: 'industry', icon: 'checkroom' },
  { url: 'https://news.google.com/rss/search?q=fast+fashion+OR+Zara+OR+Shein+OR+Uniqlo+when:7d&hl=en-US&gl=US&ceid=US:en', source: 'Fast Fashion', category: 'industry', icon: 'storefront' },
  { url: 'https://news.google.com/rss/search?q=Africa+consumer+OR+emerging+market+retail+when:7d&hl=en-US&gl=US&ceid=US:en', source: 'Africa & EM Consumer', category: 'economy', icon: 'public' },
];

async function parseRSSFeed(feedConfig) {
  try {
    const xml = await httpGet(feedConfig.url, { accept: 'application/rss+xml, application/xml, text/xml', timeout: 10000 });
    const parsed = await parseXML(xml);
    const channel = parsed?.rss?.channel;
    if (!channel) return [];
    let items = channel.item;
    if (!items) return [];
    if (!Array.isArray(items)) items = [items];
    return items.slice(0, 8).map(item => {
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      const title = (typeof item.title === 'string' ? item.title : item.title?._ || '').trim();
      const link = (typeof item.link === 'string' ? item.link : item.link?._ || '').trim();
      let summary = '';
      if (item.description) {
        summary = (typeof item.description === 'string' ? item.description : item.description?._ || '')
          .replace(/<[^>]*>/g, '').trim().slice(0, 300);
      }
      const sourceMatch = title.match(/\s-\s([^-]+)$/);
      const source = sourceMatch ? sourceMatch[1].trim() : feedConfig.source;
      return {
        title: sourceMatch ? title.replace(/\s-\s[^-]+$/, '').trim() : title,
        link, summary,
        date: pubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
        source, category: feedConfig.category, icon: feedConfig.icon, _ts: pubDate.getTime(),
      };
    });
  } catch (e) {
    console.error(`RSS fetch failed for ${feedConfig.source}:`, e.message);
    return [];
  }
}

function scoreArticles(articles) {
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const KW = {
    'fed': 15, 'federal reserve': 20, 'inflation': 15, 'gdp': 15, 'unemployment': 12,
    'rate cut': 18, 'rate hike': 18, 'tariff': 16, 'economy': 10, 's&p 500': 14,
    'nasdaq': 12, 'dow': 12, 'earnings': 10, 'housing': 10, 'consumer': 10,
    'nike': 20, 'adidas': 18, 'puma': 15, 'sneaker': 16, 'footwear': 16,
    'apparel': 14, 'fashion': 12, 'retail': 10, 'oil': 12, 'gold': 12,
    'treasury': 14, 'bond': 10, 'bitcoin': 10, 'crypto': 8,
    'trade deal': 14, 'trade war': 14, 'central bank': 16, 'ecb': 14, 'boe': 12,
    'china': 12, 'europe': 10, 'japan': 10, 'currency': 12, 'forex': 10,
    'geopolit': 10, 'election': 10, 'conflict': 8, 'commodity': 12,
  };
  return articles.map(a => {
    const text = (a.title + ' ' + a.summary).toLowerCase();
    let relevance = 0;
    for (const [kw, score] of Object.entries(KW)) { if (text.includes(kw)) relevance += score; }
    relevance = Math.min(relevance, 60);
    const age = now - (a._ts || now);
    const recency = Math.max(0, ((1 - age / maxAge) * 100));
    const score = relevance * 0.6 + recency * 0.4 + (a.summary ? 5 : 0);
    return { ...a, relevance: +relevance.toFixed(0), recency: +recency.toFixed(1), score: +score.toFixed(2) };
  }).filter(a => a.title && a.link).sort((a, b) => b.score - a.score);
}

async function fetchAllNews(feeds) {
  const results = await Promise.all(feeds.map(f => parseRSSFeed(f)));
  const all = results.flat();
  const seen = new Set();
  const unique = all.filter(a => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return scoreArticles(unique);
}

app.get('/api/news', async (req, res) => {
  const scope = req.query.scope;
  const feeds = scope === 'global' ? GLOBAL_RSS_FEEDS : US_RSS_FEEDS;
  try {
    const articles = await cached(`news_${scope || 'us'}`, 10 * 60 * 1000, () => fetchAllNews(feeds));
    res.json({ articles });
  } catch (e) {
    console.error('News error:', e.message);
    res.json({ articles: [] });
  }
});

// ── Gemini API Client ───────────────────────────────────────

const geminiQueue = [];
let geminiActive = 0;
const GEMINI_CONCURRENCY = 2;
const GEMINI_DELAY_MS = 4000;

function geminiGenerate(prompt, jsonMode = true) {
  return new Promise((resolve, reject) => {
    geminiQueue.push({ prompt, jsonMode, resolve, reject });
    drainGeminiQueue();
  });
}

function drainGeminiQueue() {
  while (geminiActive < GEMINI_CONCURRENCY && geminiQueue.length > 0) {
    geminiActive++;
    const { prompt, jsonMode, resolve, reject } = geminiQueue.shift();
    executeGeminiCall(prompt, jsonMode)
      .then(resolve, reject)
      .finally(() => {
        geminiActive--;
        setTimeout(drainGeminiQueue, GEMINI_DELAY_MS);
      });
  }
}

async function executeGeminiCall(prompt, jsonMode) {
  const body = {
    contents: [{ parts: [{ text: prompt + (jsonMode ? '\n\nIMPORTANT: Return ONLY valid JSON. No markdown fences, no explanation — just the JSON object.' : '') }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };
  const url = `${GEMINI_URL}?key=${GEMINI_API_KEY}`;
  const resp = await httpPost(url, body, { timeout: 90000 });

  if (resp.error) {
    throw new Error(`Gemini API error: ${resp.error.message || JSON.stringify(resp.error)}`);
  }

  const parts = resp.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('');
  if (!text) throw new Error('Empty Gemini response');

  const sources = (resp.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .filter(c => c.web)
    .map(c => ({ url: c.web.uri, title: c.web.title }))
    .slice(0, 3);

  if (jsonMode) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);
    if (sources.length) parsed._sources = sources;
    return parsed;
  }

  return { text, _sources: sources };
}

// ── Insight Prompts ─────────────────────────────────────────

const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const ARROW_RULES = `
ARROW FORMATTING RULES (follow strictly):
- ▲/▼ arrows are ONLY for period-over-period changes — a number that moved from one value to another.
  CORRECT: "CPI rose ▲ 0.2% month-over-month", "unemployment fell ▼ 0.1 percentage points", "payrolls added ▲ 130,000 jobs", "yields dropped ▼ 15 bps"
  WRONG: "the S&P 500 closed at ▲ 6,909" (that is a level, not a change), "market valued at ▲ $95B" (that is a size), "holds ▲ 36% market share" (that is a share, not a change)
- NEVER put ▲/▼ on: absolute prices, index levels, market sizes, valuations, totals, shares, or rates that are NOT being compared to a prior period.
- Place the arrow BEFORE the number: "rose ▲ 0.4%", not "0.4% ▲".
- Always include a unit or descriptor after the number: ▲ 0.2% MoM, ▼ 23,000 jobs, ▲ 2.4% YoY.
- Do NOT use **bold** for emphasis. Use plain text only.`;

const SECTION_PROMPTS = {
  us_economy: () => `You are a senior macroeconomist writing a daily US economy briefing for ${today()}.
Use the latest real data from FRED, BLS, BEA, and financial news.
Return JSON with this EXACT structure:
{
  "us_daily": {
    "economy": {
      "macro": "2-3 paragraph analysis of GDP growth, economic trajectory, key risks",
      "inflation": "2-3 paragraphs on CPI, PCE, Fed policy, rate expectations",
      "jobs": "2 paragraphs on unemployment rate, claims, payrolls, wage growth",
      "markets": "paragraph on S&P 500, Nasdaq, treasury yields, VIX, sector rotation",
      "consumer": "paragraph on consumer confidence, savings rate, spending patterns",
      "housing": "paragraph on home sales, mortgage rates, price trends, housing starts"
    }
  }
}
${ARROW_RULES}
- Include specific current data points with real numbers.`,

  us_industry: () => `You are a footwear & apparel industry analyst writing for ${today()}.
Use current data on Nike, Adidas, New Balance, On Running, Skechers, Lululemon, and the broader F&A market.
Return JSON:
{
  "us_daily": {
    "industry": {
      "demand": "paragraph on consumer demand, footwear sales trends, traffic",
      "pricing": "paragraph on pricing pressure, promotions, ASP trends, tariff impact",
      "youth": "paragraph on Gen Z behavior, TikTok influence, sneaker culture",
      "digital": "paragraph on e-commerce penetration, social commerce, DTC",
      "seasonal": "paragraph on current season outlook, inventory, weather impact",
      "trends": "paragraph on silhouette trends, colorways, what's hot/cooling"
    }
  }
}
${ARROW_RULES}
- Include real brand names and numbers.`,

  global_daily: () => `You are a global macro strategist writing a daily briefing for ${today()}.
Cover all major regions. Use current data from central banks, IMF, World Bank.
Return JSON:
{
  "global_daily": {
    "europe": "paragraph on ECB, Eurozone GDP, inflation, PMIs",
    "china": "paragraph on PBOC, GDP, PMI, property, stimulus",
    "asia": "paragraph on BOJ, Japan GDP, APAC trade, emerging Asia",
    "em": "paragraph on emerging market currencies, LatAm, MENA, Africa",
    "commodities": "paragraph on oil (WTI, Brent), natural gas, copper, agriculture",
    "gold": "paragraph on gold prices, central bank buying, safe haven flows",
    "risk": "paragraph on VIX, credit spreads, geopolitical risks, risk appetite"
  }
}
${ARROW_RULES}`,

  global_regional: () => `You are a regional economist writing for ${today()}.
Return JSON:
{
  "global_regional": {
    "europe": "2 paragraphs on European economy, ECB policy, major country performance",
    "asia": "2 paragraphs on Japan, South Korea, ASEAN, India economies",
    "china": "2 paragraphs on China's economy, trade, property, tech sector",
    "em": "2 paragraphs on emerging markets, Africa, Latin America, MENA"
  }
}
${ARROW_RULES}`,

  global_industry: () => `You are a global footwear & apparel industry analyst writing for ${today()}.
Return JSON:
{
  "global_industry": {
    "euro_luxury": "paragraph on European luxury fashion houses, LVMH, Kering, Hermès, fashion weeks",
    "china_consumer": "paragraph on Chinese sportswear brands (Li-Ning, Anta), domestic consumption",
    "asia_manufacturing": "paragraph on Vietnam, Indonesia, Bangladesh production, supply chains, tariffs",
    "africa_latam": "paragraph on Africa/LatAm consumer growth, emerging retail markets",
    "digital": "paragraph on global e-commerce, TikTok Shop, Douyin, social selling",
    "sustainability": "paragraph on EU textile regulations, ESG requirements, circular fashion"
  }
}
${ARROW_RULES}`,

  us_youth: () => `You are a youth culture and consumer behavior analyst writing for ${today()}.
Focus on Gen Z and Gen Alpha in the US footwear & apparel market.
Return JSON:
{
  "us_youth_insights": [
    {"theme": "Sneaker Culture", "icon": "directions_run", "color": "var(--orange)", "title": "title with data", "body": "2-3 sentence analysis", "sourceKey": "SHOERETAIL"},
    {"theme": "Fast Fashion & Deflation", "icon": "checkroom", "color": "var(--cyan)", "title": "title with data", "body": "analysis", "sourceKey": "APPARELCPI"},
    {"theme": "Digital-First Shopping", "icon": "phone_iphone", "color": "var(--accent)", "title": "title with data", "body": "analysis", "sourceKey": "ECOMMPCT"},
    {"theme": "Gen Z Spending Power", "icon": "payments", "color": "var(--green)", "title": "title with data", "body": "analysis", "sourceKey": "YOUTH1624UE"},
    {"theme": "Credit & BNPL", "icon": "credit_card", "color": "var(--red)", "title": "title with data", "body": "analysis", "sourceKey": "REVOLVCREDIT"},
    {"theme": "Sustainability & Resale", "icon": "recycling", "color": "var(--purple)", "title": "title with data", "body": "analysis"},
    {"theme": "Athleisure Dominance", "icon": "fitness_center", "color": "var(--yellow)", "title": "title with data", "body": "analysis", "sourceKey": "CLOTHRETAIL"},
    {"theme": "Supply Chain & Tariffs", "icon": "local_shipping", "color": "#f472b6", "title": "title with data", "body": "analysis", "sourceKey": "FOOTWEARPPI"},
    {"theme": "Identity & Self-Expression", "icon": "palette", "color": "var(--cyan)", "title": "title with data", "body": "analysis", "sourceKey": "UMCSENT"}
  ]
}
Each insight should include current data.
${ARROW_RULES}`,

  collectibles: () => `You are an alternative assets analyst covering the collectibles market for ${today()}.
Return JSON:
{
  "collectibles": {
    "intro": "2-3 sentence overview of collectibles as alternative investments in current macro environment",
    "segments": [
      {"name": "Sneaker Resale", "icon": "directions_run", "color": "var(--orange)", "thesis": "2-3 sentence investment thesis", "risk": "Medium", "riskNote": "brief risk context"},
      {"name": "Trading Cards", "icon": "style", "color": "var(--cyan)", "thesis": "thesis", "risk": "High", "riskNote": "risk note"},
      {"name": "Luxury Watches", "icon": "watch", "color": "var(--green)", "thesis": "thesis", "risk": "Medium", "riskNote": "risk note"},
      {"name": "Vintage Fashion", "icon": "checkroom", "color": "var(--purple)", "thesis": "thesis", "risk": "Low", "riskNote": "risk note"}
    ]
  }
}
Include current market data and valuations where available.
${ARROW_RULES}`,

  industry_trends: () => `You are a senior industry strategist covering footwear & apparel for ${today()}.
Return JSON: an array of exactly 12 trend objects. First 6 are macro industry currents, last 6 are cultural currents.
{
  "industry_trends": [
    {"icon": "trending_up", "color": "var(--green-500)", "title": "Trend Title", "body": "2-3 paragraph deep analysis with real brand examples and data points", "tags": ["Tag1", "Tag2", "Tag3"]},
    ... 11 more
  ]
}
Icons should be valid Material Icons. Colors should use CSS variables like var(--green-500), var(--blue-500), var(--purple-500), var(--orange-500), var(--red-500), var(--teal-500), var(--pink-500), var(--indigo-500), var(--deep-purple-500), var(--amber-500), var(--light-blue-500), var(--cyan).
Topics should cover: economic headwinds, supply chains, retail transformation, sustainability, labor, AI/digital, athleisure, resale/vintage, social media, personalization, hybrid work, youth culture.
Use current data, brand revenues, market sizes.
${ARROW_RULES}`,

  industry_footwear: () => `You are a footwear industry analyst writing for ${today()}.
Return JSON:
{
  "industry_footwear": {
    "silhouettes": [
      {"icon": "arrow_upward", "color": "var(--green)", "title": "Silhouette Name", "body": "analysis with brand examples", "tags": ["Tag1", "Tag2"]},
      ... at least 4 silhouette trends
    ],
    "brands": [
      {"name": "Adidas", "direction": "up", "body": "brand momentum analysis"},
      {"name": "New Balance", "direction": "up", "body": "analysis"},
      {"name": "On Running", "direction": "up", "body": "analysis"},
      {"name": "Nike", "direction": "flat", "body": "analysis"},
      {"name": "Asics", "direction": "flat", "body": "analysis"},
      {"name": "Puma", "direction": "down", "body": "analysis"}
    ],
    "categories": [
      {"label": "Lifestyle/Casual", "color": "var(--green)", "detail": "segment analysis"},
      {"label": "Running/Performance", "color": "var(--accent)", "detail": "analysis"},
      {"label": "Outdoor/Trail", "color": "var(--cyan)", "detail": "analysis"},
      {"label": "Luxury Sneakers", "color": "var(--purple)", "detail": "analysis"},
      {"label": "Sandals & Slides", "color": "var(--yellow)", "detail": "analysis"},
      {"label": "Boots", "color": "var(--orange)", "detail": "analysis"}
    ]
  }
}
Include real revenue data, collab names, specific shoe models.
${ARROW_RULES}`,

  industry_apparel: () => `You are an apparel industry analyst writing for ${today()}.
Return JSON:
{
  "industry_apparel": {
    "aesthetics": [
      {"icon": "style", "color": "var(--green)", "title": "Aesthetic Name", "body": "trend analysis", "tags": ["Tag1", "Tag2"]},
      ... at least 4 aesthetic trends
    ],
    "brands": [
      {"name": "Brand", "direction": "up|flat|down", "body": "momentum analysis"},
      ... at least 6 brands covering luxury, athletic, fast fashion, and streetwear
    ],
    "categories": [
      {"label": "Category", "color": "var(--color)", "detail": "analysis"},
      ... at least 5 categories
    ]
  }
}
Cover athleisure, streetwear, quiet luxury, workwear, outerwear. Include brand names, revenue data.
${ARROW_RULES}`,

  industry_color: () => `You are a color and materials trend forecaster writing for ${today()}.
Return JSON:
{
  "industry_color": {
    "colors": [
      {"name": "Color Family Name", "gradient": "linear-gradient(135deg, #hex1, #hex2, #hex3)", "status": "hot|rising|stable|fading", "detail": "analysis of this color trend"},
      ... at least 6 colors
    ],
    "materials": [
      {"icon": "eco", "color": "var(--green)", "title": "Material Name", "body": "trend analysis", "tags": ["Tag1", "Tag2"]},
      ... at least 4 materials
    ],
    "design": [
      {"label": "Design Detail", "color": "var(--color)", "detail": "analysis"},
      ... at least 5 design trends
    ]
  }
}
Use real hex colors for gradients. Status values must be exactly: hot, rising, stable, or fading.
${ARROW_RULES}`,

  industry_consumer: () => `You are a consumer behavior analyst covering footwear & apparel for ${today()}.
Return JSON:
{
  "industry_consumer": {
    "generations": [
      {"icon": "person", "color": "var(--accent)", "title": "Generation Name & Profile", "body": "2-3 paragraph analysis of this generation's F&A behavior, spending, preferences", "tags": ["Tag1", "Tag2", "Tag3"]},
      ... at least 4 (Gen Alpha, Gen Z, Millennials, Gen X, Boomers)
    ],
    "shopping": [
      {"icon": "storefront", "color": "var(--green)", "title": "Behavior Shift", "body": "analysis", "tags": ["Tag1", "Tag2"]},
      ... at least 4 shopping behavior trends
    ],
    "culture": [
      {"icon": "music_note", "color": "var(--purple)", "title": "Cultural Force", "body": "analysis", "tags": ["Tag1", "Tag2"]},
      ... at least 4 cultural influences
    ]
  }
}
Include market size data, percentages, brand examples.
${ARROW_RULES}`,
};

// ── In-flight dedup for insights ────────────────────────────
const insightsInFlight = new Map();

app.get('/api/insights', async (req, res) => {
  const s = req.query.s;
  if (!s || !SECTION_PROMPTS[s]) return res.json({});

  const dateKey = new Date().toISOString().slice(0, 10);
  const cacheKey = `insights_${s}_${dateKey}`;

  const fromCache = cache.get(cacheKey);
  if (fromCache && Date.now() - fromCache.ts < 6 * 60 * 60 * 1000) {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json(fromCache.data);
  }

  if (insightsInFlight.has(cacheKey)) {
    try {
      const data = await insightsInFlight.get(cacheKey);
      res.set('Cache-Control', 'public, max-age=3600');
      return res.json(data);
    } catch (e) {
      return res.json({ error: 'Generation failed', detail: e.message });
    }
  }

  const promise = (async () => {
    const prompt = SECTION_PROMPTS[s]();
    console.log(`[Gemini] Generating ${s}...`);
    const data = await geminiGenerate(prompt);
    console.log(`[Gemini] ✓ ${s} complete`);
    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  })();

  insightsInFlight.set(cacheKey, promise);
  promise.finally(() => insightsInFlight.delete(cacheKey));

  try {
    const data = await promise;
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (e) {
    console.error(`[Gemini] ✗ ${s}:`, e.message);
    res.json({ error: 'Insights generation failed', detail: e.message });
  }
});

// ── Podcast (Gemini-generated) ──────────────────────────────

app.get('/api/podcast', async (req, res) => {
  const dateKey = new Date().toISOString().slice(0, 10);
  const cacheKey = `podcast_${dateKey}`;

  try {
    const data = await cached(cacheKey, 6 * 60 * 60 * 1000, async () => {
      console.log('[Gemini] Generating podcast script...');
      const prompt = `You are writing a podcast script for "The Morning Macro" for ${today()}.
It's a 2-person daily macro briefing podcast. Alex is the lead host, Sam is the analyst.
They discuss the day's key economic data, market moves, and footwear/apparel industry news.

Use current real data: GDP, unemployment, inflation, Fed policy, S&P 500, treasury yields, housing, and any breaking economic news.
Also cover footwear/apparel industry: Nike, Adidas, New Balance, On Running, etc.

Return JSON:
{
  "lines": [
    {"speaker": "Alex", "text": "opening greeting and topic preview"},
    {"speaker": "Sam", "text": "first key story"},
    {"speaker": "Alex", "text": "follow-up with data"},
    {"speaker": "Sam", "text": "market analysis"},
    {"speaker": "Alex", "text": "industry segment"},
    {"speaker": "Sam", "text": "industry analysis"},
    {"speaker": "Alex", "text": "closing with forward look"}
  ]
}
Write 7-10 lines of natural conversational dialogue. Each line should be 2-3 sentences.
Include specific data points (numbers, percentages). Make it sound natural and engaging.`;
      const data = await geminiGenerate(prompt);
      console.log('[Gemini] ✓ Podcast complete');
      return data;
    });
    res.json(data);
  } catch (e) {
    console.error('[Gemini] ✗ Podcast:', e.message);
    res.json({ error: 'Podcast generation failed', detail: e.message });
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Swoosh Macro Intelligence running at http://localhost:${PORT}`);
    console.log(`Gemini model: ${GEMINI_MODEL}`);
    console.log(`Gemini key: ${GEMINI_API_KEY.slice(0, 10)}...`);
  });
}

module.exports = app;

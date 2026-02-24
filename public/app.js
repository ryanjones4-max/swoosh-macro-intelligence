(() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const dashboard = $('#dashboard');
  let currentTab = 'overview';
  let dashboardScope = 'us';
  const defaultTabByScope = {
    us: 'overview',
    global: 'g-overview',
    industry: 'i-trends',
  };
  const lastTabByScope = { ...defaultTabByScope };
  let allData = {};
  let globalData = {};
  let chartsAlive = [];
  let livePrices = null;
  let dynamicInsights = null;
  let insightsLoading = false;
  let aiEnabled = true;

  function tabScope(tab) {
    if (!tab) return 'us';
    if (tab.startsWith('g-')) return 'global';
    if (tab.startsWith('i-')) return 'industry';
    return 'us';
  }

  function setActiveTab(tab) {
    $$('#tab-bar .tab, #tab-bar-global .tab, #tab-bar-industry .tab').forEach(b => b.classList.remove('active'));
    const btn = $(`.tab[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
  }

  // ── Tab Navigation ─────────────────────────────────────────
  function bindTabClicks(barSel) {
    const barScope = barSel === '#tab-bar-global' ? 'global' : barSel === '#tab-bar-industry' ? 'industry' : 'us';
    $$(barSel + ' .tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$(barSel + ' .tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        lastTabByScope[barScope] = currentTab;
        renderTab(currentTab);
      });
    });
  }
  bindTabClicks('#tab-bar');
  bindTabClicks('#tab-bar-global');
  bindTabClicks('#tab-bar-industry');

  // ── Scope Toggle ───────────────────────────────────────────
  $$('.scope-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const scope = btn.dataset.scope;
      if (scope === dashboardScope) return;
      if (tabScope(currentTab) === dashboardScope) {
        lastTabByScope[dashboardScope] = currentTab;
      }
      dashboardScope = scope;
      $$('.scope-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const titleEl = $('#dashboard-title');
      const usBar = $('#tab-bar');
      const globalBar = $('#tab-bar-global');
      const industryBar = $('#tab-bar-industry');

      usBar.style.display = 'none';
      globalBar.style.display = 'none';
      industryBar.style.display = 'none';

      if (scope === 'global') {
        titleEl.textContent = 'Global Economy';
        globalBar.style.display = '';
        currentTab = lastTabByScope.global || defaultTabByScope.global;
        $('#ticker-wrap').style.display = '';
        document.body.classList.remove('no-ticker');
        renderLoading();
        if (!globalData._loaded) await loadGlobalData();
        renderGlobalTicker();
      } else if (scope === 'industry') {
        titleEl.textContent = 'Industry Insights';
        industryBar.style.display = '';
        currentTab = lastTabByScope.industry || defaultTabByScope.industry;
        $('#ticker-wrap').style.display = 'none';
        document.body.classList.add('no-ticker');
      } else {
        titleEl.textContent = 'US Economy';
        usBar.style.display = '';
        currentTab = lastTabByScope.us || defaultTabByScope.us;
        $('#ticker-wrap').style.display = '';
        document.body.classList.remove('no-ticker');
        renderTicker();
      }
      setActiveTab(currentTab);
      renderTab(currentTab);
    });
  });

  // ── Info Tooltip Positioning (delegated) ───────────────────
  let activeTooltip = null;

  document.addEventListener('mouseover', e => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    const wrapper = icon.closest('.title-with-info');
    if (!wrapper) return;
    const tip = wrapper.querySelector('.info-tooltip');
    if (!tip) return;

    if (activeTooltip && activeTooltip !== tip) activeTooltip.classList.remove('visible');

    const rect = icon.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left;
    if (left + 370 > window.innerWidth) left = window.innerWidth - 380;
    if (left < 10) left = 10;
    if (top + 300 > window.innerHeight) {
      top = rect.top - 8;
      tip.style.transform = 'translateY(-100%)';
    } else {
      tip.style.transform = '';
    }
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    tip.classList.add('visible');
    activeTooltip = tip;
  });

  document.addEventListener('mouseout', e => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    const related = e.relatedTarget;
    if (related && (related.closest('.info-icon') === icon)) return;
    if (activeTooltip) {
      activeTooltip.classList.remove('visible');
      activeTooltip = null;
    }
  });

  // ── Bootstrap ──────────────────────────────────────────────
  let lastLoadDate = null;

  async function init() {
    const splashStart = Date.now();
    renderLoading();
    loadInsights();
    await Promise.all([loadLivePrices(), loadAllData()]);
    lastLoadDate = new Date().toDateString();
    renderTicker();
    setActiveTab(currentTab);
    renderTab(currentTab);
    updateTimestamp();
    syncAiToggleUI();
    const elapsed = Date.now() - splashStart;
    const remaining = Math.max(0, 3000 - elapsed);
    await new Promise(r => setTimeout(r, remaining));
    const splash = document.getElementById('splash-screen');
    if (splash) {
      document.getElementById('app').classList.remove('behind-splash');
      splash.classList.add('done');
      setTimeout(() => splash.remove(), 700);
    }
    setInterval(dailyRefreshCheck, 60_000);
    setInterval(refreshFredData, 3_600_000);
    setInterval(loadLivePrices, 900_000);
  }

  async function loadLivePrices() {
    try {
      const resp = await fetch('/api/prices');
      if (resp.ok) {
        livePrices = await resp.json();
        if (dashboardScope === 'global') renderTab(currentTab);
      }
    } catch (e) { /* silent */ }
  }

  const goldHistoryCache = new Map();
  async function fetchGoldHistory(years = 2) {
    const key = `gold_${years}`;
    const cached = goldHistoryCache.get(key);
    if (cached && Date.now() - cached.ts < 3600000) return cached.data;
    try {
      const resp = await fetch(`/api/gold-history?years=${years}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      if (Array.isArray(data)) {
        goldHistoryCache.set(key, { data, ts: Date.now() });
        return data;
      }
      return [];
    } catch (e) { return []; }
  }

  function yfSourceLink(symbol, label) {
    return `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/" target="_blank" class="source-link"><span class="material-icons-outlined">open_in_new</span>Yahoo Finance: ${label}</a>`;
  }

  function yfChartHeader(title, symbol, label) {
    const desc = 'Gold futures (GC=F) track the price of one troy ounce of gold on COMEX. Gold serves as the primary global safe-haven asset, inflation hedge, and central bank reserve diversifier.';
    const tooltip = `<span class="title-with-info"><span class="card-title">${title}</span><span class="info-icon">i</span><span class="info-tooltip">${desc}</span></span>`;
    return `<div class="card-header">${tooltip}</div><div class="chart-source">${yfSourceLink(symbol, label)}</div>`;
  }

  let insightsFailed = false;
  let insightsRetryCount = 0;

  function syncAiToggleUI() {
    const dot = $('#ai-status-dot');
    if (!dot) return;
    dot.classList.remove('live', 'loading', 'error');
    if (dynamicInsights) dot.classList.add('live');
    else if (insightsLoading) dot.classList.add('loading');
    else if (insightsFailed) dot.classList.add('error');
    else dot.classList.add('loading');
  }

  function buildFredContext() {
    const keys = [
      'DFF','DGS10','DGS2','UNRATE','CPIYOY','PCEYOY','GDPGROWTH',
      'SP500','VIXCLS','MORTGAGE30US','T10Y2Y','UMCSENT','PSAVERT',
      'ICSA','GASREGW','DTWEXBGS','SHOERETAIL','CLOTHRETAIL',
      'FOOTWEARCPI','APPARELCPI','FOOTWEARPPI','ECOMMPCT',
      'REVOLVCREDIT','YOUTH1624UE','HOUST','CSUSHPISA',
    ];
    const globalKeys = [
      'DCOILWTICO','DCOILBRENTEU','DHHNGSP','PCOPPUSDM',
      'DEXUSEU','DEXJPUS','DEXUSUK','DEXCHUS','DEXMXUS',
    ];
    const lines = [];
    const src = { ...allData, ...globalData };
    for (const k of [...keys, ...globalKeys]) {
      const d = src[k];
      if (d) {
        const dir = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '●';
        lines.push(`${k} (${FRED.seriesName(k) || k}): ${d.formatted} ${dir}`);
      }
    }
    if (livePrices) {
      const lp = livePrices;
      lines.unshift('=== LIVE COMMODITY PRICES (USE THESE EXACT PRICES — DO NOT MAKE UP PRICES) ===');
      if (lp.gold && !lp.gold.error) lines.splice(1, 0, `GOLD: $${lp.gold.price.toLocaleString()}/oz ${lp.gold.direction === 'up' ? '▲' : lp.gold.direction === 'down' ? '▼' : '●'} (${lp.gold.changePct >= 0 ? '+' : ''}${lp.gold.changePct}% change)`);
      if (lp.oil_wti && !lp.oil_wti.error) lines.splice(2, 0, `WTI CRUDE OIL: $${lp.oil_wti.price}/barrel ${lp.oil_wti.direction === 'up' ? '▲' : lp.oil_wti.direction === 'down' ? '▼' : '●'} (${lp.oil_wti.changePct >= 0 ? '+' : ''}${lp.oil_wti.changePct}% change)`);
      if (lp.oil_brent && !lp.oil_brent.error) lines.splice(3, 0, `BRENT CRUDE OIL: $${lp.oil_brent.price}/barrel ${lp.oil_brent.direction === 'up' ? '▲' : lp.oil_brent.direction === 'down' ? '▼' : '●'} (${lp.oil_brent.changePct >= 0 ? '+' : ''}${lp.oil_brent.changePct}% change)`);
      lines.splice(4, 0, '=== END LIVE PRICES ===');
    }
    return lines.join('\n');
  }

  function lpVal(k) {
    const p = livePrices?.[k];
    return p && !p.error ? `$${p.price.toLocaleString()}` : null;
  }
  function lpDirLabel(k) {
    const p = livePrices?.[k];
    if (!p || p.error) return null;
    return p.direction === 'up' ? 'trending higher' : p.direction === 'down' ? 'trending lower' : 'range-bound';
  }

  const gVal = (key) => globalData[key] ? globalData[key].formatted : '—';
  const gChg = (key) => globalData[key] ? globalData[key].changeFormatted || '–' : '–';
  const gDir = (key) => globalData[key] ? globalData[key].direction : 'flat';
  const lpFmt = (k, fallback) => { const p = livePrices?.[k]; return p && !p.error ? `$${p.price.toLocaleString()}` : fallback; };
  const lpDirCls = (k) => { const p = livePrices?.[k]; return p && !p.error ? p.direction : ''; };
  const lpChgFmt = (k) => { const p = livePrices?.[k]; if (!p || p.error) return ''; const s = p.change >= 0 ? '+' : ''; return `${s}${p.change} (${s}${p.changePct}%)`; };
  const fmtToday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  let chartRangeYears = null;
  const RANGE_OPTIONS = [1, 2, 3, 5, 10];

  function chartRange(defaultYears) {
    return chartRangeYears || defaultYears;
  }

  function rangeBarHtml() {
    return `<div class="chart-range-bar" id="chart-range-bar">
      <span class="range-label"><span class="material-icons-outlined" style="font-size:14px;vertical-align:-2px">date_range</span> Chart Range</span>
      <button class="chart-range-btn${chartRangeYears === null ? ' active' : ''}" data-range="">Default</button>
      ${RANGE_OPTIONS.map(y => `<button class="chart-range-btn${chartRangeYears === y ? ' active' : ''}" data-range="${y}">${y}Y</button>`).join('')}
    </div>`;
  }

  function initRangeBar() {
    const bar = document.getElementById('chart-range-bar');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const btn = e.target.closest('.chart-range-btn');
      if (!btn) return;
      const val = btn.dataset.range;
      chartRangeYears = val === '' ? null : parseInt(val);
      renderTab(currentTab);
    });
  }

  const INSIGHTS_VER = 'v9';
  const ALL_SECTIONS = [
    'us_economy', 'global_daily', 'global_regional', 'global_industry',
    'us_industry', 'us_youth', 'collectibles',
    'industry_trends', 'industry_footwear', 'industry_apparel',
    'industry_color', 'industry_consumer',
  ];

  function insightsCacheKey() {
    return `insights_${INSIGHTS_VER}_${new Date().toISOString().slice(0, 10)}`;
  }

  function purgeOldInsightsCache(keepKey) {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('insights_') && k !== keepKey) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  function saveInsightsCache(merged) {
    try {
      const key = insightsCacheKey();
      purgeOldInsightsCache(key);
      localStorage.setItem(key, JSON.stringify(merged));
    } catch {}
  }

  async function loadInsights() {
    if (insightsLoading || !aiEnabled) return;
    insightsLoading = true;
    insightsFailed = false;
    syncAiToggleUI();

    const cacheKey = insightsCacheKey();

    // 1) Instant render from today's localStorage cache
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        dynamicInsights = JSON.parse(cached);
        renderTab(currentTab);
      }
    } catch {}

    // 2) Purge old cache versions
    purgeOldInsightsCache(cacheKey);

    // 3) Fetch all sections in parallel (CDN-cached responses are instant)
    const merged = dynamicInsights ? { ...dynamicInsights } : {};
    let gotAny = false;

    function mergeSection(data, sectionKey) {
      const sources = data._sources;
      delete data._sources;
      delete data._partial;
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('_')) continue;
        if (merged[k] && typeof merged[k] === 'object' && typeof v === 'object' && !Array.isArray(v)) {
          merged[k] = { ...merged[k], ...v };
        } else {
          merged[k] = v;
        }
      }
      if (sources) {
        if (!merged._sourcesBySection) merged._sourcesBySection = {};
        merged._sourcesBySection[sectionKey] = sources;
      }
      gotAny = true;
      dynamicInsights = { ...merged };
      renderTab(currentTab);
      syncAiToggleUI();
    }

    function fetchOne(s) {
      return fetch(`/api/insights?s=${s}`)
        .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
        .then(({ ok, data }) => {
          if (ok && data && !data.error && aiEnabled) { mergeSection(data, s); return true; }
          if (data?.error) console.error(`[insights/${s}]`, data.error, data.detail || '');
          return false;
        })
        .catch(e => { console.error(`[insights/${s}] fetch failed:`, e); return false; });
    }

    // Fire all at once — CDN-warm responses return in <100ms, no rate-limit risk
    const results = await Promise.all(ALL_SECTIONS.map(s => fetchOne(s).then(ok => ({ s, ok }))));
    const failed = results.filter(r => !r.ok).map(r => r.s);

    // Retry failures with backoff (these are the ones that actually hit Gemini)
    for (let attempt = 0; attempt < 3 && failed.length; attempt++) {
      const toRetry = [...failed];
      failed.length = 0;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      for (const s of toRetry) {
        const ok = await fetchOne(s);
        if (!ok) failed.push(s);
        if (failed.length < toRetry.length) await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 4) Save whatever we got — partial cache is better than no cache
    if (gotAny && aiEnabled) {
      dynamicInsights = merged;
      saveInsightsCache(merged);
      renderTab(currentTab);
    }

    if (!gotAny) {
      if (insightsRetryCount < 5) {
        insightsRetryCount++;
        setTimeout(() => loadInsights(), Math.min(5000 * Math.pow(2, insightsRetryCount - 1), 60000));
      } else {
        insightsFailed = true;
      }
    } else {
      insightsRetryCount = 0;
    }
    insightsLoading = false;
    syncAiToggleUI();
    renderTab(currentTab);
  }

  function updateTimestamp() {
    const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('#last-updated').textContent = `Updated ${ts}`;
  }

  async function refreshFredData() {
    FRED.clearCache();
    await loadAllData();
    renderTicker();
    if (currentTab === 'dailyread') renderTab(currentTab);
    updateTimestamp();
  }

  function dailyRefreshCheck() {
    const today = new Date().toDateString();
    if (today !== lastLoadDate) {
      lastLoadDate = today;
      dynamicInsights = null;
      insightsRetryCount = 0;
      insightsFailed = false;
      loadInsights();
      refreshFredData();
    }
  }

  async function loadAllData() {
    const keys = [
      'GDPGROWTH','UNRATE','DFF','DGS10','DGS2','T10Y2Y','T10Y3M','MORTGAGE30US',
      'SP500','VIXCLS','ICSA','PAYEMS','CIVPART','UMCSENT','RSAFS','HOUST',
      'BOPGSTB','M2SL','INDPRO','CAPACITY','PSAVERT','GASREGW','T5YIE','T10YIE',
      'WALCL','DTWEXBGS','BAMLH0A0HYM2','U6RATE','CES0500000003','JTSJOL',
      'PERMIT','CSUSHPISA','MSPUS','MSACSR','PCE','DSPIC96','DGORDER',
      'DGS5','DGS30','FEDFUNDS','GFDEBTN','AWHAEPBS',
      'POPTHM','POPGROW','FERTILITY','BIRTHRATE','LIFEEXP','INFANTMORT',
      'POP65','POP014','WORKAGEPOP','CLF16OV','NETMIG','POPBEA',
      'APPARELCPI','FOOTWEARCPI','MENAPPAREL','FOOTWEARPCE','CLOTHRETAIL',
      'SHOERETAIL','ECOMMPCT','YOUTH1624UE','YOUTH1619UE','YOUTH2024UE',
      'YOUTH1619EMP','YOUTH2024EMP','REVOLVCREDIT','CCBALANCE','DISCRETPCE',
      'FOOTWEARPPI','CLOTHINGEMP','GENSALES',
    ];

    // Batch in groups of 8 to avoid overwhelming the FRED API rate limit
    for (let i = 0; i < keys.length; i += 8) {
      const batch = keys.slice(i, i + 8);
      const results = await Promise.allSettled(batch.map(k => FRED.getLatestWithChange(k)));
      batch.forEach((k, j) => {
        if (results[j].status === 'fulfilled' && results[j].value) {
          allData[k] = results[j].value;
        }
      });
    }

    const [cpiYoY, pceYoY] = await Promise.allSettled([
      FRED.getYoYChange('CPIYOY'),
      FRED.getYoYChange('PCEYOY'),
    ]);
    if (cpiYoY.status === 'fulfilled' && cpiYoY.value) allData.CPIYOY = cpiYoY.value;
    if (pceYoY.status === 'fulfilled' && pceYoY.value) allData.PCEYOY = pceYoY.value;
  }

  // ── Ticker Tape ────────────────────────────────────────────
  function renderTicker() {
    const items = [
      { key: 'SP500',     label: 'S&P 500' },
      { key: 'DGS10',     label: '10Y' },
      { key: 'DGS2',      label: '2Y' },
      { key: 'DFF',       label: 'Fed Funds' },
      { key: 'VIXCLS',    label: 'VIX' },
      { key: 'UNRATE',    label: 'Unemp' },
      { key: 'MORTGAGE30US', label: '30Y Mort' },
      { key: 'GASREGW',   label: 'Gas' },
      { key: 'DTWEXBGS',  label: 'USD' },
      { key: 'ICSA',      label: 'Claims' },
      { key: 'T10Y2Y',    label: '10Y-2Y' },
      { key: 'UMCSENT',   label: 'Sentiment' },
    ];

    let html = '';
    items.forEach(it => {
      const d = allData[it.key];
      if (!d) return;
      const dir = d.direction || 'flat';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
      html += `<span class="ticker-item">
        <span class="label">${it.label}</span>
        <span class="value">${d.formatted}</span>
        <span class="change ${dir}">${arrow} ${d.changeFormatted || ''}</span>
      </span><span class="ticker-sep">|</span>`;
    });
    const ticker = $('#ticker-tape');
    ticker.innerHTML = html + html;
  }

  // ── Loading State ──────────────────────────────────────────
  function renderLoading() {
    dashboard.innerHTML = `
      <div class="grid grid-4" style="margin-top:12px">
        ${Array(8).fill('<div class="card"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-value"></div><div class="skeleton skeleton-chart" style="height:48px;margin-top:12px"></div></div>').join('')}
      </div>
      <div class="grid grid-2" style="margin-top:20px">
        <div class="card span-2"><div class="skeleton skeleton-chart"></div></div>
      </div>`;
  }

  // ── Tab Renderer ───────────────────────────────────────────
  const userToggledSections = new Set();

  function trackDrToggles() {
    $$('[data-dr-id] .daily-read-header, [data-dr-id] .deep-dive-header').forEach(hdr => {
      if (hdr._drTracked) return;
      hdr._drTracked = true;
      hdr.addEventListener('click', () => {
        const section = hdr.closest('[data-dr-id]');
        if (section) userToggledSections.add(section.dataset.drId);
      });
    });
  }

  function saveDrState() {
    const state = {};
    $$('[data-dr-id]').forEach(el => {
      const id = el.dataset.drId;
      if (userToggledSections.has(id)) {
        state[id] = el.classList.contains('collapsed');
      }
    });
    return state;
  }

  function restoreDrState(state) {
    if (!state || !Object.keys(state).length) return;
    $$('[data-dr-id]').forEach(el => {
      const id = el.dataset.drId;
      if (id in state) {
        el.classList.toggle('collapsed', state[id]);
      }
    });
  }

  function renderTab(tab) {
    const drState = saveDrState();
    Charts.destroyAll();
    chartsAlive = [];
    const renderers = {
      dailyread: renderDailyRead,
      overview:  renderOverview,
      growth:    () => renderDataTab(TAB_CONFIGS.growth),
      labor:     () => renderDataTab(TAB_CONFIGS.labor),
      inflation: () => renderDataTab(TAB_CONFIGS.inflation),
      rates:     () => renderDataTab(TAB_CONFIGS.rates),
      housing:   () => renderDataTab(TAB_CONFIGS.housing),
      consumer:  () => renderDataTab(TAB_CONFIGS.consumer),
      markets:   () => renderDataTab(TAB_CONFIGS.markets),
      population: renderPopulation,
      youth:     renderYouth,
      events:    renderEvents,
      headlines: renderUSHeadlines,
      'g-dailyread':   renderGlobalDailyRead,
      'g-overview':    renderGlobalOverview,
      'g-commodities': renderGlobalCommodities,
      'g-fx':          renderGlobalFX,
      'g-headlines':   renderGlobalHeadlines,
      'i-trends':      renderIndustryTrends,
      'i-footwear':    renderIndustryFootwear,
      'i-apparel':     renderIndustryApparel,
      'i-color':       renderIndustryColorMaterial,
      'i-consumer':    renderIndustryConsumer,
    };
    const fallback = dashboardScope === 'industry' ? renderIndustryTrends : dashboardScope === 'global' ? renderGlobalDailyRead : renderDailyRead;
    (renderers[tab] || fallback)();
    const chartTabs = ['overview','growth','labor','inflation','rates','housing','consumer','markets','population','youth',
      'g-overview','g-commodities','g-fx'];
    if (chartTabs.includes(tab)) {
      const content = dashboard.querySelector('.tab-content');
      if (content) {
        const summary = content.querySelector('.tab-summary');
        const header = content.querySelector('.section-header');
        const anchor = summary || header;
        if (anchor) anchor.insertAdjacentHTML('afterend', rangeBarHtml());
        initRangeBar();
      }
    }
    restoreDrState(drState);
    trackDrToggles();
  }

  // ── DAILY READ ────────────────────────────────────────────
  function renderDailyRead() {
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">flag</span>US Daily Read</h2>
        <p>${fmtToday()}</p>
      </div>

      ${overviewDailyRead()}
      ${industryDailyRead()}
      ${collectiblesDeepDive()}

      <div class="news-section-title"><span class="material-icons-outlined">newspaper</span> Latest Headlines</div>
      <div class="news-filter-bar">
        <button class="news-filter active" data-cat="all">All</button>
        <button class="news-filter" data-cat="economy">Economy</button>
        <button class="news-filter" data-cat="markets">Markets</button>
        <button class="news-filter" data-cat="industry">Footwear & Apparel</button>
      </div>
      <div class="news-grid" id="news-grid">
        <div class="news-loading"><span class="material-icons-outlined" style="font-size:24px;vertical-align:middle;margin-right:8px">hourglass_top</span>Loading headlines...</div>
      </div>
    </div>`;

    loadNews();

    $$('.news-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.news-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterNews(btn.dataset.cat);
      });
    });
  }

  let cachedNews = null;
  let currentNewsCat = 'all';

  async function loadNews(forceRefresh) {
    const grid = $('#news-grid');
    try {
      if (!cachedNews || forceRefresh) {
        const resp = await fetch('/api/news' + (forceRefresh ? '?t=' + Date.now() : ''));
        const data = await resp.json();
        cachedNews = data.articles || [];
      }
      renderNewsCards(cachedNews, currentNewsCat);
    } catch (e) {
      if (grid) grid.innerHTML = '<div class="news-loading" style="color:var(--red)">Failed to load news. Please try refreshing.</div>';
    }
  }

  function filterNews(cat) {
    currentNewsCat = cat;
    if (!cachedNews) return;
    renderNewsCards(cachedNews, cat);
  }

  const US_CAT_COLORS = { industry: '#1abc9c', economy: '#3498db', markets: '#e67e22' };
  const US_CAT_LABELS = { industry: 'Footwear & Apparel', economy: 'Economy', markets: 'Markets' };

  function renderNewsGrid(gridSel, articles, cat, colors, labels) {
    const grid = $(gridSel);
    if (!grid) return;
    const filtered = (cat === 'all' ? articles : articles.filter(a => a.category === cat))
      .slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    if (!filtered.length) { grid.innerHTML = '<div class="news-loading">No articles found for this category.</div>'; return; }
    grid.innerHTML = filtered.map(a => {
      const color = (colors || US_CAT_COLORS)[a.category] || '#95a5a6';
      const catLabel = (labels || US_CAT_LABELS)[a.category] || a.category;
      return `<div class="news-window" style="border-top:3px solid ${color}">
        <div class="news-window-header">
          <span class="material-icons-outlined" style="font-size:18px;color:${color}">${a.icon || 'article'}</span>
          <span class="news-window-cat" style="color:${color}">${catLabel}</span>
          ${a.date ? `<span class="news-window-date">${a.date}</span>` : ''}
        </div>
        <div class="news-window-title">${a.title}</div>
        ${a.summary ? `<div class="news-window-summary">${a.summary}</div>` : ''}
        <div class="news-window-footer">
          <span class="news-window-source"><span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;margin-right:3px">rss_feed</span>${a.source}</span>
          <a href="${a.link}" target="_blank" rel="noopener" class="news-window-link">Read Article <span class="material-icons-outlined" style="font-size:14px;vertical-align:middle">open_in_new</span></a>
        </div>
      </div>`;
    }).join('');
  }

  function renderNewsCards(articles, cat) {
    renderNewsGrid('#news-grid', articles, cat);
  }

  // ── US HEADLINES (standalone tab) ─────────────────────────
  function renderUSHeadlines() {
    const today = fmtToday();
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">newspaper</span>Headlines</h2>
        <p>Live news from Yahoo Finance, CNBC, MarketWatch & more — ${today}</p>
      </div>

      <div class="news-filter-bar">
        <button class="news-filter active" data-cat="all">All</button>
        <button class="news-filter" data-cat="economy">Economy</button>
        <button class="news-filter" data-cat="markets">Markets</button>
        <button class="news-filter" data-cat="industry">Footwear & Apparel</button>
      </div>
      <div class="news-grid" id="news-grid">
        <div class="news-loading"><span class="material-icons-outlined" style="font-size:24px;vertical-align:middle;margin-right:8px">hourglass_top</span>Loading headlines...</div>
      </div>
    </div>`;

    loadNews(true);
    $$('.news-filter[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.news-filter[data-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterNews(btn.dataset.cat);
      });
    });
  }

  // ── GLOBAL DATA LOADING ──────────────────────────────────
  const GLOBAL_KEYS = [
    'DCOILWTICO','DCOILBRENTEU','DHHNGSP','PCOPPUSDM',
    'DEXUSEU','DEXJPUS','DEXUSUK','DEXCHUS','DEXMXUS','DEXKOUS',
    'DTWEXBGS','SP500','NASDAQCOM','VIXCLS','DGS10','DGS2','DFF',
    'T10Y2Y','BAMLH0A0HYM2','GDEBTPCTGDP',
    'SHOERETAIL','CLOTHRETAIL','FOOTWEARCPI','APPARELCPI','ECOMMPCT',
    'UMCSENT','REVOLVCREDIT','YOUTH1624UE',
    'CPIGB','CPICN','CPIIN','CPIDE','CPIBR','CPIJP','CPIKR',
    'UEJP','UEGB','UEDE',
    'RATEEZ','RATEJP','RATEGB',
  ];

  async function loadGlobalData() {
    for (let i = 0; i < GLOBAL_KEYS.length; i += 8) {
      const batch = GLOBAL_KEYS.slice(i, i + 8);
      const results = await Promise.allSettled(batch.map(k => FRED.getLatestWithChange(k)));
      batch.forEach((k, j) => {
        if (results[j].status === 'fulfilled' && results[j].value) {
          globalData[k] = results[j].value;
        }
      });
    }
    globalData._loaded = true;
  }

  function renderGlobalTicker() {
    const items = [
      { key: 'DCOILWTICO',   label: 'WTI Oil' },
      { key: 'DTWEXBGS',     label: 'USD Index' },
      { key: 'DEXUSEU',      label: 'EUR/USD' },
      { key: 'DEXJPUS',      label: 'USD/JPY' },
      { key: 'DEXUSUK',      label: 'GBP/USD' },
      { key: 'SP500',        label: 'S&P 500' },
      { key: 'NASDAQCOM',    label: 'NASDAQ' },
      { key: 'VIXCLS',       label: 'VIX' },
      { key: 'DGS10',        label: 'US 10Y' },
      { key: 'BAMLH0A0HYM2', label: 'HY Spread' },
      { key: 'DHHNGSP',      label: 'Nat Gas' },
    ];
    let html = '';
    if (livePrices) {
      const lp = [
        { key: 'gold', label: 'Gold $/oz' },
        { key: 'oil_wti', label: 'WTI $/bbl' },
        { key: 'oil_brent', label: 'Brent $/bbl' },
      ];
      lp.forEach(it => {
        const p = livePrices[it.key];
        if (!p || p.error) return;
        const dir = p.direction || 'flat';
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
        html += `<span class="ticker-item">
          <span class="label">${it.label}</span>
          <span class="value">$${p.price.toLocaleString()}</span>
          <span class="change ${dir}">${arrow} ${p.change >= 0 ? '+' : ''}${p.change} (${p.changePct >= 0 ? '+' : ''}${p.changePct}%)</span>
        </span><span class="ticker-sep">|</span>`;
      });
    }
    items.forEach(it => {
      const d = globalData[it.key];
      if (!d) return;
      const dir = d.direction || 'flat';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
      html += `<span class="ticker-item">
        <span class="label">${it.label}</span>
        <span class="value">${d.formatted}</span>
        <span class="change ${dir}">${arrow} ${d.changeFormatted || ''}</span>
      </span><span class="ticker-sep">|</span>`;
    });
    const ticker = $('#ticker-tape');
    ticker.innerHTML = html + html;
  }

  // ── GLOBAL NEWS ─────────────────────────────────────────────
  let cachedGlobalNews = null;
  let currentGlobalNewsCat = 'all';

  async function loadGlobalNews(forceRefresh) {
    const grid = $('#global-news-grid');
    try {
      if (!cachedGlobalNews || forceRefresh) {
        const resp = await fetch('/api/news?scope=global' + (forceRefresh ? '&t=' + Date.now() : ''));
        const data = await resp.json();
        cachedGlobalNews = data.articles || [];
      }
      renderGlobalNewsCards(cachedGlobalNews, currentGlobalNewsCat);
    } catch (e) {
      if (grid) grid.innerHTML = '<div class="news-loading" style="color:var(--red)">Failed to load global news.</div>';
    }
  }

  function filterGlobalNews(cat) {
    currentGlobalNewsCat = cat;
    if (!cachedGlobalNews) return;
    renderGlobalNewsCards(cachedGlobalNews, cat);
  }

  const GLOBAL_CAT_COLORS = {
    geopolitics: '#e74c3c', economy: '#3498db', markets: '#e67e22',
    trade: '#1abc9c', commodities: '#f39c12', currencies: '#9b59b6', policy: '#2ecc71',
    industry: '#1abc9c',
  };

  const GLOBAL_CAT_LABELS = {
    geopolitics: 'Geopolitics', economy: 'Economy', markets: 'Markets',
    trade: 'Trade', commodities: 'Commodities', currencies: 'Currencies', policy: 'Central Banks',
    industry: 'Footwear & Apparel',
  };

  function renderGlobalNewsCards(articles, cat) {
    renderNewsGrid('#global-news-grid', articles, cat, GLOBAL_CAT_COLORS, GLOBAL_CAT_LABELS);
  }

  // ── GLOBAL DAILY READ ───────────────────────────────────────
  function globalMacroOverview() {
    const sections = [['Europe','europe'],['China','china'],['Japan & Asia-Pacific','asia'],['Emerging Markets','em'],['Energy & Commodities','commodities'],['Gold & Safe Havens','gold'],['Global Risk Appetite','risk']];
    return aiSection({ id: 'global-macro', icon: 'public', title: 'Global Macro Overview',
      data: dynamicInsights?.global_daily, loadLabel: 'global macro',
      sources: dynamicInsights?._sourcesBySection?.global_daily,
      render: gdi => sections.map(([s,k]) => `<span class="dr-section">${s}</span><p>${md(gdi[k] || '')}</p>`).join('') });
  }

  function renderGlobalDailyRead() {
    const today = fmtToday();
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">public</span>Global Daily Read</h2>
        <p>${today}</p>
      </div>

      ${globalMacroOverview()}
      ${globalRegionalPulse()}
      ${globalIndustryInsights()}

      <div class="news-section-title"><span class="material-icons-outlined">newspaper</span> Global Headlines</div>
      <div class="news-filter-bar">
        <button class="news-filter active" data-gcat="all">All</button>
        <button class="news-filter" data-gcat="economy">Economy</button>
        <button class="news-filter" data-gcat="markets">Markets</button>
        <button class="news-filter" data-gcat="geopolitics">Geopolitics</button>
        <button class="news-filter" data-gcat="trade">Trade</button>
        <button class="news-filter" data-gcat="commodities">Commodities</button>
        <button class="news-filter" data-gcat="currencies">Currencies</button>
        <button class="news-filter" data-gcat="policy">Central Banks</button>
        <button class="news-filter" data-gcat="industry">Footwear & Apparel</button>
      </div>
      <div class="news-grid" id="global-news-grid">
        <div class="news-loading"><span class="material-icons-outlined" style="font-size:24px;vertical-align:middle;margin-right:8px">hourglass_top</span>Loading global headlines...</div>
      </div>
    </div>`;

    loadGlobalNews();
    $$('.news-filter[data-gcat]').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.news-filter[data-gcat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterGlobalNews(btn.dataset.gcat);
      });
    });
  }

  function globalRegionalPulse() {
    return aiSection({ id: 'global-regional', icon: 'map', title: 'Regional Pulse',
      data: dynamicInsights?.global_regional, loadLabel: 'regional pulse',
      sources: dynamicInsights?._sourcesBySection?.global_regional,
      render: gr => ['Europe','Japan & Asia-Pacific','China','Emerging Markets'].map((s,i) =>
        `<span class="dr-section">${s}</span><p>${md([gr.europe,gr.asia,gr.china,gr.em][i] || '')}</p>`).join('') });
  }

  function globalIndustryInsights() {
    const sections = [['European Luxury & Fashion','euro_luxury'],['China — Consumer & Domestic Brands','china_consumer'],['Asian Manufacturing & Supply Chains','asia_manufacturing'],['Africa & Latin America — The Growth Frontier','africa_latam'],['Digital Commerce & Social Selling','digital'],['Sustainability & Regulation','sustainability']];
    return aiSection({ id: 'global-industry', icon: 'storefront', title: 'Footwear & Apparel — Global Lens',
      data: dynamicInsights?.global_industry, loadLabel: 'global industry',
      sources: dynamicInsights?._sourcesBySection?.global_industry,
      render: gi => sections.map(([s,k]) => `<span class="dr-section">${s}</span><p>${md(gi[k] || '')}</p>`).join('') });
  }

  // ── GLOBAL OVERVIEW ─────────────────────────────────────────
  function renderGlobalOverview() {
    const lp = (k) => livePrices?.[k];
    const today = fmtToday();

    const statItems = [
      { key: 'DCOILWTICO', label: 'WTI Crude', icon: 'oil_barrel', liveKey: 'oil_wti' },
      { key: 'DCOILBRENTEU', label: 'Brent Crude', icon: 'oil_barrel', liveKey: 'oil_brent' },
      { key: null, label: 'Gold', icon: 'diamond', liveKey: 'gold' },
      { key: 'DHHNGSP', label: 'Natural Gas', icon: 'local_fire_department' },
      { key: 'DTWEXBGS', label: 'USD Index', icon: 'attach_money' },
      { key: 'SP500', label: 'S&P 500', icon: 'candlestick_chart' },
      { key: 'NASDAQCOM', label: 'NASDAQ', icon: 'trending_up' },
      { key: 'VIXCLS', label: 'VIX', icon: 'warning' },
      { key: 'DGS10', label: 'US 10Y Treasury', icon: 'show_chart' },
      { key: 'DFF', label: 'Fed Funds Rate', icon: 'account_balance' },
      { key: 'T10Y2Y', label: '10Y-2Y Spread', icon: 'compare_arrows' },
      { key: 'BAMLH0A0HYM2', label: 'HY Credit Spread', icon: 'shield' },
    ];

    const fxPairs = [
      { key: 'DEXUSEU', label: 'EUR/USD' },
      { key: 'DEXJPUS', label: 'USD/JPY' },
      { key: 'DEXUSUK', label: 'GBP/USD' },
      { key: 'DEXCHUS', label: 'USD/CNY' },
      { key: 'DEXMXUS', label: 'USD/MXN' },
      { key: 'DEXKOUS', label: 'USD/KRW' },
    ];

    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">public</span>Global Overview</h2>
        <p>Key global indicators — ${today}</p>
      </div>

      <div class="global-hero">
        ${statItems.map(s => {
          const p = s.liveKey && lp(s.liveKey);
          const val = p && !p.error ? `$${p.price.toLocaleString()}` : gVal(s.key);
          const dir = p && !p.error ? p.direction : gDir(s.key);
          const chg = p && !p.error ? `${p.change >= 0 ? '+' : ''}${p.change} (${p.changePct >= 0 ? '+' : ''}${p.changePct}%)` : gChg(s.key);
          return `<div class="g-stat-card">
            <div class="g-stat-label"><span class="material-icons-outlined">${s.icon}</span>${s.label}${p && !p.error ? ' <span style="font-size:0.6rem;opacity:0.5">live</span>' : ''}</div>
            <div class="g-stat-value">${val}</div>
            <div class="g-stat-change ${dir}">${chg}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="g-section-label"><span class="material-icons-outlined">currency_exchange</span>Major Currency Pairs</div>
      <div class="card" style="margin-top:8px">
        <table class="g-fx-table">
          <tr><th>Pair</th><th>Rate</th><th>Change</th></tr>
          ${fxPairs.map(p => `
            <tr>
              <td>${p.label}</td>
              <td>${gVal(p.key)}</td>
              <td class="${gDir(p.key)}">${gChg(p.key)}</td>
            </tr>
          `).join('')}
        </table>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('WTI Crude Oil', 'DCOILWTICO')}
          <div class="chart-container"><canvas id="g-oil-chart"></canvas></div>
        </div>
        <div class="card">
          ${yfChartHeader('Gold $/oz', 'GC=F', 'Gold Futures')}
          <div class="chart-container"><canvas id="g-gold-chart"></canvas></div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card">
          ${chartHeader('US Dollar Index', 'DTWEXBGS')}
          <div class="chart-container"><canvas id="g-dxy-chart"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('S&P 500', 'SP500')}
          <div class="chart-container"><canvas id="g-sp-chart"></canvas></div>
        </div>
      </div>
    </div>`;

    loadGlobalOverviewCharts();
  }

  async function loadGlobalOverviewCharts() {
    const [oil, gold, dxy, sp] = await Promise.all([
      FRED.getTimeSeries('DCOILWTICO', { startDate: yearAgo(chartRange(2)) }),
      fetchGoldHistory(chartRange(2)),
      FRED.getTimeSeries('DTWEXBGS', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('SP500', { startDate: yearAgo(chartRange(2)) }),
    ]);
    Charts.createLine('g-oil-chart', oil, { color: 'orange', label: 'WTI Crude Oil' });
    Charts.createLine('g-gold-chart', gold, { color: 'yellow', label: 'Gold $/oz' });
    Charts.createLine('g-dxy-chart', dxy, { color: 'cyan', label: 'USD Index' });
    Charts.createLine('g-sp-chart', sp, { color: 'green', label: 'S&P 500' });
  }

  // ── GLOBAL COMMODITIES ──────────────────────────────────────
  function renderGlobalCommodities() {
    const gd = globalData;
    const today = fmtToday();
    const oil = gd.DCOILWTICO, brent = gd.DCOILBRENTEU;
    const wtiP = lpVal('oil_wti');
    const oilDir = livePrices?.oil_wti?.direction || oil?.direction;

    const oilOutlook = oil || livePrices?.oil_wti
      ? (oilDir === 'up' ? `Oil at ${wtiP || gVal('DCOILWTICO')}/barrel is trending higher, creating inflationary pressure for the global economy. OPEC+ production decisions, geopolitical risk premiums, and refinery bottlenecks are supporting prices. Central banks face a difficult balancing act.`
        : oilDir === 'down' ? `Oil at ${wtiP || gVal('DCOILWTICO')}/barrel is trending lower, suggesting demand weakness or loosening supply. Energy-importing economies benefit, but falling prices raise fiscal risk for petrostates and reduce energy investment.`
        : `Oil at ${wtiP || gVal('DCOILWTICO')}/barrel is range-bound — not cheap enough to be stimulative, not high enough to be recessionary. The market is watching OPEC+ compliance and Chinese demand signals.`)
      : '';

    const goldP = lpVal('gold');
    const goldDir2 = livePrices?.gold?.direction;
    const goldOutlook = livePrices?.gold
      ? (goldDir2 === 'up' ? `Gold at ${goldP}/oz is trending higher, reflecting a confluence of central bank reserve buying, geopolitical hedging, and real rate expectations. This is a structural bid, not just speculative — central banks from China to Poland are accumulating.`
        : goldDir2 === 'down' ? `Gold at ${goldP}/oz is pulling back — higher real yields globally and dollar strength are reducing the appeal of non-yielding assets. However, EM central bank accumulation provides a structural floor.`
        : `Gold at ${goldP}/oz is range-bound, serving its traditional role as a portfolio diversifier and inflation hedge amid global macro uncertainty.`)
      : '';

    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">oil_barrel</span>Commodities</h2>
        <p>Global commodity prices and energy markets — ${today}</p>
      </div>

      <div class="global-hero">
        <div class="g-stat-card">
          <div class="g-stat-label"><span class="material-icons-outlined">oil_barrel</span>WTI Crude</div>
          <div class="g-stat-value">${lpFmt('oil_wti', gVal('DCOILWTICO'))}</div>
          <div class="g-stat-change ${lpDirCls('oil_wti') || gDir('DCOILWTICO')}">${lpChgFmt('oil_wti') || gChg('DCOILWTICO')}</div>
        </div>
        <div class="g-stat-card">
          <div class="g-stat-label"><span class="material-icons-outlined">oil_barrel</span>Brent Crude</div>
          <div class="g-stat-value">${lpFmt('oil_brent', gVal('DCOILBRENTEU'))}</div>
          <div class="g-stat-change ${lpDirCls('oil_brent') || gDir('DCOILBRENTEU')}">${lpChgFmt('oil_brent') || gChg('DCOILBRENTEU')}</div>
        </div>
        <div class="g-stat-card">
          <div class="g-stat-label"><span class="material-icons-outlined">diamond</span>Gold</div>
          <div class="g-stat-value">${lpFmt('gold', '—')}</div>
          <div class="g-stat-change ${lpDirCls('gold')}">${lpChgFmt('gold')}</div>
        </div>
        <div class="g-stat-card">
          <div class="g-stat-label"><span class="material-icons-outlined">local_fire_department</span>Natural Gas</div>
          <div class="g-stat-value">${gVal('DHHNGSP')}</div>
          <div class="g-stat-change ${gDir('DHHNGSP')}">${gChg('DHHNGSP')}</div>
        </div>
        <div class="g-stat-card">
          <div class="g-stat-label"><span class="material-icons-outlined">hardware</span>Copper</div>
          <div class="g-stat-value">${gVal('PCOPPUSDM')}</div>
          <div class="g-stat-change ${gDir('PCOPPUSDM')}">${gChg('PCOPPUSDM')}</div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="g-region-card">
          <div class="g-region-head"><span class="material-icons-outlined" style="color:var(--orange)">oil_barrel</span>Oil Market Outlook</div>
          <div class="g-region-body"><p>${oilOutlook}</p>
          <p>WTI-Brent spread: ${oil && brent ? (brent.value - oil.value).toFixed(2) : '—'}. ${oil && brent && brent.value - oil.value > 5 ? 'A wide spread suggests tight Atlantic Basin supply relative to US production.' : 'A narrow spread indicates balanced global crude flows.'}</p></div>
        </div>
        <div class="g-region-card">
          <div class="g-region-head"><span class="material-icons-outlined" style="color:var(--yellow)">diamond</span>Gold & Precious Metals</div>
          <div class="g-region-body"><p>${goldOutlook}</p></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:12px">
        <div class="card">
          ${chartHeader('WTI vs Brent Crude', 'DCOILWTICO', 'DCOILBRENTEU')}
          <div class="chart-container"><canvas id="g-oil-compare"></canvas></div>
        </div>
        <div class="card">
          ${yfChartHeader('Gold $/oz', 'GC=F', 'Gold Futures')}
          <div class="chart-container"><canvas id="g-gold-hist"></canvas></div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card">
          ${chartHeader('Natural Gas (Henry Hub)', 'DHHNGSP')}
          <div class="chart-container"><canvas id="g-gas-chart"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Copper Price', 'PCOPPUSDM')}
          <div class="chart-container"><canvas id="g-copper-chart"></canvas></div>
        </div>
      </div>
    </div>`;

    loadCommodityCharts();
  }

  async function loadCommodityCharts() {
    const [wti, brent, gold, gas, copper] = await Promise.all([
      FRED.getTimeSeries('DCOILWTICO', { startDate: yearAgo(chartRange(3)) }),
      FRED.getTimeSeries('DCOILBRENTEU', { startDate: yearAgo(chartRange(3)) }),
      fetchGoldHistory(3),
      FRED.getTimeSeries('DHHNGSP', { startDate: yearAgo(chartRange(3)) }),
      FRED.getTimeSeries('PCOPPUSDM', { startDate: yearAgo(chartRange(5)) }),
    ]);
    Charts.createLine('g-oil-compare', [wti, brent], { colors: ['orange', 'red'], labels: ['WTI', 'Brent'], showLegend: true, noFill: true });
    Charts.createLine('g-gold-hist', gold, { color: 'yellow', label: 'Gold $/oz' });
    Charts.createLine('g-gas-chart', gas, { color: 'cyan', label: 'Natural Gas ($/MMBtu)' });
    Charts.createLine('g-copper-chart', copper, { color: 'green', label: 'Copper ($/lb)' });
  }

  // ── GLOBAL FX ───────────────────────────────────────────────
  function renderGlobalFX() {
    const gd = globalData;
    const today = fmtToday();

    const fxPairs = [
      { key: 'DEXUSEU', label: 'EUR/USD', desc: 'Euro vs US Dollar' },
      { key: 'DEXJPUS', label: 'USD/JPY', desc: 'US Dollar vs Japanese Yen' },
      { key: 'DEXUSUK', label: 'GBP/USD', desc: 'British Pound vs US Dollar' },
      { key: 'DEXCHUS', label: 'USD/CNY', desc: 'US Dollar vs Chinese Yuan' },
      { key: 'DEXMXUS', label: 'USD/MXN', desc: 'US Dollar vs Mexican Peso' },
      { key: 'DEXKOUS', label: 'USD/KRW', desc: 'US Dollar vs Korean Won' },
    ];

    const dxy = gd.DTWEXBGS;
    const dollarBias = dxy
      ? (dxy.direction === 'up' ? 'The broad dollar is strengthening — risk-off flows, rate differentials, and relative US economic outperformance are all supporting the greenback.'
        : dxy.direction === 'down' ? 'The dollar is trending weaker, providing global liquidity relief. This typically benefits commodities, EM assets, and risk appetite broadly.'
        : 'The dollar is range-bound, waiting for a catalyst from either the Fed, economic data, or geopolitical shifts.')
      : '';

    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">currency_exchange</span>Currencies & FX</h2>
        <p>Major exchange rates and dollar dynamics — ${today}</p>
      </div>

      <div class="global-hero" style="margin-bottom:16px">
        <div class="g-stat-card" style="grid-column: span 2">
          <div class="g-stat-label"><span class="material-icons-outlined">attach_money</span>US Dollar Index (Broad)</div>
          <div class="g-stat-value">${gVal('DTWEXBGS')}</div>
          <div class="g-stat-change ${gDir('DTWEXBGS')}">${gChg('DTWEXBGS')}</div>
        </div>
        ${fxPairs.map(p => `
          <div class="g-stat-card">
            <div class="g-stat-label">${p.label}</div>
            <div class="g-stat-value">${gVal(p.key)}</div>
            <div class="g-stat-change ${gDir(p.key)}">${gChg(p.key)}</div>
          </div>
        `).join('')}
      </div>

      <div class="g-region-card" style="margin-bottom:16px">
        <div class="g-region-head"><span class="material-icons-outlined" style="color:var(--accent)">insights</span>Dollar Outlook</div>
        <div class="g-region-body"><p>${dollarBias}</p></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          ${chartHeader('US Dollar Index', 'DTWEXBGS')}
          <div class="chart-container"><canvas id="g-fx-dxy"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('EUR/USD', 'DEXUSEU')}
          <div class="chart-container"><canvas id="g-fx-eur"></canvas></div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card">
          ${chartHeader('USD/JPY', 'DEXJPUS')}
          <div class="chart-container"><canvas id="g-fx-jpy"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('GBP/USD', 'DEXUSUK')}
          <div class="chart-container"><canvas id="g-fx-gbp"></canvas></div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card">
          ${chartHeader('USD/CNY', 'DEXCHUS')}
          <div class="chart-container"><canvas id="g-fx-cny"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('USD/MXN', 'DEXMXUS')}
          <div class="chart-container"><canvas id="g-fx-mxn"></canvas></div>
        </div>
      </div>
    </div>`;

    loadFXCharts();
  }

  async function loadFXCharts() {
    const [dxy, eur, jpy, gbp, cny, mxn] = await Promise.all([
      FRED.getTimeSeries('DTWEXBGS', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('DEXUSEU', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('DEXJPUS', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('DEXUSUK', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('DEXCHUS', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('DEXMXUS', { startDate: yearAgo(chartRange(2)) }),
    ]);
    Charts.createLine('g-fx-dxy', dxy, { color: 'blue', label: 'USD Index' });
    Charts.createLine('g-fx-eur', eur, { color: 'green', label: 'EUR/USD' });
    Charts.createLine('g-fx-jpy', jpy, { color: 'red', label: 'USD/JPY' });
    Charts.createLine('g-fx-gbp', gbp, { color: 'purple', label: 'GBP/USD' });
    Charts.createLine('g-fx-cny', cny, { color: 'orange', label: 'USD/CNY' });
    Charts.createLine('g-fx-mxn', mxn, { color: 'cyan', label: 'USD/MXN' });
  }

  // ── GLOBAL HEADLINES (standalone tab) ───────────────────────
  function renderGlobalHeadlines() {
    const today = fmtToday();
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">newspaper</span>Global Headlines</h2>
        <p>Live news from Reuters, BBC, Bloomberg & more — ${today}</p>
      </div>

      <div class="news-filter-bar">
        <button class="news-filter active" data-gcat="all">All</button>
        <button class="news-filter" data-gcat="economy">Economy</button>
        <button class="news-filter" data-gcat="markets">Markets</button>
        <button class="news-filter" data-gcat="geopolitics">Geopolitics</button>
        <button class="news-filter" data-gcat="trade">Trade</button>
        <button class="news-filter" data-gcat="commodities">Commodities</button>
        <button class="news-filter" data-gcat="currencies">Currencies</button>
        <button class="news-filter" data-gcat="policy">Central Banks</button>
        <button class="news-filter" data-gcat="industry">Footwear & Apparel</button>
      </div>
      <div class="news-grid" id="global-news-grid">
        <div class="news-loading"><span class="material-icons-outlined" style="font-size:24px;vertical-align:middle;margin-right:8px">hourglass_top</span>Loading global headlines...</div>
      </div>
    </div>`;

    loadGlobalNews(true);
    $$('.news-filter[data-gcat]').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.news-filter[data-gcat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterGlobalNews(btn.dataset.gcat);
      });
    });
  }

  // ── OVERVIEW ───────────────────────────────────────────────
  function renderOverview() {
    const health = Events.computeHealthScore(allData);
    const briefing = Events.getDailyBriefing(allData);
    const recession = Events.getRecessionIndicators(allData);

    const topStats = [
      { key: 'GDPGROWTH', icon: 'trending_up', goodDir: 'up' },
      { key: 'UNRATE',    icon: 'groups',       goodDir: 'down' },
      { key: 'DFF',       icon: 'account_balance' },
      { key: 'DGS10',     icon: 'show_chart' },
      { key: 'SP500',     icon: 'candlestick_chart', goodDir: 'up' },
      { key: 'VIXCLS',    icon: 'warning',      goodDir: 'down' },
      { key: 'MORTGAGE30US', icon: 'house',      goodDir: 'down' },
      { key: 'GASREGW',   icon: 'local_gas_station', goodDir: 'down' },
    ];

    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">flag</span>Economic Overview</h2>
        <p>Real-time snapshot of the US economy — ${fmtToday()}</p>
      </div>
      ${tabSummary('overview')}

      <div class="grid grid-4">
        ${topStats.map(s => statCard(s.key, s.icon, s.goodDir)).join('')}
      </div>

      <div class="grid grid-3" style="margin-top:20px">
        <div class="card">
          <div class="card-header"><span class="card-title">Economy Health Score</span></div>
          <div class="health-score">
            <div class="health-ring">
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#1e2433" stroke-width="8"/>
                <circle cx="50" cy="50" r="42" fill="none"
                  stroke="${health.score > 65 ? '#22c55e' : health.score > 40 ? '#eab308' : '#ef4444'}"
                  stroke-width="8" stroke-linecap="round"
                  stroke-dasharray="${(health.score / 100) * 264} 264"/>
              </svg>
              <div class="score-text" style="color:${health.score > 65 ? '#22c55e' : health.score > 40 ? '#eab308' : '#ef4444'}">${health.score}</div>
            </div>
            <div class="health-factors">
              ${Object.entries(health.factors).map(([name, score]) => `
                <div class="health-factor">
                  <span class="factor-name">${name}</span>
                  <span class="factor-score" style="color:${score > 65 ? '#22c55e' : score > 40 ? '#eab308' : '#ef4444'}">${score}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Recession Indicators</span></div>
          ${recession.map(r => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="width:8px;height:8px;border-radius:50%;background:${r.signal === 'ok' ? 'var(--green)' : r.signal === 'warning' ? 'var(--yellow)' : 'var(--red)'}"></span>
              <div style="flex:1">
                <div style="font-size:0.82rem;font-weight:600">${r.name}</div>
                <div style="font-size:0.72rem;color:var(--text-muted)">${r.detail}</div>
              </div>
              <span style="font-size:0.85rem;font-weight:700;font-variant-numeric:tabular-nums">${r.value}</span>
            </div>
          `).join('')}
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Yield Curve Snapshot</span></div>
          <table class="data-table yield-curve-table">
            <tr><th>Maturity</th><th>Yield</th><th>Chg</th></tr>
            ${['DGS2','DGS5','DGS10','DGS30'].map(k => {
              const d = allData[k];
              if (!d) return '';
              return `<tr>
                <td class="maturity"><a href="${FRED.sourceUrl(k)}" target="_blank" class="source-link" style="font-size:inherit;color:var(--text-dim)">${FRED.getSpec(k).name} <span class="material-icons-outlined">open_in_new</span></a></td>
                <td style="font-weight:700">${d.formatted}</td>
                <td class="${d.direction}">${d.changeFormatted || '–'}</td>
              </tr>`;
            }).join('')}
          </table>
          <div style="margin-top:12px"><div class="chart-container short"><canvas id="overview-yield-chart"></canvas></div></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card span-2">
          <div class="card-header"><span class="card-title">Daily Economic Briefing</span></div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
            ${briefing.map(b => `
              <div class="news-card card" style="border-left-color:${b.sentiment === 'positive' ? 'var(--green)' : b.sentiment === 'negative' ? 'var(--red)' : 'var(--accent)'}">
                <div class="news-source">${b.category}</div>
                <div class="news-headline">${b.headline}</div>
                <div class="news-snippet">${b.body}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('S&P 500', 'SP500')}
          <div class="chart-container"><canvas id="overview-sp500"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Fed Funds Rate vs 10Y Treasury', 'DFF', 'DGS10')}
          <div class="chart-container"><canvas id="overview-rates"></canvas></div>
        </div>
      </div>
    </div>`;

    loadOverviewCharts();
  }

  async function loadOverviewCharts() {
    const [sp500, dff, dgs10, dgs2, dgs5, dgs30] = await Promise.all([
      FRED.getTimeSeries('SP500', { startDate: yearAgo(chartRange(2)) }),
      FRED.getTimeSeries('DFF', { startDate: yearAgo(chartRange(5)) }),
      FRED.getTimeSeries('DGS10', { startDate: yearAgo(chartRange(5)) }),
      FRED.getTimeSeries('DGS2', { startDate: yearAgo(chartRange(1)) }),
      FRED.getTimeSeries('DGS5', { startDate: yearAgo(chartRange(1)) }),
      FRED.getTimeSeries('DGS30', { startDate: yearAgo(chartRange(1)) }),
    ]);

    Charts.createLine('overview-sp500', sp500, { color: 'green', label: 'S&P 500' });

    Charts.createLine('overview-rates', [dff, dgs10], {
      colors: ['purple', 'blue'],
      labels: ['Fed Funds', '10Y Treasury'],
      showLegend: true,
      noFill: true,
    });

    if (dgs2.length && dgs5.length && dgs10.length && dgs30.length) {
      const latest = [
        { date: '2Y', value: dgs2[dgs2.length - 1]?.value },
        { date: '5Y', value: dgs5[dgs5.length - 1]?.value },
        { date: '10Y', value: dgs10[dgs10.length - 1]?.value },
        { date: '30Y', value: dgs30[dgs30.length - 1]?.value },
      ];
      const canvas = document.getElementById('overview-yield-chart');
      if (canvas) {
        new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels: latest.map(d => d.date),
            datasets: [{
              label: 'Yield',
              data: latest.map(d => d.value),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59,130,246,0.08)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 5,
              pointBackgroundColor: '#3b82f6',
              pointHoverRadius: 7,
              pointHoverBackgroundColor: '#3b82f6',
              pointHoverBorderColor: '#fff',
              pointHoverBorderWidth: 2,
              pointHitRadius: 12,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                enabled: true,
                backgroundColor: '#1a1f2e',
                titleColor: '#e2e8f0',
                bodyColor: '#8892a4',
                borderColor: '#2a3045',
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                titleFont: { family: 'Inter', weight: '600', size: 12 },
                bodyFont: { family: 'Inter', size: 12 },
                callbacks: {
                  label(item) { return item.raw.toFixed(2) + '%'; },
                },
              },
            },
            scales: {
              x: { grid: { color: 'rgba(30,36,51,0.6)' }, ticks: { color: '#5a6478', font: { family: 'Inter', size: 10 } }, border: { display: false } },
              y: { grid: { color: 'rgba(30,36,51,0.6)' }, ticks: { color: '#5a6478', font: { family: 'Inter', size: 10 }, callback: v => v.toFixed(1) + '%' }, border: { display: false } },
            },
          },
        });
      }
    }
  }

  // ── CONFIG-DRIVEN DATA TABS ─────────────────────────────────
  const TAB_CONFIGS = {
    growth: {
      title: 'Growth &amp; Output', icon: 'trending_up',
      subtitle: 'GDP, industrial production, and capacity utilization',
      summaryKey: 'growth',
      stats: { grid: 3, items: [
        { key: 'GDPGROWTH', goodDir: 'up' }, { key: 'INDPRO' }, { key: 'CAPACITY' },
      ]},
      charts: [
        [
          { id: 'growth-gdp', key: 'GDPGROWTH', title: 'Real GDP Growth (Quarterly)', years: 10, type: 'bar', opts: { color: 'blue', conditionalColor: true, label: 'GDP Growth %' } },
          { id: 'growth-indpro', key: 'INDPRO', title: 'Industrial Production Index', years: 10, opts: { color: 'cyan' } },
        ],
        [{ id: 'growth-capacity', key: 'CAPACITY', title: 'Capacity Utilization (%)', years: 10, opts: { color: 'orange', yLabel: '%' } }],
      ],
    },
    labor: {
      title: 'Labor Market', icon: 'work',
      subtitle: 'Employment, wages, claims, and labor force dynamics',
      summaryKey: 'labor',
      stats: { grid: 4, items: [
        { key: 'UNRATE', goodDir: 'down' }, { key: 'PAYEMS', goodDir: 'up' },
        { key: 'ICSA', goodDir: 'down' }, { key: 'CIVPART', goodDir: 'up' },
        { key: 'U6RATE', goodDir: 'down' }, { key: 'CES0500000003', goodDir: 'up' },
        { key: 'JTSJOL', goodDir: 'up' }, { key: 'AWHAEPBS', goodDir: 'up' },
      ]},
      charts: [
        [
          { id: 'labor-unrate', key: 'UNRATE', title: 'Unemployment Rate', years: 10, opts: { color: 'red' } },
          { id: 'labor-payems', key: 'PAYEMS', title: 'Nonfarm Payrolls (Thousands)', years: 10, opts: { color: 'green' } },
        ],
        [
          { id: 'labor-icsa', key: 'ICSA', title: 'Initial Jobless Claims (Weekly)', years: 3, opts: { color: 'orange' } },
          { id: 'labor-jolts', key: 'JTSJOL', title: 'Job Openings (JOLTS, Millions)', years: 5, opts: { color: 'purple' } },
        ],
        [
          { id: 'labor-civpart', key: 'CIVPART', title: 'Labor Force Participation Rate', years: 10, opts: { color: 'cyan' } },
          { id: 'labor-wages', key: 'CES0500000003', title: 'Average Hourly Earnings', years: 10, opts: { color: 'green' } },
        ],
      ],
    },
    inflation: {
      title: 'Inflation', icon: 'local_fire_department',
      subtitle: 'CPI, PCE, PPI, breakevens, and energy prices',
      summaryKey: 'inflation',
      stats: { grid: 4, items: [
        { key: 'CPIYOY', label: 'CPI YoY', type: 'yoy', goodDir: 'down' },
        { key: 'PCEYOY', label: 'PCE YoY', type: 'yoy', goodDir: 'down' },
        { key: 'GASREGW', goodDir: 'down' }, { key: 'T5YIE' },
      ]},
      charts: [
        [
          { id: 'infl-cpi', key: 'CPIAUCSL', title: 'CPI Index (All Urban Consumers)', years: 10, opts: { color: 'red' } },
          { id: 'infl-pce', key: 'PCEPI', title: 'PCE Price Index', years: 10, opts: { color: 'orange' } },
        ],
        [
          { id: 'infl-breakeven', keys: ['T5YIE', 'T10YIE'], title: 'Breakeven Inflation (5Y vs 10Y)', years: 5, opts: { colors: ['yellow', 'cyan'], labels: ['5Y Breakeven', '10Y Breakeven'], showLegend: true, noFill: true } },
          { id: 'infl-gas', key: 'GASREGW', title: 'Regular Gasoline Price', years: 5, opts: { color: 'orange' } },
        ],
        [{ id: 'infl-ppi', key: 'PPIACO', title: 'PPI — All Commodities', years: 10, opts: { color: 'purple' } }],
      ],
    },
    rates: {
      title: 'Rates &amp; Monetary Policy', icon: 'account_balance',
      subtitle: 'Treasury yields, Fed policy, mortgage rates, and money supply',
      summaryKey: 'rates',
      stats: { grid: 4, items: [
        { key: 'DFF' }, { key: 'DGS10' }, { key: 'DGS2' }, { key: 'T10Y2Y' },
        { key: 'T10Y3M' }, { key: 'MORTGAGE30US' }, { key: 'WALCL' }, { key: 'M2SL' },
      ]},
      charts: [
        [
          { id: 'rates-treasuries', keys: ['DGS2', 'DGS5', 'DGS10', 'DGS30'], title: 'Treasury Yields (2Y, 5Y, 10Y, 30Y)', years: 5, opts: { colors: ['green', 'yellow', 'blue', 'purple'], labels: ['2Y', '5Y', '10Y', '30Y'], showLegend: true, noFill: true } },
          { id: 'rates-spread', key: 'T10Y2Y', title: '10Y-2Y Spread (Yield Curve)', years: 10, opts: { color: 'orange', yLabel: 'bps' } },
        ],
        [
          { id: 'rates-mortgage', key: 'MORTGAGE30US', title: '30-Year Mortgage Rate', years: 10, opts: { color: 'red' } },
          { id: 'rates-balance', key: 'WALCL', title: 'Fed Balance Sheet ($T)', years: 10, opts: { color: 'purple' } },
        ],
        [{ id: 'rates-m2', key: 'M2SL', title: 'M2 Money Supply ($T)', years: 10, opts: { color: 'cyan' } }],
      ],
    },
    housing: {
      title: 'Housing', icon: 'home',
      subtitle: 'Starts, permits, prices, sales, and supply',
      summaryKey: 'housing',
      stats: { grid: 3, items: [
        { key: 'HOUST' }, { key: 'PERMIT' }, { key: 'CSUSHPISA' },
        { key: 'MSPUS' }, { key: 'MORTGAGE30US' }, { key: 'MSACSR' },
      ]},
      charts: [
        [
          { id: 'housing-starts', key: 'HOUST', title: 'Housing Starts (Thousands, Annualized)', years: 10, opts: { color: 'blue' } },
          { id: 'housing-permits', key: 'PERMIT', title: 'Building Permits', years: 10, opts: { color: 'green' } },
        ],
        [
          { id: 'housing-cs', key: 'CSUSHPISA', title: 'Case-Shiller Home Price Index', years: 10, opts: { color: 'orange' } },
          { id: 'housing-supply', key: 'MSACSR', title: 'Months Supply of Homes', years: 10, opts: { color: 'purple' } },
        ],
      ],
    },
    consumer: {
      title: 'Consumer &amp; Business', icon: 'shopping_cart',
      subtitle: 'Sentiment, spending, savings, trade, and fiscal position',
      summaryKey: 'consumer',
      stats: { grid: 4, items: [
        { key: 'UMCSENT' }, { key: 'RSAFS' }, { key: 'PSAVERT' }, { key: 'PCE' },
        { key: 'DGORDER' }, { key: 'BOPGSTB' }, { key: 'DSPIC96' }, { key: 'GFDEBTN' },
      ]},
      charts: [
        [
          { id: 'cons-sent', key: 'UMCSENT', title: 'Consumer Sentiment (UMich)', years: 10, opts: { color: 'blue' } },
          { id: 'cons-retail', key: 'RSAFS', title: 'Retail Sales ($B)', years: 10, opts: { color: 'green' } },
        ],
        [
          { id: 'cons-savings', key: 'PSAVERT', title: 'Personal Savings Rate (%)', years: 10, opts: { color: 'orange' } },
          { id: 'cons-trade', key: 'BOPGSTB', title: 'Trade Balance ($B)', years: 10, opts: { color: 'red' } },
        ],
        [
          { id: 'cons-durable', key: 'DGORDER', title: 'Durable Goods Orders ($B)', years: 10, opts: { color: 'purple' } },
          { id: 'cons-debt', key: 'GFDEBTN', title: 'Federal Debt ($T)', years: 20, opts: { color: 'red' } },
        ],
      ],
    },
    markets: {
      title: 'Financial Markets', icon: 'candlestick_chart',
      subtitle: 'Equities, volatility, dollar, and credit spreads',
      summaryKey: 'markets',
      stats: { grid: 4, items: [
        { key: 'SP500', goodDir: 'up' }, { key: 'VIXCLS', goodDir: 'down' },
        { key: 'DTWEXBGS' }, { key: 'BAMLH0A0HYM2' },
      ]},
      charts: [
        [
          { id: 'mkt-sp500', key: 'SP500', title: 'S&P 500', years: 5, opts: { color: 'green' } },
          { id: 'mkt-vix', key: 'VIXCLS', title: 'VIX (Fear Index)', years: 5, opts: { color: 'red' } },
        ],
        [
          { id: 'mkt-usd', key: 'DTWEXBGS', title: 'US Dollar Index (Broad)', years: 5, opts: { color: 'cyan' } },
          { id: 'mkt-hy', key: 'BAMLH0A0HYM2', title: 'High Yield Credit Spread', years: 5, opts: { color: 'orange' } },
        ],
      ],
    },
  };

  function renderDataTab(cfg) {
    const statsHtml = cfg.stats.items.map(s =>
      s.type === 'yoy' ? yoyStatCard(s.key, s.label, s.goodDir) : statCard(s.key, s.icon || null, s.goodDir || null)
    ).join('');
    const chartsHtml = cfg.charts.map(row => {
      const cls = row.length === 1 ? 'grid-1' : 'grid-2';
      return `<div class="grid ${cls}" style="margin-top:20px">${row.map(c => {
        const hdrKeys = c.keys || [c.key];
        return `<div class="card">${chartHeader(c.title, ...hdrKeys)}<div class="chart-container"><canvas id="${c.id}"></canvas></div></div>`;
      }).join('')}</div>`;
    }).join('');
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header"><h2><span class="material-icons-outlined">${cfg.icon}</span>${cfg.title}</h2><p>${cfg.subtitle}</p></div>
      ${tabSummary(cfg.summaryKey)}
      <div class="grid grid-${cfg.stats.grid || 4}">${statsHtml}</div>
      ${chartsHtml}
    </div>`;
    loadTabCharts(cfg.charts);
  }

  async function loadTabCharts(chartRows) {
    const all = chartRows.flat();
    const fetches = all.map(c => c.keys
      ? Promise.all(c.keys.map(k => FRED.getTimeSeries(k, { startDate: yearAgo(chartRange(c.years || 5)) })))
      : FRED.getTimeSeries(c.key, { startDate: yearAgo(chartRange(c.years || 5)) })
    );
    const results = await Promise.all(fetches);
    all.forEach((c, i) => {
      (c.type === 'bar' ? Charts.createBar : Charts.createLine)(c.id, results[i], c.opts || {});
    });
  }







  // ── POPULATION & MIGRATION ──────────────────────────────────
  function renderPopulation() {
    const stats = ['POPTHM','POPGROW','FERTILITY','BIRTHRATE','LIFEEXP','POP65','NETMIG','CLF16OV'];
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">groups</span>Population &amp; Migration</h2>
        <p>Demographics, fertility, life expectancy, age structure, and migration trends</p>
      </div>
      ${tabSummary('population')}
      <div class="grid grid-4">${stats.map(k => statCard(k, null, k === 'POPTHM' || k === 'LIFEEXP' || k === 'CLF16OV' ? 'up' : k === 'INFANTMORT' ? 'down' : null)).join('')}</div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Total US Population (Millions)', 'POPTHM')}
          <div class="chart-container"><canvas id="pop-total"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Population Growth Rate (%)', 'POPGROW')}
          <div class="chart-container"><canvas id="pop-growth"></canvas></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Net Migration (Millions)', 'NETMIG')}
          <div class="chart-container"><canvas id="pop-migration"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Fertility Rate (Births per Woman)', 'FERTILITY')}
          <div class="chart-container"><canvas id="pop-fertility"></canvas></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Life Expectancy at Birth (Years)', 'LIFEEXP')}
          <div class="chart-container"><canvas id="pop-lifeexp"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Birth Rate (per 1,000 People)', 'BIRTHRATE')}
          <div class="chart-container"><canvas id="pop-birthrate"></canvas></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Age Structure — 65+ vs 0-14 Share (%)', 'POP65', 'POP014')}
          <div class="chart-container"><canvas id="pop-age"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Working Age Population & Labor Force (Millions)', 'WORKAGEPOP', 'CLF16OV')}
          <div class="chart-container"><canvas id="pop-working"></canvas></div>
        </div>
      </div>

      <div class="grid grid-1" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Infant Mortality Rate (per 1,000 Live Births)', 'INFANTMORT')}
          <div class="chart-container"><canvas id="pop-infant"></canvas></div>
        </div>
      </div>

      <div class="grid grid-1" style="margin-top:20px">
        <div class="card" style="padding:24px">
          <div class="card-header"><span class="card-title">Demographic Snapshot</span></div>
          ${renderDemoSnapshot()}
        </div>
      </div>
    </div>`;
    loadPopulationCharts();
  }

  function renderDemoSnapshot() {
    const items = [
      { key: 'POPTHM',     label: 'Total Population' },
      { key: 'POPGROW',    label: 'Annual Growth Rate' },
      { key: 'FERTILITY',  label: 'Fertility Rate' },
      { key: 'BIRTHRATE',  label: 'Crude Birth Rate' },
      { key: 'LIFEEXP',    label: 'Life Expectancy' },
      { key: 'INFANTMORT', label: 'Infant Mortality' },
      { key: 'POP65',      label: 'Aged 65+' },
      { key: 'POP014',     label: 'Aged 0-14' },
      { key: 'WORKAGEPOP', label: 'Working Age (15-64)' },
      { key: 'CLF16OV',    label: 'Civilian Labor Force' },
      { key: 'NETMIG',     label: 'Net Migration (5-yr)' },
    ];
    return `<table class="data-table">
      <tr><th>Indicator</th><th>Latest Value</th><th>Change</th><th>As Of</th><th>Source</th></tr>
      ${items.map(it => {
        const d = allData[it.key];
        const spec = FRED.getSpec(it.key);
        if (!d) return `<tr><td>${it.label}</td><td style="color:var(--text-muted)">—</td><td></td><td></td><td></td></tr>`;
        return `<tr>
          <td style="font-weight:600">${it.label}</td>
          <td style="font-weight:700">${d.formatted}</td>
          <td class="${d.direction}" style="font-weight:600">${d.changeFormatted || '–'}</td>
          <td style="color:var(--text-muted);font-size:0.78rem">${formatDate(d.date)}</td>
          <td><a href="${FRED.sourceUrl(it.key)}" target="_blank" class="source-link"><span class="material-icons-outlined">open_in_new</span>${spec?.id || ''}</a></td>
        </tr>`;
      }).join('')}
    </table>`;
  }

  async function loadPopulationCharts() {
    const [total, growth, migration, fertility, lifeexp, birthrate, pop65, pop014, working, clf] = await Promise.all([
      FRED.getTimeSeries('POPTHM', { startDate: yearAgo(chartRange(30)) }),
      FRED.getTimeSeries('POPGROW', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('NETMIG', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('FERTILITY', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('LIFEEXP', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('BIRTHRATE', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('POP65', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('POP014', { startDate: yearAgo(chartRange(50)) }),
      FRED.getTimeSeries('WORKAGEPOP', { startDate: yearAgo(chartRange(20)) }),
      FRED.getTimeSeries('CLF16OV', { startDate: yearAgo(chartRange(20)) }),
    ]);

    Charts.createLine('pop-total', total, { color: 'blue', label: 'Population (M)' });
    Charts.createBar('pop-growth', growth, { color: 'green', conditionalColor: true, label: 'Growth %' });
    Charts.createBar('pop-migration', migration, { color: 'cyan', label: 'Net Migration (M)' });
    Charts.createLine('pop-fertility', fertility, { color: 'purple' });
    Charts.createLine('pop-lifeexp', lifeexp, { color: 'green' });
    Charts.createLine('pop-birthrate', birthrate, { color: 'orange' });

    if (pop65.length && pop014.length) {
      Charts.createLine('pop-age', [pop65, pop014], {
        colors: ['red', 'blue'],
        labels: ['65+ Share %', '0-14 Share %'],
        showLegend: true,
        noFill: true,
      });
    }

    if (working.length && clf.length) {
      Charts.createLine('pop-working', [working, clf], {
        colors: ['orange', 'green'],
        labels: ['Working Age Pop', 'Civilian Labor Force'],
        showLegend: true,
        noFill: true,
      });
    }

    Charts.createLine('pop-infant', lifeexp.length ? await FRED.getTimeSeries('INFANTMORT', { startDate: yearAgo(chartRange(50)) }) : [], { color: 'red' });
  }

  // ── YOUTH & APPAREL ─────────────────────────────────────────
  function renderYouth() {
    const insights = buildYouthInsights();

    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">storefront</span>Industry Overview</h2>
        <p>Younger demographic footwear &amp; apparel consumer behavior — spending patterns, price trends, and qualitative analysis</p>
      </div>
      ${tabSummary('youth')}

      <div class="dd-callout" style="margin-top:16px">
        <span class="material-icons-outlined">info</span>
        <div>
          <strong>Source transparency:</strong> Quantitative data points are sourced from <a href="https://fred.stlouisfed.org" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">FRED (Federal Reserve Economic Data)</a> with direct series links on each chart and stat card. Qualitative analysis draws from industry reports by <a href="https://www.businessoffashion.com" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Business of Fashion</a>, <a href="https://finance.yahoo.com" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Yahoo Finance</a>, <a href="https://www.bloomberg.com" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">Bloomberg</a>, and platform reports from <a href="https://www.thredup.com/resale" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">ThredUp</a>, <a href="https://stockx.com" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">StockX</a>, and others. Individual source attributions are listed on each card below.
        </div>
      </div>

      <!-- Macro pulse cards -->
      <div class="grid grid-4">
        ${statCard('SHOERETAIL', 'storefront', 'up')}
        ${statCard('CLOTHRETAIL', 'checkroom', 'up')}
        ${statCard('FOOTWEARCPI', 'trending_up')}
        ${statCard('YOUTH1624UE', 'person_search', 'down')}
      </div>

      <!-- Qualitative insight cards -->
      <div class="grid grid-3" style="margin-top:20px">
        ${insights.map(ins => `
          <div class="card" style="border-left:3px solid ${ins.color}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span class="material-icons-outlined" style="font-size:20px;color:${ins.color}">${ins.icon}</span>
              <span style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${ins.color}">${ins.theme}</span>
            </div>
            <div style="font-size:0.95rem;font-weight:700;margin-bottom:6px;line-height:1.3">${ins.title}</div>
            <div style="font-size:0.82rem;color:var(--text-dim);line-height:1.55">${md(ins.body)}</div>
            ${ins.datapoint ? `<div style="margin-top:10px;padding:8px 12px;background:var(--bg);border-radius:8px;font-size:0.78rem;display:flex;justify-content:space-between;align-items:center">
              <span style="color:var(--text-muted)">${ins.datapoint.label}</span>
              <span style="display:flex;align-items:center;gap:8px">
                <span style="font-weight:700;color:var(--text)">${ins.datapoint.value}</span>
                ${ins.sourceKey ? `<a href="${FRED.sourceUrl(ins.sourceKey)}" target="_blank" class="source-link"><span class="material-icons-outlined">open_in_new</span>FRED</a>` : ''}
              </span>
            </div>` : ''}
            ${ins.sources ? `<div class="dd-source-row" style="margin-top:8px">${ins.sources}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <!-- Spending charts -->
      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Shoe Store Sales ($M, Monthly)', 'SHOERETAIL')}
          <div class="chart-container"><canvas id="youth-shoe-sales"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Clothing Store Sales ($M, Monthly)', 'CLOTHRETAIL')}
          <div class="chart-container"><canvas id="youth-cloth-sales"></canvas></div>
        </div>
      </div>

      <!-- Price trends -->
      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Footwear vs Apparel CPI', 'FOOTWEARCPI', 'APPARELCPI')}
          <div class="chart-container"><canvas id="youth-cpi"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Footwear Manufacturing PPI (Input Costs)', 'FOOTWEARPPI')}
          <div class="chart-container"><canvas id="youth-ppi"></canvas></div>
        </div>
      </div>

      <!-- E-commerce & credit -->
      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('E-Commerce Share of Retail (%)', 'ECOMMPCT')}
          <div class="chart-container"><canvas id="youth-ecom"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Revolving Credit & Card Balances ($B)', 'REVOLVCREDIT', 'CCBALANCE')}
          <div class="chart-container"><canvas id="youth-credit"></canvas></div>
        </div>
      </div>

      <!-- Youth employment -->
      <div class="grid grid-2" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Youth Unemployment — Teens vs Young Adults', 'YOUTH1619UE', 'YOUTH2024UE')}
          <div class="chart-container"><canvas id="youth-ue"></canvas></div>
        </div>
        <div class="card">
          ${chartHeader('Youth Employment (Thousands)', 'YOUTH1619EMP', 'YOUTH2024EMP')}
          <div class="chart-container"><canvas id="youth-emp"></canvas></div>
        </div>
      </div>

      <!-- Industry & Structural section -->
      <div class="grid grid-1" style="margin-top:20px">
        <div class="card">
          ${chartHeader('Clothing Store Employment (Thousands) — Physical Retail Footprint', 'CLOTHINGEMP')}
          <div class="chart-container"><canvas id="youth-clothemp"></canvas></div>
        </div>
      </div>

      <!-- Deep-dive qualitative section -->
      <div class="grid grid-2" style="margin-top:20px">
        <div class="card" style="padding:24px">
          <div class="card-header"><span class="card-title">Generational Spending Profile</span></div>
          ${renderGenProfile()}
          <div class="dd-source-row" style="margin-top:12px">Sources: <a href="https://www.businessoffashion.com/reports/news-analysis/the-state-of-fashion-2025-report-bof-mckinsey/" target="_blank" rel="noopener">Business of Fashion — State of Fashion</a>, <a href="https://finance.yahoo.com/topic/retail/" target="_blank" rel="noopener">Yahoo Finance — Retail</a>, <a href="https://www.bloomberg.com/markets" target="_blank" rel="noopener">Bloomberg</a></div>
        </div>
        <div class="card" style="padding:24px">
          <div class="card-header"><span class="card-title">Key Structural Trends</span></div>
          ${renderStructuralTrends()}
          <div class="dd-source-row" style="margin-top:12px">Sources: <a href="https://www.thredup.com/resale" target="_blank" rel="noopener">ThredUp — Resale Report</a>, <a href="https://www.businessoffashion.com" target="_blank" rel="noopener">Business of Fashion</a>, <a href="https://finance.yahoo.com" target="_blank" rel="noopener">Yahoo Finance</a>, <a href="https://www.bloomberg.com/markets" target="_blank" rel="noopener">Bloomberg</a></div>
        </div>
      </div>
    </div>`;

    loadYouthCharts();
  }

  function buildYouthInsights() {
    const dyi = dynamicInsights?.us_youth_insights;
    if (dyi && Array.isArray(dyi) && dyi.length >= 5) {
      return dyi.map(ins => ({
        theme: ins.theme || 'Insight',
        icon: ins.icon || 'insights',
        color: ins.color || 'var(--accent)',
        title: ins.title,
        body: ins.body,
        datapoint: ins.sourceKey && allData[ins.sourceKey] ? { label: ins.sourceKey, value: allData[ins.sourceKey].formatted } : null,
        sourceKey: ins.sourceKey || null,
        sources: null,
      }));
    }

    const cfgs = [
      ['Sneaker Culture','directions_run','var(--orange)','SHOERETAIL','Monthly Shoe Store Sales'],
      ['Fast Fashion & Deflation','checkroom','var(--cyan)','APPARELCPI','Apparel CPI Index'],
      ['Digital-First Shopping','phone_iphone','var(--accent)','ECOMMPCT','E-Commerce % of Retail'],
      ['Gen Z Spending Power','payments','var(--green)','YOUTH1624UE','16-24 Unemployment Rate'],
      ['Credit & BNPL','credit_card','var(--red)','REVOLVCREDIT','Revolving Credit'],
      ['Sustainability & Resale','recycling','var(--purple)',null,null],
      ['Athleisure Dominance','fitness_center','var(--yellow)','CLOTHRETAIL','Clothing Store Sales'],
      ['Supply Chain & Tariffs','local_shipping','#f472b6','FOOTWEARPPI','Footwear PPI'],
      ['Identity & Self-Expression','palette','var(--cyan)','UMCSENT','Consumer Sentiment'],
    ];
    return cfgs.map(([theme, icon, color, key, label]) => {
      const d = key ? allData[key] : null;
      const chg = d?.changePctFormatted ? ` (${d.changePctFormatted} from prior)` : '';
      return { theme, icon, color,
        title: `${theme}: ${d ? d.formatted + chg : 'data pending'}`,
        body: d ? `${label} at ${d.formatted}${chg}.` : 'AI-generated analysis loading...',
        datapoint: d ? { label, value: d.formatted } : null,
        sourceKey: key, sources: null };
    });
  }

  function renderGenProfile() {
    const dc = dynamicInsights?.industry_consumer?.generations;
    if (dc && Array.isArray(dc) && dc.length >= 3) {
      return dc.map(g => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:0.88rem;font-weight:700;margin-bottom:6px">${g.title}</div>
          <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.55">${md(g.body)}</div>
          ${g.tags ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${g.tags.map(t => `<span class="i-trend-tag">${t}</span>`).join('')}</div>` : ''}
        </div>
      `).join('');
    }

    const profiles = [
      { gen: 'Gen Z (12-27)', share: '~30%', traits: 'TikTok-driven discovery, resale-first mentality, brand authenticity over heritage, sneaker culture central to identity, BNPL heavy', spend: 'Footwear > Apparel, Experiences > Things (but shoes are experiences)' },
      { gen: 'Millennials (28-43)', share: '~35%', traits: 'Athleisure loyalists, DTC brand adopters, sustainability-conscious, willing to pay premium for quality, Instagram aesthetic', spend: 'Lululemon-tier athleisure, premium sneakers, workwear casualization' },
      { gen: 'Gen Alpha (<12)', share: 'Emerging', traits: 'Parent-influenced but increasingly brand-aware via YouTube/Roblox, digital fashion (skins) as gateway, early sneaker interest', spend: 'Kids footwear fastest-growing segment, brand imprinting starts at 8-10' },
    ];
    return profiles.map(p => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:0.88rem;font-weight:700">${p.gen}</span>
          <span style="font-size:0.72rem;color:var(--accent);font-weight:600">Apparel Share: ${p.share}</span>
        </div>
        <div style="font-size:0.78rem;color:var(--text-dim);margin-bottom:4px"><strong style="color:var(--text-muted)">Behaviors:</strong> ${p.traits}</div>
        <div style="font-size:0.78rem;color:var(--text-dim)"><strong style="color:var(--text-muted)">Spending:</strong> ${p.spend}</div>
      </div>
    `).join('');
  }

  function renderStructuralTrends() {
    const dit = dynamicInsights?.industry_trends;
    if (dit && Array.isArray(dit) && dit.length >= 3) {
      const structuralSlice = dit.slice(0, 6);
      return structuralSlice.map(t => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <span class="material-icons-outlined" style="font-size:18px;color:${t.color || 'var(--accent)'}">${t.icon || 'trending_up'}</span>
          <div style="flex:1">
            <div style="font-size:0.82rem;font-weight:700">${t.title}</div>
            <div style="font-size:0.75rem;color:var(--text-dim);margin-top:2px">${md(t.body)}</div>
          </div>
        </div>
      `).join('');
    }

    const trends = [
      { trend: 'Resale & Circular Economy', direction: 'up', detail: 'Secondhand apparel growing 3x faster than overall retail. StockX, Depop, and brand-owned resale (Nike Refurbished, Patagonia Worn Wear) gaining share.' },
      { trend: 'Social Commerce', direction: 'up', detail: 'TikTok Shop driving impulse apparel purchases. Discovery-to-checkout in under 60 seconds. Affiliate creator model disrupting traditional marketing.' },
      { trend: 'Physical Retail Traffic', direction: 'down', detail: 'Mall foot traffic still 15-20% below pre-pandemic for apparel. Surviving stores shift to "experience" formats (Nike House of Innovation, Kith).' },
      { trend: 'Brand Loyalty', direction: 'down', detail: 'Gen Z is brand-aware but not brand-loyal. Switching costs are near zero. Cultural relevance must be constantly renewed through collabs and drops.' },
      { trend: 'Gender-Fluid Fashion', direction: 'up', detail: 'Unisex and gender-neutral lines expanding. ~40% of Gen Z shoppers buy across traditional gender categories. Sizing and marketing adapting.' },
      { trend: 'Micro-Trend Velocity', direction: 'up', detail: 'Trend cycles compressed from seasons to weeks. "Quiet luxury," "mob wife aesthetic," "office siren" — each lasts 4-8 weeks on TikTok before rotating.' },
    ];
    return trends.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span class="material-icons-outlined" style="font-size:18px;color:${t.direction === 'up' ? 'var(--green)' : 'var(--red)'}">${t.direction === 'up' ? 'trending_up' : 'trending_down'}</span>
        <div style="flex:1">
          <div style="font-size:0.85rem;font-weight:600">${t.trend}</div>
          <div style="font-size:0.75rem;color:var(--text-dim);line-height:1.4">${t.detail}</div>
        </div>
      </div>
    `).join('');
  }

  async function loadYouthCharts() {
    const [shoeSales, clothSales, footCpi, appCpi, footPpi, ecom, revCredit, ccBal, teenUe, youngUe, teenEmp, youngEmp, clothEmp] = await Promise.all([
      FRED.getTimeSeries('SHOERETAIL', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('CLOTHRETAIL', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('FOOTWEARCPI', { startDate: yearAgo(chartRange(15)) }),
      FRED.getTimeSeries('APPARELCPI', { startDate: yearAgo(chartRange(15)) }),
      FRED.getTimeSeries('FOOTWEARPPI', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('ECOMMPCT', { startDate: yearAgo(chartRange(15)) }),
      FRED.getTimeSeries('REVOLVCREDIT', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('CCBALANCE', { startDate: yearAgo(chartRange(5)) }),
      FRED.getTimeSeries('YOUTH1619UE', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('YOUTH2024UE', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('YOUTH1619EMP', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('YOUTH2024EMP', { startDate: yearAgo(chartRange(10)) }),
      FRED.getTimeSeries('CLOTHINGEMP', { startDate: yearAgo(chartRange(15)) }),
    ]);

    Charts.createLine('youth-shoe-sales', shoeSales, { color: 'orange' });
    Charts.createLine('youth-cloth-sales', clothSales, { color: 'cyan' });

    Charts.createLine('youth-cpi', [footCpi, appCpi], {
      colors: ['orange', 'blue'],
      labels: ['Footwear CPI', 'Apparel CPI'],
      showLegend: true, noFill: true,
    });

    Charts.createLine('youth-ppi', footPpi, { color: 'red' });
    Charts.createLine('youth-ecom', ecom, { color: 'green' });

    Charts.createLine('youth-credit', [revCredit, ccBal], {
      colors: ['red', 'orange'],
      labels: ['Revolving Credit ($B)', 'CC Balances ($B)'],
      showLegend: true, noFill: true,
    });

    Charts.createLine('youth-ue', [teenUe, youngUe], {
      colors: ['red', 'orange'],
      labels: ['16-19 Unemployment %', '20-24 Unemployment %'],
      showLegend: true, noFill: true,
    });

    Charts.createLine('youth-emp', [teenEmp, youngEmp], {
      colors: ['blue', 'green'],
      labels: ['16-19 Employment', '20-24 Employment'],
      showLegend: true, noFill: true,
    });

    Charts.createLine('youth-clothemp', clothEmp, { color: 'purple' });
  }

  // ── KEY EVENTS ─────────────────────────────────────────────
  function renderEvents() {
    const calendar = Events.getEconomicCalendar();
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = calendar.filter(e => e.date >= today).slice(0, 40);
    const past = calendar.filter(e => e.date < today).slice(-15).reverse();

    const filterTypes = ['all', 'fed', 'data', 'fiscal', 'global'];

    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">event</span>Key Events &amp; Calendar</h2>
        <p>Upcoming economic releases, Fed meetings, and fiscal events</p>
      </div>
      <div class="tab-summary">Track market-moving economic data releases, FOMC meetings, Treasury auctions, and key fiscal events. High-impact events like nonfarm payrolls, CPI, and Fed rate decisions often trigger significant moves in equities, bonds, and currencies within minutes of release.</div>

      <div class="grid grid-3">
        <div class="card span-2">
          <div class="card-header">
            <span class="card-title">Upcoming Events</span>
            <div style="display:flex;gap:4px">
              ${filterTypes.map(f => `<button class="chart-range-btn ${f === 'all' ? 'active' : ''}" data-filter="${f}" onclick="filterEvents(this)">${f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}</button>`).join('')}
            </div>
          </div>
          <div class="timeline" id="events-timeline">
            ${upcoming.map(e => timelineItem(e)).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Today's Focus</span></div>
          ${renderTodayFocus(upcoming)}
          <div style="margin-top:20px">
            <div class="card-header"><span class="card-title">Recent Events</span></div>
            ${past.slice(0, 8).map(e => `
              <div style="padding:8px 0;border-bottom:1px solid var(--border)">
                <div style="font-size:0.72rem;color:var(--text-muted)">${formatDate(e.date)}</div>
                <div style="font-size:0.82rem;font-weight:600">${e.title}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderTodayFocus(upcoming) {
    const todayEvents = upcoming.filter(e => e.date === new Date().toISOString().slice(0, 10));
    const thisWeek = upcoming.filter(e => {
      const d = new Date(e.date);
      const now = new Date();
      return d >= now && d <= new Date(now.getTime() + 7 * 86400000);
    }).slice(0, 5);

    if (todayEvents.length) {
      return todayEvents.map(e => `
        <div class="news-card card" style="margin-bottom:8px;border-left-color:${typeColor(e.type)}">
          <div class="news-source">${e.tag || e.type}</div>
          <div class="news-headline">${e.title}</div>
          <div class="news-snippet">${e.desc || ''}</div>
        </div>
      `).join('');
    }
    return `<div style="margin-bottom:12px">
      <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:12px">No major releases today. This week:</p>
      ${thisWeek.map(e => `
        <div style="padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:0.72rem;color:var(--text-muted)">${formatDate(e.date)}</div>
          <div style="font-size:0.82rem;font-weight:600">${e.title}</div>
        </div>
      `).join('')}
    </div>`;
  }

  // ── Global event filter ────────────────────────────────────
  window.filterEvents = function(btn) {
    const filter = btn.dataset.filter;
    btn.parentElement.querySelectorAll('.chart-range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const items = document.querySelectorAll('#events-timeline .timeline-item');
    items.forEach(item => {
      if (filter === 'all' || item.dataset.type === filter) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  };

  // ── Helpers ────────────────────────────────────────────────
  function statCard(key, icon, goodDir) {
    const d = allData[key];
    const spec = FRED.getSpec(key);
    if (!d || !spec) return `<div class="card stat-card"><div class="card-title">${spec?.name || key}</div><div class="stat-value" style="color:var(--text-muted)">—</div></div>`;

    let badgeClass = '';
    if (goodDir && d.direction) {
      if ((goodDir === 'up' && d.direction === 'up') || (goodDir === 'down' && d.direction === 'down')) badgeClass = 'badge-green';
      else if (d.direction === 'flat') badgeClass = '';
      else badgeClass = 'badge-red';
    }

    const sparkId = `spark-${key}-${Math.random().toString(36).slice(2, 8)}`;
    const iconHtml = icon ? `<span class="material-icons-outlined" style="font-size:16px;color:var(--text-muted)">${icon}</span>` : '';

    setTimeout(async () => {
      let ts = d.raw?.slice().reverse() || [];
      if (chartRangeYears) {
        const cutoff = yearAgo(chartRangeYears);
        ts = ts.filter(p => p.date >= cutoff);
      } else {
        ts = ts.slice(-30);
      }
      if (ts.length > 2) {
        const spec2 = FRED.getSpec(key);
        const mapped = ts.map(p => {
          let v = p.value;
          if (spec2.divisor) v /= spec2.divisor;
          if (spec2.multiplier) v *= spec2.multiplier;
          return { date: p.date, value: v };
        });
        Charts.createSparkline(sparkId, mapped, {
          color: d.direction === 'up' ? (goodDir === 'up' ? 'green' : goodDir === 'down' ? 'red' : 'blue') :
                 d.direction === 'down' ? (goodDir === 'down' ? 'green' : goodDir === 'up' ? 'red' : 'blue') : 'blue',
        });
      }
    }, 100);

    return `<div class="card stat-card">
      <div class="card-header">
        ${infoTooltip(key, `${iconHtml} ${spec.name}`)}
        ${badgeClass ? `<span class="card-badge ${badgeClass}">${d.direction === 'up' ? '▲' : '▼'}</span>` : ''}
      </div>
      <div class="stat-value">${d.formatted}</div>
      <div class="stat-change ${d.direction}">
        <span class="material-icons-outlined">${d.direction === 'up' ? 'arrow_upward' : d.direction === 'down' ? 'arrow_downward' : 'remove'}</span>
        ${d.changeFormatted || ''} ${d.changePctFormatted ? `(${d.changePctFormatted})` : ''}
      </div>
      <div class="stat-period">${formatDate(d.date)}</div>
      <div class="stat-sparkline"><canvas id="${sparkId}"></canvas></div>
      <a href="${FRED.sourceUrl(key)}" target="_blank" class="source-link"><span class="material-icons-outlined">open_in_new</span>FRED: ${spec.id}</a>
    </div>`;
  }

  function yoyStatCard(key, label, goodDir) {
    const d = allData[key];
    const spec = FRED.getSpec(key);
    if (!d) return `<div class="card stat-card"><div class="card-title">${label || key}</div><div class="stat-value" style="color:var(--text-muted)">—</div></div>`;

    const val = d.value ?? d.formatted;

    return `<div class="card stat-card">
      <div class="card-header">
        ${infoTooltip(key, label)}
        ${val > 4 ? '<span class="card-badge badge-red">Hot</span>' : val > 2.5 ? '<span class="card-badge badge-yellow">Warm</span>' : '<span class="card-badge badge-green">Cool</span>'}
      </div>
      <div class="stat-value">${d.formatted}</div>
      <div class="stat-period">${formatDate(d.date)}</div>
      ${spec ? `<a href="${FRED.sourceUrl(key)}" target="_blank" class="source-link" style="margin-top:6px"><span class="material-icons-outlined">open_in_new</span>FRED: ${spec.id}</a>` : ''}
    </div>`;
  }

  function timelineItem(e) {
    return `<div class="timeline-item" data-type="${e.type}">
      <div class="timeline-dot ${e.type}"></div>
      <div class="timeline-date">${formatDate(e.date)}</div>
      <div class="timeline-title">${e.title}</div>
      ${e.desc ? `<div class="timeline-desc">${e.desc}</div>` : ''}
      ${e.tag ? `<span class="timeline-tag tag-${e.type}">${e.tag}</span>` : ''}
    </div>`;
  }

  function srcLink(key) {
    const spec = FRED.getSpec(key);
    return spec ? `<a href="${FRED.sourceUrl(key)}" target="_blank" class="source-link"><span class="material-icons-outlined">open_in_new</span>FRED: ${spec.id}</a>` : '';
  }

  const CHART_DESC = {
    SP500: 'The S&P 500 index tracks the stock performance of 500 of the largest US companies. It is the most widely followed benchmark for overall US equity market health and investor sentiment.',
    DFF: 'The effective federal funds rate is the interest rate at which banks lend reserves to each other overnight. Set by the Federal Reserve, it is the primary tool of US monetary policy and influences all other interest rates in the economy.',
    DGS10: 'The 10-year Treasury yield represents the return on US government bonds maturing in 10 years. It serves as a benchmark for mortgage rates, corporate borrowing costs, and reflects market expectations for growth and inflation.',
    DGS2: 'The 2-year Treasury yield is highly sensitive to Federal Reserve policy expectations. The gap between 2-year and 10-year yields (the yield curve) is a closely watched recession indicator.',
    DGS5: 'The 5-year Treasury yield sits in the middle of the yield curve and reflects medium-term growth and inflation expectations.',
    DGS30: 'The 30-year Treasury yield reflects very long-term expectations for inflation, growth, and the risk premium investors demand for lending to the government over three decades.',
    GDPGROWTH: 'Real GDP growth measures the annualized quarter-over-quarter change in total economic output, adjusted for inflation. It is the broadest measure of economic expansion or contraction. Two consecutive negative quarters is an informal recession signal.',
    INDPRO: 'The Industrial Production Index measures the real output of US manufacturing, mining, and utilities. It is a coincident indicator — it moves in real time with the business cycle and signals shifts in industrial activity before GDP is reported.',
    CAPACITY: 'Capacity utilization measures the percentage of productive capacity being used in manufacturing. High readings (>80%) suggest overheating and inflation pressure; low readings (<75%) signal slack and potential deflation.',
    UNRATE: 'The unemployment rate is the percentage of the labor force actively seeking but unable to find work. It is a lagging indicator — it peaks after recessions end — but remains the most politically significant economic measure.',
    PAYEMS: 'Total nonfarm payrolls count the number of paid US workers excluding farm workers, private household employees, and nonprofits. The monthly change (jobs added/lost) is the most market-moving economic release.',
    ICSA: 'Initial jobless claims count the number of people filing for unemployment insurance for the first time each week. As a high-frequency leading indicator, rising claims can signal emerging labor market weakness before the monthly jobs report.',
    JTSJOL: 'JOLTS job openings measure unfilled positions across the economy. The ratio of openings to unemployed workers gauges labor market tightness. High openings vs. low unemployment = strong bargaining power for workers.',
    CIVPART: 'The labor force participation rate measures the share of working-age population either employed or actively job-seeking. Structural declines (aging, disability, education) reduce the effective labor supply regardless of the unemployment rate.',
    CES0500000003: 'Average hourly earnings tracks wage growth for private nonfarm workers. It is a key input into the Fed\'s inflation outlook — sustained wage growth above ~3.5% can fuel persistent inflation through higher consumer spending.',
    CPIAUCSL: 'The Consumer Price Index measures the average change in prices paid by urban consumers for a basket of goods and services. It is the most widely cited inflation measure and directly affects cost-of-living adjustments for Social Security and tax brackets.',
    PCEPI: 'The Personal Consumption Expenditures price index is the Federal Reserve\'s preferred inflation gauge. Unlike CPI, PCE accounts for consumers substituting between goods and covers a broader spending base including employer-paid healthcare.',
    T5YIE: 'The 5-year breakeven inflation rate is derived from the spread between nominal and inflation-protected Treasury yields (TIPS). It represents the market\'s expectation for average annual CPI inflation over the next 5 years.',
    T10YIE: 'The 10-year breakeven inflation rate reflects the bond market\'s expectation for average annual inflation over the next decade. It is closely watched by the Fed to gauge whether long-term inflation expectations remain "anchored."',
    GASREGW: 'The average price of regular gasoline directly impacts consumer budgets and inflation expectations. Gas prices are highly visible and psychologically influential — they shape consumer sentiment disproportionately to their share of spending.',
    PPIACO: 'The Producer Price Index for all commodities measures wholesale price changes before they reach consumers. Rising PPI often leads CPI by 1-3 months, making it a leading inflation indicator for the pipeline of cost pressures.',
    T10Y2Y: 'The 10-year minus 2-year Treasury spread measures the slope of the yield curve. When negative (inverted), it signals that markets expect rate cuts due to recession. Every US recession since 1955 has been preceded by an inversion, with a 6-18 month lead time.',
    T10Y3M: 'The 10-year minus 3-month spread is the New York Fed\'s preferred yield curve measure for recession probability models. Persistent inversion here has an even stronger track record than the 10Y-2Y spread.',
    MORTGAGE30US: 'The 30-year fixed mortgage rate is the most common home loan rate in the US. It closely tracks the 10-year Treasury yield plus a credit spread. Changes of even 0.5% can significantly impact housing affordability and home sales volume.',
    WALCL: 'The Fed\'s balance sheet (total assets) reflects the cumulative effect of quantitative easing (QE) and tightening (QT). Asset purchases inject liquidity into markets; balance sheet reduction (QT) drains it. The pace of change matters as much as the level.',
    M2SL: 'M2 money supply includes cash, checking deposits, savings, money market funds, and small CDs. Rapid M2 growth historically correlates with future inflation. The post-2020 M2 surge was unprecedented and preceded the 2022-23 inflation episode.',
    HOUST: 'Housing starts count new residential construction projects begun each month (annualized). As a leading indicator, starts reflect builder confidence, demand expectations, and future housing supply. Declines often precede broader economic weakness.',
    PERMIT: 'Building permits are filed before construction begins, making them an even more forward-looking housing indicator than starts. They signal developer expectations for demand 3-6 months ahead.',
    CSUSHPISA: 'The S&P/Case-Shiller Home Price Index tracks repeat-sale prices of single-family homes across 20 major metro areas. It is the gold standard for measuring US home price appreciation and housing wealth effects on consumer spending.',
    MSACSR: 'Months\' supply of homes measures how long it would take to sell all homes on the market at the current sales pace. Below 4 months = seller\'s market (prices rising); above 6 months = buyer\'s market (prices falling).',
    UMCSENT: 'The University of Michigan Consumer Sentiment Index surveys 500 households monthly on their financial situation and economic outlook. Low readings correlate with reduced discretionary spending and can be self-fulfilling as consumers pull back.',
    RSAFS: 'Advance retail sales measures total receipts at retail and food service stores. It captures about one-third of total consumer spending and is among the first hard economic data released each month, making it highly market-moving.',
    PSAVERT: 'The personal savings rate is disposable income minus spending, as a percentage of income. Low savings (<4%) suggest consumers are stretched and vulnerable to shocks; high savings (>8%) suggests pent-up demand that could fuel future spending.',
    BOPGSTB: 'The trade balance is the difference between US exports and imports of goods and services. Persistent deficits mean the US consumes more than it produces, funded by capital inflows. Large deficits can create political pressure for tariffs.',
    DGORDER: 'Durable goods orders measure new orders for long-lasting manufactured items (aircraft, machinery, appliances). Excluding volatile transportation orders, this series reflects business investment intentions and manufacturing sector health.',
    GFDEBTN: 'Total federal debt outstanding, including debt held by the public and intragovernmental holdings. The debt-to-GDP ratio is more economically relevant than the absolute level. Rising debt service costs compete with other federal spending priorities.',
    VIXCLS: 'The CBOE Volatility Index (VIX) measures expected 30-day S&P 500 volatility derived from options prices. Known as the "fear gauge," readings above 30 indicate significant market stress; below 15 suggests complacency.',
    DTWEXBGS: 'The Broad Dollar Index measures the trade-weighted value of the US dollar against major and emerging market currencies. A strong dollar makes US exports less competitive but reduces import costs and inflation. It inversely impacts commodity prices and emerging market debt.',
    BAMLH0A0HYM2: 'The high yield (junk bond) credit spread measures the extra yield investors demand for holding riskier corporate bonds vs. Treasuries. Widening spreads signal rising default fears and tightening financial conditions; narrow spreads indicate risk appetite.',
    POPTHM: 'Total US resident population as estimated monthly by the Census Bureau. Population growth drives long-run economic growth by expanding the labor force and consumer base. The US growth rate has slowed significantly since 2000.',
    POPGROW: 'Annual population growth rate combining births, deaths, and net migration. Below 0.5% signals demographic headwinds for long-term GDP growth, tax revenue, and social insurance program sustainability.',
    FERTILITY: 'The total fertility rate estimates the average number of children a woman will have over her lifetime at current age-specific birth rates. The replacement rate is 2.1 — below this, population eventually declines without immigration.',
    BIRTHRATE: 'The crude birth rate counts live births per 1,000 people per year. Declining birth rates increase the old-age dependency ratio and create long-term fiscal challenges for Social Security and Medicare.',
    LIFEEXP: 'Life expectancy at birth estimates the average number of years a newborn would live at current mortality rates. The US saw an unprecedented decline during 2020-21 (COVID), partially recovering since.',
    INFANTMORT: 'The infant mortality rate counts deaths of children under age 1 per 1,000 live births. Despite high healthcare spending, the US rate exceeds most developed nations, reflecting disparities in access to prenatal care.',
    POP65: 'The share of population aged 65 and older. As this rises, it increases demand for healthcare, Social Security payouts, and shifts consumer spending patterns. The US is in the early stages of a multi-decade aging wave as Baby Boomers retire.',
    POP014: 'The share of population aged 0-14. A declining youth share signals future labor force contraction and reduced dynamism. It also shifts education spending needs and the composition of consumer demand.',
    WORKAGEPOP: 'The working-age population (15-64) is the potential labor supply for the economy. When it stagnates or declines, economic growth becomes more dependent on productivity gains, immigration, or increased participation rates.',
    CLF16OV: 'The civilian labor force counts everyone aged 16+ who is either employed or actively seeking work. Labor force growth, driven by population and participation, sets the ceiling for employment-driven economic expansion.',
    NETMIG: 'Net migration is the difference between people entering and leaving the country over a 5-year period. Immigration is the primary driver of US population growth and is essential for labor force replenishment in an aging society.',
    INFANTMORT: 'Infant mortality rate measures deaths under age 1 per 1,000 live births. It is a key public health indicator reflecting access to healthcare, nutrition, and socioeconomic conditions.',
    SHOERETAIL: 'Monthly sales at shoe stores (NAICS 44821). This captures dedicated footwear retailers and serves as a proxy for consumer willingness to spend on non-essential fashion items. Seasonal peaks occur in back-to-school (August) and holiday (December) periods.',
    CLOTHRETAIL: 'Monthly sales at clothing and accessories stores (NAICS 4481). This includes all apparel retailers from fast fashion to luxury. E-commerce has been steadily taking share, so declining in-store sales don\'t necessarily mean declining total apparel demand.',
    FOOTWEARCPI: 'The CPI for footwear tracks price changes for shoes purchased by urban consumers. Footwear inflation has generally exceeded overall apparel inflation due to rising input costs, brand premiums, and the "sneakerification" of casual wear.',
    APPARELCPI: 'The CPI for apparel tracks clothing price changes. Apparel has been structurally deflationary for decades due to globalized manufacturing, fast fashion, and e-commerce competition — often rising slower than headline CPI.',
    FOOTWEARPPI: 'The PPI for footwear manufacturing tracks input costs for domestic shoe production. Rising PPI signals margin pressure for brands that can\'t pass through costs, or future consumer price increases for those that can.',
    ECOMMPCT: 'E-commerce as a share of total retail sales. This secular trend accelerated during COVID and continues to climb. For apparel specifically, online penetration is even higher (~35-40%), driven by younger digital-native consumers.',
    REVOLVCREDIT: 'Total revolving consumer credit outstanding (primarily credit cards). Rising balances can signal consumer confidence or financial stress — context from delinquency rates and savings rate helps distinguish between the two.',
    CCBALANCE: 'Commercial bank credit card balances on Fed balance sheets. This high-frequency weekly series captures real-time shifts in consumer borrowing behavior and is an early warning for potential consumer stress.',
    YOUTH1619UE: 'Unemployment rate for ages 16-19. Teen unemployment is structurally higher than adult rates due to limited experience and part-time schedules. It is highly cyclical and rises sharply in recessions.',
    YOUTH2024UE: 'Unemployment rate for ages 20-24. Young adult unemployment reflects the transition from education to career. This cohort is the primary entry point into the labor force and drives much of trend-driven apparel demand.',
    YOUTH1619EMP: 'Employment level for ages 16-19 (thousands). Teen employment has been in secular decline since 2000, partly due to increased education enrollment. Summer job rates are a bellwether for youth labor market engagement.',
    YOUTH2024EMP: 'Employment level for ages 20-24 (thousands). This cohort\'s income directly feeds discretionary spending on apparel, footwear, dining, and entertainment — the categories most sensitive to this demographic.',
    CLOTHINGEMP: 'Employment at clothing and accessories stores (thousands). Secular decline reflects the shift to e-commerce, self-checkout, and leaner retail staffing models. The pace of job losses indicates the health of physical retail.',
    FEDFUNDS: 'The federal funds rate target set by the FOMC at each meeting. It is the most powerful lever in US economic policy, influencing borrowing costs for consumers and businesses across the entire economy.',
    U6RATE: 'The U-6 rate is the broadest measure of labor underutilization, including unemployed, marginally attached, and part-time-for-economic-reasons workers. It captures hidden slack the headline unemployment rate misses.',
    AWHAEPBS: 'Average weekly hours in professional and business services measures workweek length in one of the largest and highest-paying service sectors. It is a leading indicator — employers adjust hours before headcount, so declining hours often signal softening white-collar demand.',
    MSPUS: 'The median sales price of existing homes sold in the US. Unlike Case-Shiller, this is not repeat-sale adjusted, so it can be influenced by the mix of homes selling (e.g., more luxury vs starter homes).',
    PCE: 'Personal consumption expenditures represent total consumer spending on goods and services. PCE is the largest component of GDP (~68%) and the single most important driver of US economic growth.',
    DSPIC96: 'Real disposable personal income is income after taxes, adjusted for inflation. It measures the actual purchasing power available to consumers and is the fundamental constraint on sustainable spending growth.',
    CPIYOY: 'CPI year-over-year change measures the annual rate of consumer price inflation. The Fed targets 2% (using PCE). Readings above 3% typically trigger hawkish policy; below 2% raises deflation concerns.',
    PCEYOY: 'PCE year-over-year change is the Fed\'s officially preferred inflation measure. It tends to run 0.3-0.5% below CPI due to broader coverage and substitution effects. The 2% target is defined in PCE terms.',
    YOUTH1624UE: 'Combined youth unemployment rate for ages 16-24. This cohort is the core demographic for trend-driven apparel and sneaker spending. Their employment status directly impacts discretionary fashion demand.',
  };

  function dynamicDesc(key) {
    const d = allData[key];
    if (!d) return '';
    const v = d.value, dir = d.direction, fmt = d.formatted;
    const chg = d.changePctFormatted ? ` (${d.changePctFormatted} from prior)` : '';

    const rules = {
      GDPGROWTH: () => v > 3 ? `At ${fmt}, growth is running hot — above the ~2% long-run trend. This pace typically invites Fed tightening to prevent overheating.` : v > 1.5 ? `At ${fmt}, growth is moderate and near the long-run sustainable pace of ~2%. This is a Goldilocks zone the Fed prefers.` : v > 0 ? `At ${fmt}, growth is below trend, suggesting the economy is losing momentum. Watch for deterioration in hiring and investment.` : `At ${fmt}, the economy is contracting. If sustained for two quarters, this meets the informal definition of recession.`,
      SP500: () => dir === 'up' ? `At ${fmt}${chg}, equities are advancing — reflecting optimism about earnings, growth, or policy easing.` : dir === 'down' ? `At ${fmt}${chg}, equities are retreating — possibly pricing in tighter policy, weaker earnings, or rising recession risk.` : `At ${fmt}, equities are holding steady.`,
      DFF: () => v >= 5 ? `At ${fmt}, the Fed Funds rate is restrictive — well above the estimated neutral rate of ~2.5-3%. Monetary policy is actively slowing the economy and fighting inflation.` : v >= 3 ? `At ${fmt}, the Fed Funds rate is moderately tight, above neutral. Borrowing costs are elevated but not at crisis levels.` : v >= 1 ? `At ${fmt}, the rate is accommodative but not at zero. The Fed has room to cut further if needed.` : `At ${fmt}, rates are near zero — the Fed is in full stimulus mode, typically seen during recessions or crises.`,
      DGS10: () => v > 4.5 ? `At ${fmt}, the 10Y yield is elevated, pushing mortgage rates higher and increasing government borrowing costs. This level typically weighs on housing and rate-sensitive sectors.` : v > 3 ? `At ${fmt}, yields reflect normalized monetary conditions with moderate growth and inflation expectations.` : `At ${fmt}, yields are historically low, suggesting markets expect weak growth, low inflation, or safe-haven demand.`,
      DGS2: () => { const spread = allData.T10Y2Y; return `At ${fmt}${chg}. ${spread && spread.value < 0 ? 'The 2Y exceeds the 10Y (inverted curve), signaling markets expect rate cuts ahead due to anticipated economic weakness.' : 'The 2Y is below the 10Y, consistent with a normal upward-sloping yield curve.'}`; },
      DGS5: () => `At ${fmt}${chg}. The 5Y yield reflects medium-term expectations midway between short-term policy rates and long-term growth assumptions.`,
      DGS30: () => `At ${fmt}${chg}. ${v > 5 ? 'Long-term rates this high significantly raise the cost of long-duration debt — mortgages, infrastructure, and corporate bonds.' : 'Long-term borrowing costs remain manageable at current levels.'}`,
      UNRATE: () => v < 4 ? `At ${fmt}, unemployment is historically low — the labor market is very tight. Workers have strong bargaining power, which supports wage growth but can fuel inflation.` : v < 5.5 ? `At ${fmt}, unemployment is near the Fed\'s estimate of full employment (~4-4.5%). The labor market is balanced.` : v < 7 ? `At ${fmt}, unemployment is elevated, indicating significant labor market slack. This typically puts downward pressure on wages and inflation.` : `At ${fmt}, unemployment is at recessionary levels, indicating severe economic distress.`,
      PAYEMS: () => dir === 'up' ? `At ${fmt}${chg}, payrolls are expanding. The economy is adding jobs, supporting consumer spending and tax revenue.` : `At ${fmt}${chg}, job growth is slowing or contracting — a warning sign for the broader economy.`,
      ICSA: () => v < 225000 ? `At ${fmt}, claims are historically low — very few workers are being laid off, indicating exceptional labor market stability.` : v < 300000 ? `At ${fmt}, claims are in a healthy range consistent with normal labor market churn and low layoff rates.` : v < 400000 ? `At ${fmt}, claims are elevated and rising — this level historically marks the transition from a tight to a weakening labor market.` : `At ${fmt}, claims are at recessionary levels, indicating widespread layoffs across the economy.`,
      JTSJOL: () => { const ue = allData.UNRATE; const ratio = ue ? (v / (ue.value / 100 * 160000000 / 1000000)).toFixed(1) : null; return `At ${fmt}${chg}. ${ratio ? `There are roughly ${ratio} job openings per unemployed worker. ${ratio > 1.5 ? 'This extremely tight ratio gives workers strong leverage to demand higher pay.' : ratio > 1 ? 'More openings than unemployed workers — a tight but normalizing market.' : 'Fewer openings than unemployed — the labor market has shifted in employers\' favor.'}` : ''}`; },
      CIVPART: () => v < 62.5 ? `At ${fmt}, participation is below pre-pandemic levels (~63.3%). Roughly ${((63.3 - v) / 100 * 260).toFixed(1)}M fewer working-age adults are in the labor force, constraining the supply of workers.` : v < 63 ? `At ${fmt}, participation is recovering toward pre-pandemic norms but hasn\'t fully closed the gap.` : `At ${fmt}, participation is near or above pre-pandemic levels — the labor supply has largely normalized.`,
      CES0500000003: () => dir === 'up' ? `At ${fmt}${chg}, wages are rising. ${v > 4 ? 'Wage growth above 4% — well above the ~3.5% pace consistent with 2% inflation. This signals persistent inflationary pressure from the labor market.' : 'The pace is moderating toward levels the Fed considers sustainable.'}` : `At ${fmt}${chg}, wage growth is decelerating, easing pressure on the Fed to keep rates elevated.`,
      CPIAUCSL: () => `The CPI index level is ${fmt}. The year-over-year change and monthly rate of increase matter more than the index level itself — they show whether inflation is accelerating or decelerating.`,
      PCEPI: () => `The PCE index level is ${fmt}. As the Fed\'s preferred measure, the year-over-year rate of change (not the level) drives monetary policy decisions.`,
      CPIYOY: () => v > 4 ? `At ${fmt}, CPI inflation is running well above the 2% target — keeping the Fed in inflation-fighting mode with restricted monetary policy.` : v > 2.5 ? `At ${fmt}, inflation is above target but moderating. The Fed is watching for sustained deceleration before easing.` : v > 1.5 ? `At ${fmt}, inflation is near the 2% target zone — consistent with price stability and potential policy easing.` : `At ${fmt}, inflation is unusually low, raising deflation concerns that could prompt aggressive Fed stimulus.`,
      PCEYOY: () => v > 3.5 ? `At ${fmt}, PCE inflation remains well above the 2% target. The Fed will likely maintain restrictive policy until this sustainably declines.` : v > 2.2 ? `At ${fmt}, PCE is above target but trending in the right direction. The "last mile" of disinflation is proving sticky.` : `At ${fmt}, PCE is at or near the 2% target — the green light for the Fed to normalize policy.`,
      T5YIE: () => v > 2.5 ? `At ${fmt}, markets expect inflation to average above the Fed\'s target over 5 years — suggesting skepticism that the Fed will fully tame price pressures.` : v > 1.8 ? `At ${fmt}, inflation expectations are well-anchored near the 2% target — a sign the Fed retains credibility.` : `At ${fmt}, breakevens signal markets see very low inflation ahead — possibly reflecting recession fears or deflation risk.`,
      T10YIE: () => v > 2.5 ? `At ${fmt}, long-term inflation expectations are drifting above the Fed\'s comfort zone. This could force prolonged tightening.` : `At ${fmt}, long-term inflation expectations remain anchored, giving the Fed flexibility on policy timing.`,
      GASREGW: () => v > 4 ? `At $${v.toFixed(2)}/gallon, gas prices are high enough to meaningfully impact consumer budgets and sentiment. This acts as a regressive tax, hitting lower-income households hardest.` : v > 3 ? `At $${v.toFixed(2)}/gallon, prices are moderate — noticeable but not a major drag on spending.` : `At $${v.toFixed(2)}/gallon, low gas prices are a tailwind for consumers, freeing up discretionary income.`,
      PPIACO: () => dir === 'up' ? `At ${fmt}${chg}, producer prices are rising — pipeline inflation pressure that may flow to consumer prices in 1-3 months.` : `At ${fmt}${chg}, producer prices are easing, suggesting future consumer inflation relief.`,
      T10Y2Y: () => v < -0.5 ? `At ${fmt}, the yield curve is deeply inverted. Every US recession since 1955 has been preceded by inversion. The typical lead time is 6-18 months from first inversion.` : v < 0 ? `At ${fmt}, the curve is inverted — a recession warning, though the timing is uncertain. The un-inversion (steepening) often occurs just before the recession starts.` : v < 0.5 ? `At ${fmt}, the curve is slightly positive but flat. This often occurs during transitions — either normalizing from inversion or flattening toward one.` : `At ${fmt}, the curve is positively sloped and in a normal configuration, typically associated with economic expansion.`,
      T10Y3M: () => v < 0 ? `At ${fmt}, this spread is inverted — the NY Fed\'s recession probability model, built on this spread, is likely showing elevated risk.` : `At ${fmt}, this spread is positive, consistent with low recession probability in the NY Fed\'s model.`,
      MORTGAGE30US: () => v > 7 ? `At ${fmt}, mortgage rates are at two-decade highs, severely constraining affordability. A buyer purchasing the median home pays roughly $${Math.round(v/100*400000/12)} more per month vs. 3% rates.` : v > 6 ? `At ${fmt}, rates are elevated and weighing on home sales volume and refinancing activity.` : v > 4 ? `At ${fmt}, rates are moderate — historically normal but above the post-2008 era of ultra-low rates.` : `At ${fmt}, mortgage rates are historically low, strongly stimulating housing demand and refinancing.`,
      WALCL: () => dir === 'down' ? `At ${fmt}${chg}, the Fed is actively shrinking its balance sheet (quantitative tightening), draining liquidity from the financial system.` : `At ${fmt}${chg}, balance sheet reduction has paused or reversed. This supports market liquidity.`,
      M2SL: () => dir === 'up' ? `At ${fmt}${chg}, M2 is expanding — historically correlated with future nominal GDP growth and, if excessive, inflation.` : dir === 'down' ? `At ${fmt}${chg}, M2 is contracting — extremely rare and historically associated with deflationary pressure and financial stress.` : `At ${fmt}, M2 growth is flat, consistent with stable monetary conditions.`,
      HOUST: () => v > 1500 ? `At ${fmt}, starts are strong — builders are confident in demand, and new supply is being added at a healthy pace.` : v > 1000 ? `At ${fmt}, starts are moderate, roughly matching demographic-driven demand for new homes.` : `At ${fmt}, starts are weak — reflecting poor builder confidence, high rates, or constrained demand.`,
      PERMIT: () => dir === 'up' ? `At ${fmt}${chg}, permits are rising — developers see enough demand to justify new projects 3-6 months out.` : `At ${fmt}${chg}, permits are declining — forward-looking weakness in the construction pipeline.`,
      CSUSHPISA: () => dir === 'up' ? `At ${fmt}${chg}, home prices continue to appreciate. Rising home values boost household wealth (the "wealth effect") and consumer confidence.` : `At ${fmt}${chg}, home prices are declining, reducing household wealth and potentially trapping recent buyers underwater.`,
      MSACSR: () => v < 4 ? `At ${fmt} months, inventory is very low — a seller\'s market with strong upward pressure on prices. Buyers face intense competition.` : v < 6 ? `At ${fmt} months, the market is roughly balanced between buyers and sellers, with moderate price appreciation.` : `At ${fmt} months, inventory is high — a buyer\'s market. Prices are likely stagnating or declining as sellers compete for fewer buyers.`,
      UMCSENT: () => v < 60 ? `At ${fmt}, sentiment is deeply pessimistic — historically associated with recession-level consumer anxiety and spending pullbacks.` : v < 80 ? `At ${fmt}, sentiment is below the long-run average (~85). Consumers are uneasy but still spending cautiously.` : v < 100 ? `At ${fmt}, sentiment is healthy and consistent with solid consumer spending growth.` : `At ${fmt}, sentiment is very high — consumers feel confident about their finances and the economy.`,
      RSAFS: () => dir === 'up' ? `At ${fmt}${chg}, retail sales are growing — consumers continue to spend, supporting GDP growth.` : `At ${fmt}${chg}, retail sales are weakening, signaling consumers may be pulling back due to financial stress or uncertainty.`,
      PSAVERT: () => v < 4 ? `At ${fmt}, the savings rate is historically low — consumers are spending nearly all their income, leaving little cushion against income shocks.` : v < 8 ? `At ${fmt}, the savings rate is in a normal range, providing a modest buffer for consumers.` : `At ${fmt}, savings are elevated — pent-up demand could fuel future spending when confidence improves.`,
      BOPGSTB: () => v < -70 ? `At ${fmt}, the trade deficit is very large, meaning the US is importing far more than it exports. This is funded by foreign capital inflows and creates political pressure for trade restrictions.` : v < 0 ? `At ${fmt}, the deficit is moderate by recent standards.` : `At ${fmt}, the US is running a rare trade surplus.`,
      DGORDER: () => dir === 'up' ? `At ${fmt}${chg}, durable goods orders are rising — businesses are investing in equipment and capacity, a bullish sign for future growth.` : `At ${fmt}${chg}, orders are declining — businesses are pulling back on investment, a leading indicator of weakening activity.`,
      GFDEBTN: () => `At ${fmt}, federal debt continues to grow. The debt-to-GDP ratio and the cost of servicing this debt (interest payments as a share of revenue) are the economically meaningful metrics to watch.`,
      VIXCLS: () => v > 30 ? `At ${fmt}, the VIX is in "fear" territory — markets are pricing in extreme uncertainty. Historically, levels above 30 occur during crises, sharp selloffs, or major geopolitical events.` : v > 20 ? `At ${fmt}, volatility is moderately elevated — markets are cautious but not panicking.` : v > 15 ? `At ${fmt}, volatility is in a normal range, consistent with steady market conditions.` : `At ${fmt}, the VIX is unusually low — markets may be complacent. Historically, extended periods of very low VIX often precede sharp corrections.`,
      DTWEXBGS: () => dir === 'up' ? `At ${fmt}${chg}, the dollar is strengthening — making US exports less competitive but reducing import costs. A strong dollar also tightens financial conditions globally.` : `At ${fmt}${chg}, the dollar is weakening — boosting export competitiveness but raising import costs and potentially adding to inflation.`,
      BAMLH0A0HYM2: () => v > 500 ? `At ${fmt} basis points, credit spreads are wide — markets see elevated default risk, and borrowing costs for lower-rated companies are stressed.` : v > 350 ? `At ${fmt} basis points, spreads are moderately elevated, suggesting some caution about credit quality.` : `At ${fmt} basis points, spreads are tight — markets are confident in corporate credit quality and willing to take risk.`,
      POPTHM: () => `At ${fmt}, the US population is growing slowly. The rate of growth matters more than the level — it determines future labor force expansion, consumer market growth, and tax base sustainability.`,
      POPGROW: () => v < 0.5 ? `At ${fmt}, population growth is below the threshold needed to sustain GDP growth without major productivity gains. Immigration policy is the key lever.` : `At ${fmt}, population growth is moderate, supporting long-run economic expansion.`,
      FERTILITY: () => v < 1.7 ? `At ${fmt}, the fertility rate is well below the 2.1 replacement level. Without immigration, the US population would begin declining within a generation.` : v < 2.1 ? `At ${fmt}, fertility is below replacement but close enough that moderate immigration offsets the gap.` : `At ${fmt}, fertility is at or above replacement level.`,
      BIRTHRATE: () => dir === 'down' ? `At ${fmt}${chg}, the birth rate continues its long-term decline, driven by delayed family formation, higher education enrollment, and rising childcare costs.` : `At ${fmt}${chg}, the birth rate is stabilizing or recovering.`,
      LIFEEXP: () => v < 78 ? `At ${fmt} years, US life expectancy is below pre-pandemic levels and lags most peer nations. Opioids, chronic disease, and healthcare access disparities are key factors.` : `At ${fmt} years, life expectancy is near or above pre-pandemic norms.`,
      INFANTMORT: () => `At ${fmt}, the US infant mortality rate remains higher than most OECD nations, reflecting persistent disparities in prenatal care access, income, and social determinants of health.`,
      POP65: () => v > 17 ? `At ${fmt}%, the 65+ share is historically high and rising as Baby Boomers age. This drives up Social Security and Medicare costs and shifts spending toward healthcare and services.` : `At ${fmt}%, the aging trend is well underway and accelerating.`,
      POP014: () => dir === 'down' ? `At ${fmt}%, the youth share continues to shrink — meaning fewer future workers and consumers entering the economy, increasing dependence on immigration for growth.` : `At ${fmt}%, the youth share is holding steady.`,
      WORKAGEPOP: () => dir === 'up' ? `At ${fmt}${chg}, the working-age population is still growing, supporting potential labor force expansion.` : `At ${fmt}${chg}, the working-age population is stagnating or declining — a structural headwind for growth.`,
      CLF16OV: () => dir === 'up' ? `At ${fmt}${chg}, the labor force is expanding — more people are available to work, which supports growth without necessarily adding to inflation.` : `At ${fmt}${chg}, the labor force is shrinking, tightening the supply of available workers.`,
      NETMIG: () => `At ${fmt}, immigration remains the dominant source of US population growth, critical for filling labor shortages in sectors from agriculture to technology.`,
      SHOERETAIL: () => dir === 'up' ? `At ${fmt}${chg}, shoe store sales are growing — consumers are spending on footwear, with the athletic/casual segment driving most demand among younger buyers.` : `At ${fmt}${chg}, shoe store sales are softening, though some spending may have shifted to e-commerce channels.`,
      CLOTHRETAIL: () => dir === 'up' ? `At ${fmt}${chg}, clothing store sales are rising. Notably, this only captures in-store — total apparel spending including online is likely higher.` : `At ${fmt}${chg}, in-store clothing sales are declining, likely reflecting continued migration to online channels.`,
      FOOTWEARCPI: () => dir === 'up' ? `At ${fmt}${chg}, footwear prices are rising — input costs and brand premiums are being passed through to consumers.` : `At ${fmt}${chg}, footwear prices are easing, potentially reflecting promotional activity or supply normalization.`,
      APPARELCPI: () => dir === 'up' ? `At ${fmt}${chg}, apparel prices are rising — unusual given the sector\'s deflationary trend from globalized manufacturing and fast fashion.` : `At ${fmt}${chg}, apparel prices are declining, consistent with the long-run deflationary trend in clothing.`,
      FOOTWEARPPI: () => dir === 'up' ? `At ${fmt}${chg}, footwear production costs are rising. Brands will either absorb margin pressure or pass costs to consumers.` : `At ${fmt}${chg}, input costs are easing — margin relief for manufacturers and potentially lower retail prices ahead.`,
      ECOMMPCT: () => `At ${fmt}, e-commerce continues to take share from physical retail. For apparel among under-30 consumers, online penetration is likely 40%+.`,
      REVOLVCREDIT: () => dir === 'up' ? `At ${fmt}${chg}, revolving credit is expanding — consumers are borrowing more, which boosts spending short-term but raises delinquency risk if sustained.` : `At ${fmt}${chg}, credit growth is moderating or contracting, suggesting consumers are deleveraging or lenders are tightening.`,
      CCBALANCE: () => dir === 'up' ? `At ${fmt}${chg}, credit card balances are rising — watch delinquency rates to determine if this reflects confidence or financial stress.` : `At ${fmt}${chg}, card balances are declining, suggesting consumers are paying down debt.`,
      YOUTH1619UE: () => v > 15 ? `At ${fmt}, teen unemployment is elevated. This limits discretionary spending power for the youngest consumers and may reflect broader labor market softening.` : `At ${fmt}, teen unemployment is relatively low, supporting part-time income and spending.`,
      YOUTH2024UE: () => v > 8 ? `At ${fmt}, young adult unemployment is above average, potentially constraining the spending power of the key fashion and lifestyle demographic.` : `At ${fmt}, young adult employment is healthy — supporting discretionary spending on apparel and entertainment.`,
      YOUTH1619EMP: () => `At ${fmt}${chg}. Teen employment drives pocket money for trend purchases and first fashion brand affinities.`,
      YOUTH2024EMP: () => `At ${fmt}${chg}. This cohort\'s earnings are the primary fuel for discretionary apparel, footwear, dining, and entertainment spending.`,
      CLOTHINGEMP: () => dir === 'down' ? `At ${fmt}${chg}, clothing store employment continues to decline as e-commerce and automation reshape retail staffing.` : `At ${fmt}${chg}, employment is stabilizing, suggesting the physical retail channel has found a floor.`,
      YOUTH1624UE: () => v < 9 ? `At ${fmt}, youth unemployment is healthy — supporting strong discretionary spending among the prime fashion demographic.` : `At ${fmt}, youth unemployment is elevated, which may constrain apparel and lifestyle spending for the key 16-24 cohort.`,
      U6RATE: () => v > 8 ? `At ${fmt}, broad underemployment is elevated — many workers are underemployed or have given up looking, masking true labor market weakness.` : `At ${fmt}, even the broadest measure of underemployment is contained.`,
      AWHAEPBS: () => v < 36 ? `At ${fmt} hours, the professional & business services workweek is below average, a leading indicator of softening white-collar labor demand.` : `At ${fmt} hours, the workweek is healthy, suggesting steady demand for professional and business services.`,
      MSPUS: () => dir === 'up' ? `At ${fmt}${chg}, median home prices are rising, boosting existing homeowner wealth but worsening affordability for first-time buyers.` : `At ${fmt}${chg}, prices are easing — improving affordability but reducing home equity for existing owners.`,
      PCE: () => dir === 'up' ? `At ${fmt}${chg}, consumer spending is growing — the engine that drives ~68% of GDP.` : `At ${fmt}${chg}, consumer spending is weakening, which directly threatens GDP growth given its dominant share.`,
      DSPIC96: () => dir === 'up' ? `At ${fmt}${chg}, real income is rising — consumers have more purchasing power, which sustainably supports spending growth.` : `At ${fmt}${chg}, real income is stagnant or declining — any continued spending is being financed by savings drawdown or credit.`,
      CAPACITY: () => v > 80 ? `At ${fmt}, capacity is stretched tight — factories are running near full output, limiting ability to ramp up production without inflation pressure.` : v > 75 ? `At ${fmt}, capacity utilization is in a normal band — enough room to expand without bottlenecks.` : `At ${fmt}, significant idle capacity exists — the economy could grow meaningfully without creating inflation.`,
      INDPRO: () => dir === 'up' ? `At ${fmt}${chg}, industrial production is expanding — manufacturing, mining, and utilities are all contributing to growth.` : `At ${fmt}${chg}, industrial output is contracting, signaling weakness in the goods-producing sectors.`,
    };

    const fn = rules[key];
    return fn ? fn() : '';
  }

  function infoTooltip(key, title) {
    const staticDesc = CHART_DESC[key] || '';
    const dynDesc = dynamicDesc(key);
    const body = [staticDesc, dynDesc].filter(Boolean).join('<br><br><strong style="color:var(--text);font-size:0.8rem">Current reading:</strong><br>');
    if (!body) return `<span class="card-title">${title}</span>`;
    return `<span class="title-with-info"><span class="card-title">${title}</span><span class="info-icon">i</span><span class="info-tooltip">${body}</span></span>`;
  }

  function chartHeader(title, ...keys) {
    const links = keys.map(k => srcLink(k)).filter(Boolean).join(' &nbsp; ');
    return `<div class="card-header">${infoTooltip(keys[0], title)}</div>${links ? `<div class="chart-source">${links}</div>` : ''}`;
  }

  function tabSummary(tab) {
    const d = allData;
    const summaries = {
      overview: () => {
        const gdp = d.GDPGROWTH, ue = d.UNRATE, ff = d.DFF, sp = d.SP500;
        return `The US economy is growing at ${gdp?.formatted || '—'} (real GDP), with unemployment at ${ue?.formatted || '—'}. The Fed Funds rate sits at ${ff?.formatted || '—'}, and the S&P 500 is at ${sp?.formatted || '—'}. ${d.T10Y2Y && d.T10Y2Y.value < 0 ? 'The yield curve remains inverted, historically a recession warning signal.' : 'The yield curve is positive, suggesting normal market conditions.'} ${d.VIXCLS && d.VIXCLS.value > 25 ? 'Elevated VIX indicates heightened market uncertainty.' : 'Volatility is contained, reflecting relative market calm.'}`;
      },
      growth: () => {
        const gdp = d.GDPGROWTH, ind = d.INDPRO, cap = d.CAPACITY;
        const strength = gdp && gdp.value > 2.5 ? 'above-trend' : gdp && gdp.value > 0 ? 'moderate' : 'contractionary';
        return `Growth is ${strength} at ${gdp?.formatted || '—'} annualized. Industrial production stands at ${ind?.formatted || '—'} and capacity utilization at ${cap?.formatted || '—'}. ${cap && cap.value > 80 ? 'High capacity utilization suggests potential supply bottlenecks and inflationary pressure.' : cap && cap.value < 75 ? 'Low capacity utilization signals meaningful economic slack and room for expansion without inflation.' : 'Capacity utilization is in a normal range, consistent with steady but not overheating growth.'}`;
      },
      labor: () => {
        const ue = d.UNRATE, pay = d.PAYEMS, claims = d.ICSA, part = d.CIVPART;
        return `The labor market shows an unemployment rate of ${ue?.formatted || '—'} with ${claims?.formatted || '—'} weekly initial claims. ${ue && ue.direction === 'down' ? 'The tightening labor market is strengthening worker bargaining power and wage growth.' : ue && ue.direction === 'up' ? 'Rising unemployment suggests the labor market is softening, which may ease wage-driven inflation pressure.' : 'Employment conditions are stable.'} Labor force participation is ${part?.formatted || '—'}, ${part && part.value < 62.5 ? 'still below pre-pandemic levels, constraining the effective labor supply.' : 'near pre-pandemic levels, supporting broader economic capacity.'}`;
      },
      inflation: () => {
        const cpi = d.CPIYOY, gas = d.GASREGW, be5 = d.T5YIE;
        return `Consumer inflation is running at ${cpi?.formatted || '—'} year-over-year (CPI). ${cpi && cpi.value > 3.5 ? 'Inflation remains well above the Fed\'s 2% target, keeping monetary policy restrictive.' : cpi && cpi.value > 2.2 ? 'Inflation is moderating but has not yet sustainably reached the Fed\'s 2% target.' : 'Inflation is near the Fed\'s 2% target, opening the door for potential rate cuts.'} Regular gasoline is ${gas?.formatted || '—'}, and 5-year breakeven inflation expectations sit at ${be5?.formatted || '—'}, ${be5 && be5.value > 2.5 ? 'suggesting markets see persistent price pressure ahead.' : 'indicating the market views inflation as contained going forward.'}`;
      },
      rates: () => {
        const ff = d.DFF, t10 = d.DGS10, mort = d.MORTGAGE30US, spread = d.T10Y2Y, bal = d.WALCL;
        return `The Fed Funds rate is ${ff?.formatted || '—'} with the 10-year Treasury at ${t10?.formatted || '—'} and 30-year mortgage rates at ${mort?.formatted || '—'}. The 10Y-2Y spread is ${spread?.formatted || '—'}${spread && spread.value < 0 ? ' (inverted — recession watch)' : ''}. ${bal ? 'The Fed balance sheet stands at ' + bal.formatted + ', ' + (bal.direction === 'down' ? 'with ongoing quantitative tightening reducing liquidity.' : 'with balance sheet reduction paused or slowing.') : ''}`;
      },
      housing: () => {
        const starts = d.HOUST, cs = d.CSUSHPISA, mort = d.MORTGAGE30US, supply = d.MSACSR;
        return `Housing starts are at ${starts?.formatted || '—'} (annualized) with the Case-Shiller home price index at ${cs?.formatted || '—'}. ${mort ? 'Mortgage rates at ' + mort.formatted + (mort.value > 7 ? ' continue to severely constrain affordability and transaction volumes.' : mort.value > 6 ? ' are weighing on buyer demand.' : ' are easing, potentially stimulating activity.') : ''} Months\' supply is ${supply?.formatted || '—'}, ${supply && supply.value < 4 ? 'indicating a tight seller\'s market with upward price pressure.' : supply && supply.value > 6 ? 'suggesting inventory is building and favoring buyers.' : 'pointing to a balanced market.'}`;
      },
      consumer: () => {
        const sent = d.UMCSENT, ret = d.RSAFS, sav = d.PSAVERT, trade = d.BOPGSTB;
        return `Consumer sentiment is at ${sent?.formatted || '—'}, ${sent && sent.value < 60 ? 'deeply pessimistic — historically associated with spending pullbacks' : sent && sent.value < 80 ? 'below average, reflecting economic unease' : 'healthy, supporting spending growth'}. Retail sales are ${ret?.formatted || '—'} and the personal savings rate is ${sav?.formatted || '—'}${sav && sav.value < 4 ? ' — historically low, leaving consumers vulnerable to income shocks' : ''}. The trade balance is ${trade?.formatted || '—'}.`;
      },
      markets: () => {
        const sp = d.SP500, vix = d.VIXCLS, usd = d.DTWEXBGS, hy = d.BAMLH0A0HYM2;
        return `The S&P 500 is at ${sp?.formatted || '—'}${sp && sp.direction === 'up' ? ' and trending higher' : sp && sp.direction === 'down' ? ' under pressure' : ''}. The VIX is at ${vix?.formatted || '—'}, ${vix && vix.value > 25 ? 'indicating elevated fear and hedging demand.' : vix && vix.value < 15 ? 'reflecting unusual calm and potential complacency.' : 'within a normal range.'} The US dollar index is ${usd?.formatted || '—'} and high-yield credit spreads are at ${hy?.formatted || '—'}${hy && hy.value > 500 ? ' — elevated, signaling credit market stress.' : ' — contained, reflecting manageable default expectations.'}`;
      },
      population: () => {
        const pop = d.POPTHM, grow = d.POPGROW, fert = d.FERTILITY, p65 = d.POP65, life = d.LIFEEXP;
        return `The US population stands at ${pop?.formatted || '—'} with an annual growth rate of ${grow?.formatted || '—'}. The fertility rate is ${fert?.formatted || '—'}, ${fert && fert.value < 1.7 ? 'well below the 2.1 replacement level — immigration is essential for population maintenance.' : 'near replacement level.'} Life expectancy is ${life?.formatted || '—'} years and the 65+ share is ${p65?.formatted || '—'}%, ${p65 && p65.value > 17 ? 'reflecting an aging society with growing pressure on entitlement programs and healthcare.' : 'trending higher as Baby Boomers retire.'}`;
      },
      youth: () => {
        const shoe = d.SHOERETAIL, cloth = d.CLOTHRETAIL, yue = d.YOUTH1624UE, ecom = d.ECOMMPCT, credit = d.REVOLVCREDIT;
        return `Shoe store sales are ${shoe?.formatted || '—'} and clothing store sales are ${cloth?.formatted || '—'}. Youth (16-24) unemployment sits at ${yue?.formatted || '—'}, ${yue && yue.value < 9 ? 'providing solid discretionary spending power for younger consumers.' : 'potentially constraining apparel budgets for the key demographic.'} E-commerce now represents ${ecom?.formatted || '—'} of all retail — for apparel among under-30 consumers, it\'s likely 40%+. Revolving credit at ${credit?.formatted || '—'} ${credit && credit.direction === 'up' ? 'continues to climb, with BNPL accelerating fashion spending but raising delinquency concerns.' : 'signals consumer borrowing is stabilizing.'}`;
      },
    };
    const fn = summaries[tab];
    return fn ? `<div class="tab-summary">${fn()}</div>` : '';
  }

  // ── Daily Read generators ─────────────────────────────────
  function drVal(key) { const d = allData[key]; return d ? `<span class="dr-val">${d.formatted}</span>` : '—'; }
  function drDir(key) { const d = allData[key]; return d?.direction === 'up' ? '<span class="dr-up">▲ rising</span>' : d?.direction === 'down' ? '<span class="dr-down">▼ falling</span>' : '<span class="dr-muted">flat</span>'; }
  function drDate() { return fmtToday(); }

  function md(s) {
    if (!s) return '';
    if (typeof s === 'object') s = Object.values(s).filter(v => typeof v === 'string').join('\n\n');
    if (typeof s !== 'string') return '';
    s = s.replace(/^[\s.•·–—]+/, '');
    s = s.replace(/^#+\s+.+?\n/, '');
    s = s.replace(/^\*\*[A-Z][^*]{1,40}:\*\*\s*/i, '');
    s = s.replace(/^[A-Z][A-Za-z &\-/]{1,30}:\s*/m, '');
    s = s.replace(/^(<span class='dr-(up|down|flat)'>.[^<]*<\/span>)\s*/i, '');
    s = s.replace(/^[●]\s*/, '');
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
      .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/<br><br>/g, '<br>')
      .replace(/\n\n/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/([▲▼])\s*([+\-]?\$?[\d,.]+[BMKTbmkt]*%?(?:\/[a-z]+)?(?:\s+(?:month-over-month|year-over-year|quarter-over-quarter|year-on-year|MoM|YoY|QoQ|pp|CAGR|jobs|units|bps|basis\s+points|percentage\s+points|billion|million|trillion|increase|decrease|decline|drop|gain|rise|growth|fall|surge|dip|rebound|recovery|expansion|contraction|higher|lower))*)/gi, (m, arrow, rest) => {
        const t = rest.trim();
        const isChange = /%/.test(t)
          || /\b(month-over|year-over|year-on|MoM|YoY|QoQ|pp|CAGR|bps|basis\s*points|percentage\s*points)\b/i.test(t)
          || /\b(increase|decrease|decline|drop|gain|rise|growth|fall|surge|dip|rebound|recovery|expansion|contraction|higher|lower)\b/i.test(t)
          || /\b(jobs)\b/i.test(t)
          || /^[+\-]/.test(t);
        if (!isChange) return m;
        return `<span class="${arrow === '▲' ? 'trend-up' : 'trend-down'}">${arrow} ${t}</span>`;
      })
      .replace(/▲(?![^<]*<\/span>)/g, '')
      .replace(/▼(?![^<]*<\/span>)/g, '');
  }

  function renderSources(sources) {
    if (!sources || !sources.length) return '';
    return `<div class="dr-sources"><span class="material-icons-outlined" style="font-size:14px;vertical-align:-2px;margin-right:4px">link</span>Sources: ${
      sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>`).join(' · ')
    }</div>`;
  }

  function drLoadingBody(label) {
    return `<div class="dr-loading"><span class="material-icons-outlined dr-loading-icon">auto_awesome</span>Generating AI-enhanced ${label} briefing<span class="dr-loading-dots"></span></div>`;
  }

  function drFailedBody(label) {
    return `<div class="dr-loading dr-failed"><span class="material-icons-outlined" style="color:var(--red)">error_outline</span>Failed to load ${label} briefing<button class="dr-retry-btn" onclick="event.stopPropagation(); window.__retryInsights()"><span class="material-icons-outlined">refresh</span>Retry</button></div>`;
  }

  window.__retryInsights = () => { if (!insightsLoading) loadInsights(); };

  function aiSection({ id, icon, title, data, loadLabel, render, sources }) {
    const hasData = data && (typeof data === 'string' ? data.length > 0 : Object.values(data).some(v => v));
    const failed = !hasData && !insightsLoading;
    const badge = hasData
      ? '<span class="dr-ai-badge"><span class="material-icons-outlined">auto_awesome</span>AI Enhanced</span>'
      : failed
        ? '<span class="dr-ai-badge" style="background:rgba(239,68,68,0.12);color:var(--red)"><span class="material-icons-outlined">error_outline</span>Failed</span>'
        : '<span class="dr-ai-badge loading"><span class="material-icons-outlined">auto_awesome</span>Loading</span>';
    const body = hasData ? render(data) : (failed ? drFailedBody(loadLabel) : drLoadingBody(loadLabel));
    const srcHtml = hasData ? renderSources(sources) : '';
    return `<div class="daily-read collapsed" data-dr-id="${id}">
      <div class="daily-read-header" onclick="this.closest('.daily-read').classList.toggle('collapsed')"><span class="material-icons-outlined">${icon}</span><span class="daily-read-title">${title}</span>${badge}<span class="material-icons-outlined dr-toggle">expand_less</span></div>
      ${hasData ? `<div class="daily-read-date">${drDate()}</div>` : ''}
      <div class="daily-read-body">${body}${srcHtml}</div>
    </div>`;
  }

  function overviewDailyRead() {
    const sections = [['Macro Overview','macro'],['Inflation & Fed','inflation'],['Jobs & Wages','jobs'],['Markets','markets'],['Consumer','consumer'],['Housing','housing']];
    return aiSection({ id: 'us-economy', icon: 'account_balance', title: 'US Economy',
      data: dynamicInsights?.us_daily?.economy, loadLabel: 'US economy',
      sources: dynamicInsights?._sourcesBySection?.us_economy,
      render: d => typeof d === 'string' ? md(d) : sections.map(([s,k]) => `<span class="dr-section">${s}</span><p>${md(d[k] || '')}</p>`).join('') });
  }

  function industryDailyRead() {
    const sections = [['Demand','demand'],['Pricing','pricing'],['Youth Consumer','youth'],['Digital','digital'],['Seasonal Outlook','seasonal'],['Trend Watch','trends']];
    return aiSection({ id: 'us-industry', icon: 'checkroom', title: 'Footwear & Apparel',
      data: dynamicInsights?.us_daily?.industry, loadLabel: 'footwear & apparel',
      sources: dynamicInsights?._sourcesBySection?.us_industry,
      render: d => typeof d === 'string' ? md(d) : sections.map(([s,k]) => `<span class="dr-section">${s}</span><p>${md(d[k] || '')}</p>`).join('') });
  }

  function collectiblesDeepDive() {
    const dc = dynamicInsights?.collectibles;
    if (dc && dc.segments) {
      const L = (text, url) => `<a href="${url}" target="_blank" rel="noopener" class="dd-inline-src">${text}</a>`;
      return `<div class="deep-dive collapsed" data-dr-id="us-collectibles">
        <div class="deep-dive-header" onclick="this.closest('.deep-dive').classList.toggle('collapsed')">
          <div class="deep-dive-badge">FEATURED DEEP DIVE <span class="dr-ai-badge" style="margin-left:8px"><span class="material-icons-outlined">auto_awesome</span>AI</span></div>
          <div class="deep-dive-title-row">
            <span class="material-icons-outlined" style="font-size:26px">diamond</span>
            <div>
              <div class="deep-dive-title">The Collectibles Economy</div>
              <div class="deep-dive-subtitle">Strategic outlook on sneakers, cards, watches & vintage fashion as alternative assets</div>
            </div>
            <span class="material-icons-outlined dd-toggle">expand_less</span>
          </div>
        </div>
        <div class="deep-dive-content">
          <div class="dd-callout">
            <span class="material-icons-outlined">info</span>
            <div><strong>Data sourcing note:</strong> Qualitative analysis is AI-generated daily using current FRED economic data and market context. FRED data links point to official Federal Reserve Economic Data series.</div>
          </div>
          ${dc.intro ? `<div class="dd-intro"><p>${md(dc.intro)}</p></div>` : ''}
          <div class="dd-segment-grid">
            ${dc.segments.map(s => `
              <div class="dd-segment" style="border-left:3px solid ${s.color || 'var(--accent)'}">
                <div class="dd-segment-head">
                  <span class="material-icons-outlined" style="color:${s.color || 'var(--accent)'}">${s.icon || 'diamond'}</span>
                  <div><div class="dd-segment-name">${s.name}</div></div>
                </div>
                <p class="dd-segment-thesis">${md(s.thesis)}</p>
                <div class="dd-risk">
                  <span class="dd-risk-label">Risk Level:</span>
                  <span class="dd-risk-badge" style="background:${s.risk === 'High' ? 'rgba(231,76,60,0.15);color:#e74c3c' : s.risk === 'Low' ? 'rgba(46,204,113,0.15);color:#2ecc71' : 'rgba(243,156,18,0.15);color:#f39c12'}">${s.risk}</span>
                  ${s.riskNote ? `<span class="dd-risk-note">${md(s.riskNote)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
          ${dc.outlook ? `<div class="dd-strategy-section"><div class="dd-strategy-title"><span class="material-icons-outlined">psychology</span> Strategic Outlook</div><p>${md(dc.outlook)}</p></div>` : ''}
          ${dc.bottomLine ? `<div class="dd-bottom-line"><span class="material-icons-outlined">lightbulb</span><div><strong>The Bottom Line:</strong> ${md(dc.bottomLine)}</div></div>` : ''}
        </div>
      </div>`;
    }

    return `<div class="deep-dive collapsed" data-dr-id="us-collectibles">
      <div class="deep-dive-header" onclick="this.closest('.deep-dive').classList.toggle('collapsed')">
        <div class="deep-dive-badge">FEATURED DEEP DIVE <span class="dr-ai-badge loading" style="margin-left:8px"><span class="material-icons-outlined">auto_awesome</span>Loading</span></div>
        <div class="deep-dive-title-row">
          <span class="material-icons-outlined" style="font-size:26px">diamond</span>
          <div>
            <div class="deep-dive-title">The Collectibles Economy</div>
            <div class="deep-dive-subtitle">Strategic outlook on sneakers, cards, watches & vintage fashion as alternative assets</div>
          </div>
          <span class="material-icons-outlined dd-toggle">expand_less</span>
        </div>
      </div>
      <div class="deep-dive-content">${drLoadingBody('collectibles')}</div>
    </div>`;
  }

  function typeColor(type) {
    const map = { fed: 'var(--purple)', data: 'var(--accent)', market: 'var(--orange)', fiscal: 'var(--green)', global: 'var(--cyan)' };
    return map[type] || 'var(--accent)';
  }

  function formatDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function yearAgo(n) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10);
  }

  // ── INDUSTRY DASHBOARD ──────────────────────────────────────

  function iTrend(icon, color, title, body, tags) {
    return `<div class="i-trend-card" style="border-left:3px solid ${color}">
      <div class="i-trend-head">
        <span class="material-icons-outlined" style="color:${color}">${icon}</span>
        <span class="i-trend-title">${title}</span>
      </div>
      <div class="i-trend-body">${md(body)}</div>
      ${tags ? `<div class="i-trend-tags">${tags.map(t => `<span class="i-tag">${t}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  function iSection(icon, title, subtitle) {
    return `<div class="i-section-head">
      <span class="material-icons-outlined">${icon}</span>
      <div><div class="i-section-title">${title}</div>${subtitle ? `<div class="i-section-sub">${subtitle}</div>` : ''}</div>
    </div>`;
  }

  function iHierarchy(levels) {
    return `<div class="i-hierarchy">${levels.map((lvl, i) => `
      <div class="i-hier-level" style="--depth:${i}">
        <div class="i-hier-connector">${i === 0 ? '' : '<span class="i-hier-line"></span>'}</div>
        <div class="i-hier-node" style="border-color:${lvl.color}">
          <div class="i-hier-label">${lvl.label}</div>
          <div class="i-hier-detail">${md(lvl.detail)}</div>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function iProductCard(p) {
    const cls = p.size === 'feat' ? 'i-product-card feat' : p.size === 'wide' ? 'i-product-card wide' : 'i-product-card';
    return `<div class="${cls}">
      <img class="i-product-img" src="${p.img}" alt="${p.name}" loading="lazy" onerror="this.parentElement.style.display='none'">
      <div class="i-product-overlay">
        <div class="i-product-brand">${p.brand}</div>
        <div class="i-product-name">${p.name}</div>
        <div class="i-product-meta">
          ${p.price ? `<span class="i-product-price">${p.price}</span>` : ''}
          ${p.badge ? `<span class="i-product-badge ${p.badge.toLowerCase()}">${p.badge}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function iProductGrid(products, title) {
    return `<div class="i-artboard">
      <div class="i-artboard-title"><span class="material-icons-outlined">dashboard</span>${title || 'Product Board'}</div>
      <div class="i-product-grid">${products.map(iProductCard).join('')}</div>
    </div>`;
  }

  const PRODUCTS = {
    footwear: [
      { brand: 'Puma', name: 'Smash v2 Leather', price: '$70', badge: 'Classic', size: 'feat', img: 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=600&h=600&fit=crop' },
      { brand: 'New Balance', name: '247 Sport', price: '$100', badge: 'Trending', img: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&h=400&fit=crop' },
      { brand: 'New Balance', name: 'X-90 Reconstructed', price: '$130', badge: 'Rising', img: 'https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=400&h=400&fit=crop' },
      { brand: 'Nike', name: 'Air Force 1 \'07', price: '$115', badge: 'Classic', size: 'wide', img: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600&h=400&fit=crop' },
      { brand: 'Nike', name: 'SuperRep Go 3', price: '$100', badge: 'Trending', img: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=400&h=400&fit=crop' },
      { brand: 'Nike', name: 'Air Force 1 Shadow', price: '$120', badge: 'Hot', img: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=400&h=400&fit=crop' },
      { brand: 'Veja', name: 'V-12 Leather', price: '$150', badge: 'Rising', size: 'wide', img: 'https://images.unsplash.com/photo-1603808033192-082d6919d3e1?w=600&h=400&fit=crop' },
      { brand: 'Nike', name: 'Free RN Flyknit', price: '$130', badge: 'Hot', img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=400&fit=crop' },
    ],
    apparel: [
      { brand: 'COS', name: 'Satin Bomber Jacket', price: '$175', badge: 'Trending', size: 'feat', img: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&h=600&fit=crop' },
      { brand: 'Carhartt WIP', name: 'Michigan Chore Coat', price: '$230', badge: 'Trending', img: 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=400&h=400&fit=crop' },
      { brand: 'Nike', name: 'Tech Fleece Jogger', price: '$115', badge: 'Hot', img: 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=400&fit=crop' },
      { brand: 'Levi\'s', name: 'Sherpa Trucker Jacket', price: '$148', badge: 'Classic', size: 'wide', img: 'https://images.unsplash.com/photo-1608063615781-e2ef8c73d114?w=600&h=400&fit=crop' },
      { brand: 'Stüssy', name: 'Stock Logo Hoodie', price: '$120', badge: 'Trending', img: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop' },
      { brand: 'COS', name: 'Printed Chambray Shirt', price: '$89', badge: 'Rising', img: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&h=400&fit=crop' },
      { brand: 'Levi\'s', name: '501 Original Fit', price: '$98', badge: 'Classic', size: 'wide', img: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&h=400&fit=crop' },
      { brand: 'Stüssy', name: 'Basic Logo Tee', price: '$50', badge: 'Classic', img: 'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=400&h=400&fit=crop' },
    ],
    materials: [
      { brand: 'Premium Leather', name: 'Full-Grain Nubuck', badge: 'Trending', size: 'feat', img: 'https://images.unsplash.com/photo-1531310197839-ccf54634509e?w=600&h=600&fit=crop' },
      { brand: 'Raw Denim', name: 'Japanese Selvedge 14oz', badge: 'Classic', size: 'wide', img: 'https://images.unsplash.com/photo-1565084888279-aca607ecce0c?w=600&h=400&fit=crop' },
      { brand: 'Sustainable', name: 'Organic Cotton Fleece', badge: 'Trending', img: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&h=400&fit=crop' },
      { brand: 'Washed Cotton', name: 'Chambray Shirting', badge: 'Classic', img: 'https://images.unsplash.com/photo-1558171813-4c088753af8f?w=400&h=400&fit=crop' },
    ],
  };

  function renderIndustryTrends() {
    const today = fmtToday();
    const di = dynamicInsights?.industry_trends;
    if (di && Array.isArray(di) && di.length >= 6) {
      const macroTrends = di.slice(0, 6);
      const cultureTrends = di.slice(6, 12);
      dashboard.innerHTML = `<div class="tab-content">
        <div class="section-header">
          <h2><span class="material-icons-outlined">checkroom</span>Industry Trends</h2>
          <p>${today} — Footwear & apparel macro trends, cultural shifts, and product-level signals</p>
        </div>
        ${iSection('trending_up', 'Macro Industry Currents', 'The forces reshaping footwear and apparel at the highest level')}
        <div class="i-trend-grid">
          ${macroTrends.map(t => iTrend(t.icon || 'bolt', t.color || 'var(--accent)', t.title, t.body, t.tags)).join('')}
        </div>
        ${cultureTrends.length ? iSection('language', 'Cultural Currents', 'The broader cultural movements filtering into product and design') : ''}
        ${cultureTrends.length ? `<div class="i-trend-grid">${cultureTrends.map(t => iTrend(t.icon || 'palette', t.color || 'var(--purple)', t.title, t.body, t.tags)).join('')}</div>` : ''}
      </div>`;
      return;
    }
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">checkroom</span>Industry Trends</h2>
        <p>${today} — Footwear & apparel macro trends, cultural shifts, and product-level signals</p>
      </div>

      ${iSection('trending_up', 'Macro Industry Currents', 'The forces reshaping footwear and apparel at the highest level')}
      <div class="i-trend-grid">
        ${iTrend('bolt', 'var(--orange)', 'The Great Bifurcation',
          `The middle market is hollowing out. Consumers are splitting into two lanes: <strong>ultra-value</strong> (Shein, Temu, Amazon Essentials, Primark) and <strong>aspirational premium</strong> (On Running, Salomon, Arc\'teryx, Aimé Leon Dore). Brands stuck in between — Gap, J.Crew, mid-tier Nike — face an identity crisis. The brands winning are the ones with a clear answer to "who is this for?"`,
          ['Polarization', 'Value vs Premium', 'Brand Identity'])}
        ${iTrend('public', 'var(--cyan)', 'Globalization of Taste',
          `TikTok has flattened cultural borders. A trend born in Seoul reaches São Paulo in 48 hours. <strong>K-fashion</strong> silhouettes (oversized, layered, gender-fluid) are now global defaults. Japanese "city boy" aesthetic and Scandinavian minimalism compete for the same consumer who also shops Shein. The result: <strong>micro-trends cycle in weeks, not seasons</strong>, and brands must operate at content-speed or become irrelevant.`,
          ['TikTok', 'K-Fashion', 'Micro-Trends', 'Global'])}
        ${iTrend('recycling', 'var(--green)', 'Circular Economy Goes Mainstream',
          `Secondhand is no longer alternative — it\'s default behavior for under-30 consumers. <strong>ThredUp, Depop, Vinted, and The RealReal</strong> are growing 3-5x faster than primary retail. Brand-owned resale (Nike Refurbished, Patagonia Worn Wear, Lululemon Like New) is accelerating. The EU Textile Strategy mandates are forcing every global brand to have a circularity plan or face market access restrictions.`,
          ['Resale', 'Sustainability', 'EU Regulation', 'Gen Z'])}
        ${iTrend('smartphone', 'var(--accent)', 'Content-as-Commerce',
          `Discovery has fully migrated from storefronts to feeds. <strong>TikTok Shop, Instagram Checkout, Douyin, and Shopee Live</strong> are collapsing the funnel from awareness to purchase into seconds. The winning brands aren\'t the ones with the best products — they\'re the ones with the best content ecosystems. Affiliate creators have more influence than magazine editors. A single viral "Get Ready With Me" drives more revenue than a billboard campaign.`,
          ['Social Commerce', 'TikTok Shop', 'Creators', 'DTC'])}
        ${iTrend('psychology', 'var(--purple)', 'Identity Over Utility',
          `Clothing has become <strong>social infrastructure</strong>. What you wear is your profile picture in real life. Gen Z and Gen Alpha don\'t buy clothes — they buy <strong>signaling devices</strong>. A Salomon XT-6 says "I\'m outdoor-adjacent but fashion-literate." A vintage band tee says "I have taste you can\'t buy new." This identity-driven consumption is why footwear and apparel are the last discretionary categories to get cut in a downturn.`,
          ['Identity', 'Signaling', 'Culture', 'Gen Z'])}
        ${iTrend('groups', 'var(--yellow)', 'The Creator-Brand Collapse',
          `The line between creator and brand has dissolved. <strong>Aimé Leon Dore, Corteiz, Broken Planet, and Stüssy</strong> operate more like media companies than fashion houses. They drop content, then product. Traditional brands are responding: Nike\'s SNKRS app gamifies drops, Adidas collabs with Bad Bunny, New Balance partners with Joe Freshgoods. The brands that can\'t build community are losing to those that can.`,
          ['Collabs', 'Drops', 'Community', 'Streetwear'])}
      </div>

      ${iSection('language', 'Cultural Currents', 'The broader cultural movements filtering into product and design')}
      <div class="i-trend-grid">
        ${iTrend('spa', 'var(--cyan)', 'The Wellness-Fashion Convergence',
          `Athleisure was phase one. Now wellness culture is <strong>fully embedded in fashion DNA</strong>. "Gorpcore" (outdoor-functional) merges hiking utility with street style. Brands like Arc\'teryx, Hoka, and Salomon are fashion brands now, not just performance ones. The cultural driver: post-pandemic identity built around health, nature, and "intentional living." Even luxury houses (Loewe, Moncler) are making trail-ready pieces.`,
          ['Gorpcore', 'Wellness', 'Outdoor', 'Athleisure 2.0'])}
        ${iTrend('diversity_3', 'var(--purple)', 'Gender Fluidity in Design',
          `~40% of Gen Z consumers shop across traditional gender categories. <strong>Unisex sizing, gender-neutral collections, and "de-gendered" merchandising</strong> are no longer experimental — they\'re table stakes. Brands like Telfar, Bode, and ERL lead with fluid design. Mass-market players (H&M, Zara) are expanding unisex lines. This structural shift expands TAM while compressing SKU counts — a margin-positive trend.`,
          ['Gender-Neutral', 'Sizing', 'Inclusivity'])}
        ${iTrend('history_edu', 'var(--orange)', 'Nostalgia as Product Strategy',
          `Retro is the dominant design language. <strong>New Balance 550, Adidas Samba, Nike Cortez, Asics Gel-Kayano 14</strong> — the biggest silhouettes are all archive revivals. This isn\'t accidental: nostalgia provides emotional safety in uncertain times. Consumers crave the familiar. Brands are mining their archives systematically, re-releasing 80s and 90s designs with updated materials. The risk: archive fatigue if every brand plays the same card.`,
          ['Retro', 'Archive', '90s Revival', 'Heritage'])}
        ${iTrend('music_note', 'var(--red)', 'Music × Fashion Pipeline',
          `Music remains the single most powerful driver of fashion trends. <strong>Bad Bunny → Adidas. Travis Scott → Nike. Tyler, the Creator → Converse. A$AP Rocky → Puma.</strong> K-pop acts (NewJeans, Stray Kids) are moving entire markets in Asia. Regional music scenes — Afrobeats (Nigeria), reggaetón (Latin America), UK drill — each spawn distinct aesthetics that filter into global streetwear within weeks via TikTok and Instagram.`,
          ['Hip-Hop', 'K-Pop', 'Afrobeats', 'Collabs'])}
        ${iTrend('sports_soccer', 'var(--green)', 'Football (Soccer) Culture Takeover',
          `Terrace culture and football casual aesthetics are having their biggest moment globally. <strong>Adidas Samba, Gazelle, and Spezial</strong> are at the center. The "blokecore" trend merged football kits with everyday fashion. European and South American football culture — shirt collecting, ultras aesthetics, retro kit nostalgia — is driving silhouette choices globally. This is Adidas\'s moment; they own the category.`,
          ['Blokecore', 'Terrace', 'Adidas', 'Retro Kits'])}
        ${iTrend('temple_buddhist', 'var(--yellow)', 'East Asian Aesthetic Dominance',
          `Japanese, Korean, and Chinese design sensibilities are setting the global agenda. <strong>Sacai, Comme des Garçons, and Issey Miyake</strong> influence from the top; Korean street brands (Ader Error, Thisisneverthat) capture the middle; Chinese "guochao" (national tide) brands (Li-Ning, Anta, Bosideng) are building global ambitions. The aesthetic: layered, deconstructed, functional, gender-fluid — and Western brands are adapting to it, not the other way around.`,
          ['Japanese Design', 'K-Fashion', 'Guochao', 'Layering'])}
      </div>
    </div>`;
  }

  function renderIndustryFootwear() {
    const di = dynamicInsights?.industry_footwear;
    if (di) {
      dashboard.innerHTML = `<div class="tab-content">
        <div class="section-header">
          <h2><span class="material-icons-outlined">directions_run</span>Footwear Deep Dive</h2>
          <p>Silhouette trends, brand momentum, and product-level signals</p>
        </div>
        ${di.silhouettes ? iSection('local_fire_department', 'Hot Silhouettes', 'The shapes defining the current cycle') + `<div class="i-trend-grid">${di.silhouettes.map(s => iTrend(s.icon || 'arrow_upward', s.color || 'var(--green)', s.title, s.body, s.tags)).join('')}</div>` : ''}
        ${di.brands ? iSection('emoji_events', 'Brand Momentum', 'Who\'s winning and losing right now') + `<div class="i-brand-grid">${di.brands.map(b => `<div class="i-brand-card"><div class="i-brand-head" style="border-color:${b.direction === 'up' ? 'var(--green)' : b.direction === 'down' ? 'var(--red)' : 'var(--yellow)'}"><span class="i-brand-arrow ${b.direction === 'up' ? 'up' : b.direction === 'down' ? 'down' : 'flat'}">${b.direction === 'up' ? '▲' : b.direction === 'down' ? '▼' : '●'}</span><span class="i-brand-name">${b.name}</span></div><div class="i-brand-body">${md(b.body)}</div></div>`).join('')}</div>` : ''}
        ${iProductGrid(PRODUCTS.footwear, 'Footwear Board')}
        ${di.categories ? iSection('category', 'Category Breakdown', 'Performance by footwear segment') + iHierarchy(di.categories) : ''}
      </div>`;
      return;
    }
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">directions_run</span>Footwear Deep Dive</h2>
        <p>Silhouette trends, brand momentum, and product-level signals</p>
      </div>

      ${iSection('local_fire_department', 'Hot Silhouettes', 'The shapes defining the current cycle')}
      <div class="i-trend-grid">
        ${iTrend('arrow_upward', 'var(--green)', 'Low-Profile Terrace & Court Shoes',
          `The dominant silhouette family right now. <strong>Adidas Samba, Gazelle, and Spezial</strong> line continue to lead. New Balance 480 and 550 are the American counterparts. Nike\'s Killshot and Court Legacy are trying to compete. These shoes work because they\'re versatile — dress them up or down — and they tap into football casual and retro tennis culture simultaneously. The risk: saturation. Samba is approaching ubiquity, which historically triggers a rotation.`,
          ['Samba', 'Gazelle', 'NB 550', 'Court Shoes'])}
        ${iTrend('arrow_upward', 'var(--green)', 'Trail & Outdoor-Inspired Runners',
          `Gorpcore\'s footwear expression. <strong>Salomon XT-6, Hoka Tor Ultra, New Balance 610</strong> bring trail functionality to urban streets. The appeal: they signal "I do things" even if the wearer never touches a trail. Arc\'teryx hikers and Merrell 1TRL collabs are gaining. This category has room to grow as the wellness-outdoor cultural moment persists.`,
          ['Salomon', 'Hoka', 'Gorpcore', 'Trail'])}
        ${iTrend('remove', 'var(--yellow)', 'Chunky/Dad Shoes — Plateau Phase',
          `The maximal chunky era (New Balance 2002R, Nike Air Max 95, Balenciaga Triple S) is plateauing. Consumers are shifting toward cleaner lines. Chunky isn\'t dead — it\'s stabilizing into a permanent niche rather than the dominant look. New Balance 1906R and Asics Gel-NYC still perform, but new entries in this space face diminishing returns.`,
          ['2002R', 'Gel-NYC', 'Maximal', 'Plateau'])}
        ${iTrend('arrow_downward', 'var(--red)', 'Hype-Driven Collabs Cooling',
          `The collab-industrial complex is showing fatigue. Consumers are over-saturated with limited drops. <strong>Nike\'s SNKRS app frustration, Travis Scott oversaturation, and Jordan retro fatigue</strong> are real. The winners now are "quiet" collabs that feel organic (JJJJound × New Balance, Aimé Leon Dore × New Balance) rather than celebrity-driven noise. Expect a rotation toward in-line product excellence over collab dependency.`,
          ['Collab Fatigue', 'SNKRS', 'Jordan', 'Quiet Collabs'])}
      </div>

      ${iSection('emoji_events', 'Brand Momentum', 'Who\'s winning and losing right now')}
      <div class="i-brand-grid">
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--green)">
            <span class="i-brand-arrow up">▲</span>
            <span class="i-brand-name">Adidas</span>
          </div>
          <div class="i-brand-body">Samba/Gazelle cycle is the strongest brand moment in a decade. Terrace culture alignment, organic celebrity adoption (Bella Hadid, Jennie), and a deliberate pullback from discount channels are rebuilding brand equity. Collab strategy with Wales Bonner, Bad Bunny feels curated, not desperate. The question: what comes after Samba?</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--green)">
            <span class="i-brand-arrow up">▲</span>
            <span class="i-brand-name">New Balance</span>
          </div>
          <div class="i-brand-body">Masterclass in taste-making. The JJJJound, ALD, and Joe Freshgoods partnerships elevated the brand from "dad shoe" to cultural currency. The 550, 2002R, 1906R, and 990v6 are all legitimate pillars. Distribution discipline is excellent — they\'re not chasing volume. Risk: becoming too ubiquitous in the "fashion guy" lane.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--green)">
            <span class="i-brand-arrow up">▲</span>
            <span class="i-brand-name">On Running</span>
          </div>
          <div class="i-brand-body">Post-IPO momentum continuing. The Cloudmonster and Cloudtilt are crossing from running into lifestyle. Zendaya partnership is strategic (not hype-dependent). Swiss engineering story has legs. Premium positioning ($150-180) avoids the discount trap. Margin profile is best-in-class among athletic brands.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--yellow)">
            <span class="i-brand-arrow flat">●</span>
            <span class="i-brand-name">Nike</span>
          </div>
          <div class="i-brand-body">In a recalibration phase. Over-reliance on Jordan retros and SNKRS hype created consumer fatigue. New CEO is resetting: pulling back from wholesale, investing in inline innovation, and trying to rebuild the running credibility that On and Hoka captured. The Pegasus 41 and Vomero 18 are steps in the right direction. Nike has the IP to recover — the question is speed of execution.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--yellow)">
            <span class="i-brand-arrow flat">●</span>
            <span class="i-brand-name">Asics</span>
          </div>
          <div class="i-brand-body">The Gel-Kayano 14, Gel-NYC, and GT-2160 broke through to fashion audiences. Collabs with Kiko Kostadinov and Cecilie Bahnsen brought credibility. The challenge: scaling the lifestyle momentum without diluting the brand. Currently in a good position as the "if you know, you know" option.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--red)">
            <span class="i-brand-arrow down">▼</span>
            <span class="i-brand-name">Puma</span>
          </div>
          <div class="i-brand-body">Struggling for cultural relevance. The Suede and Palermo had moments but didn\'t sustain. Rihanna\'s Fenty era is long gone. Puma is stuck between Adidas\'s terrace dominance and Nike\'s scale. Without a clear cultural narrative, they\'re competing on price, which erodes brand equity. Needs a bold creative reset.</div>
        </div>
      </div>

      ${iProductGrid(PRODUCTS.footwear, 'Footwear Board')}

      ${iSection('category', 'Category Breakdown', 'Performance by footwear segment')}
      ${iHierarchy([
        { label: 'Lifestyle/Casual', color: 'var(--green)', detail: 'The largest and fastest-growing segment. Court shoes, retro runners, and terrace styles. Driven by casualization of dress codes and fashion-sport convergence. Adidas, New Balance, and Asics leading.' },
        { label: 'Running/Performance', color: 'var(--accent)', detail: 'On Running and Hoka disrupting Nike and Adidas\'s core. Carbon-plate super shoes still driving innovation. The "run club" social phenomenon is creating new entry points for consumers who want to belong to running culture.' },
        { label: 'Outdoor/Trail', color: 'var(--cyan)', detail: 'Salomon, Merrell 1TRL, Hoka Tor — gorpcore\'s footwear engine. Growing double-digits. Appeals to both performance users and fashion consumers. The crossover between trail and lifestyle is the biggest category story.' },
        { label: 'Luxury Sneakers', color: 'var(--purple)', detail: 'Cooling from the 2021-22 peak. Balenciaga Triple S, Bottega Puddle, and LV trainers still sell but growth is decelerating. The trend is rotating from logo-heavy to understated luxury (The Row, Brunello Cucinelli sneakers).' },
        { label: 'Sandals & Slides', color: 'var(--yellow)', detail: 'Birkenstock IPO validated the category. The Boston clog is a cultural phenomenon. UGG Tasman and platform sandals are year-round now. Comfort-first design philosophy drives this segment.' },
        { label: 'Boots', color: 'var(--orange)', detail: 'Dr. Martens struggling financially but the lug-sole boot aesthetic persists. Timberland retros, Blundstones, and Chelsea boots are steady performers. Not a growth category but a stable base.' },
      ])}
    </div>`;
  }

  function renderIndustryApparel() {
    const di = dynamicInsights?.industry_apparel;
    if (di) {
      dashboard.innerHTML = `<div class="tab-content">
        <div class="section-header">
          <h2><span class="material-icons-outlined">checkroom</span>Apparel Deep Dive</h2>
          <p>Category trends, aesthetic movements, and competitive landscape</p>
        </div>
        ${di.aesthetics ? iSection('style', 'Dominant Aesthetics', 'The looks defining the current moment') + `<div class="i-trend-grid">${di.aesthetics.map(a => iTrend(a.icon || 'landscape', a.color || 'var(--green)', a.title, a.body, a.tags)).join('')}</div>` : ''}
        ${di.brands ? iSection('emoji_events', 'Brand Momentum', 'Who\'s winning and losing right now') + `<div class="i-brand-grid">${di.brands.map(b => `<div class="i-brand-card"><div class="i-brand-head" style="border-color:${b.direction === 'up' ? 'var(--green)' : b.direction === 'down' ? 'var(--red)' : 'var(--yellow)'}"><span class="i-brand-arrow ${b.direction === 'up' ? 'up' : b.direction === 'down' ? 'down' : 'flat'}">${b.direction === 'up' ? '▲' : b.direction === 'down' ? '▼' : '●'}</span><span class="i-brand-name">${b.name}</span></div><div class="i-brand-body">${md(b.body)}</div></div>`).join('')}</div>` : ''}
        ${iProductGrid(PRODUCTS.apparel, 'Apparel Board')}
        ${di.categories ? iSection('category', 'Category Breakdown', 'What\'s growing, what\'s stable, what\'s declining') + iHierarchy(di.categories) : ''}
      </div>`;
      return;
    }
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">checkroom</span>Apparel Deep Dive</h2>
        <p>Category trends, aesthetic movements, and competitive landscape</p>
      </div>

      ${iSection('style', 'Dominant Aesthetics', 'The looks defining the current moment')}
      <div class="i-trend-grid">
        ${iTrend('landscape', 'var(--green)', '"Quiet Outdoor" — Gorpcore Evolves',
          `The raw gorpcore wave is maturing into something more refined. Think <strong>Arc\'teryx layered over a cashmere knit, Salomon with tailored trousers</strong>. The "outdoor" signifier has moved from literal functionality to an aspirational lifestyle code. Key brands: Arc\'teryx, Patagonia, Snow Peak, and Goldwin. Luxury is chasing it: Moncler x Roc Nation, Loewe hiking boots, Zegna "Oasi" line.`,
          ['Gorpcore', 'Arc\'teryx', 'Outdoor Luxury', 'Layering'])}
        ${iTrend('workspace_premium', 'var(--purple)', '"Quiet Luxury" Persists',
          `The Succession effect hasn\'t faded — it\'s deepened. <strong>The Row, Brunello Cucinelli, Loro Piana, Khaite</strong> define the look: logoless, perfect fabrics, whispered status. This aesthetic filtered down: Uniqlo and COS serve the mass-market version. The signal is clear — taste over logos, quality over quantity. Stealth wealth isn\'t a trend; it\'s becoming a permanent lane.`,
          ['The Row', 'Stealth Wealth', 'Logoless', 'Cucinelli'])}
        ${iTrend('wb_sunny', 'var(--orange)', '"Coastal Mediterranean" Summer',
          `Linen, open collars, earthy tones, leather sandals. The <strong>Southern European vacation aesthetic</strong> dominates warm-weather fashion. Brands winning: Jacquemus, Nanushka, Staud, Matteau. Mass-market: Zara and Mango are built for this. The cultural driver: aspirational "good life" content on Instagram and TikTok. This is cycled through resort, vacation-core, and "tomato girl" but the core Mediterranean thread persists.`,
          ['Linen', 'Mediterranean', 'Resort', 'Earthy Tones'])}
        ${iTrend('nightlife', 'var(--red)', '"Going Out" Revival',
          `Post-pandemic nightlife culture has fully returned. <strong>Satin, mesh, sheer fabrics, micro-minis, and statement accessories</strong> are driving a "dressing up" renaissance. This benefits brands with evening/party DNA: Reformation, Rat & Boa, House of CB. Even athletic brands are playing: Nike\'s Nocta line with Drake targets after-dark culture. The "dopamine dressing" impulse is real.`,
          ['Nightlife', 'Satin', 'Dopamine Dressing', 'Party'])}
        ${iTrend('architecture', 'var(--cyan)', 'Workwear & Utilitarian Chic',
          `Carhartt WIP, Dickies, and Engineered Garments anchor the <strong>workwear-as-fashion</strong> lane. Oversized chore coats, cargo pants, and canvas fabrics signal "I make things" even in creative-class offices. This aesthetic thrives because it\'s democratic — works at any price point — and because remote/hybrid work blurred the line between utility and style permanently. Lemaire and Margaret Howell do the elevated version.`,
          ['Workwear', 'Carhartt', 'Utility', 'Oversized'])}
        ${iTrend('auto_awesome', 'var(--yellow)', 'Y2K Fading, 90s Stabilizing',
          `The <strong>Y2K revival</strong> (low-rise, baby tees, bedazzled everything) is losing steam after a 3-year run. The 90s influence is more durable: oversized denim, minimalist silhouettes, and earth tones feel less costume-y and more integrated. Expect a rotation toward <strong>early 2000s preppy</strong> (polo shirts, pleated skirts, varsity) as the next nostalgia cycle.`,
          ['Y2K Fading', '90s Durable', 'Prep Revival', 'Nostalgia'])}
      </div>

      ${iSection('emoji_events', 'Brand Momentum', 'Who\'s winning and losing right now')}
      <div class="i-brand-grid">
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--green)">
            <span class="i-brand-arrow up">▲</span>
            <span class="i-brand-name">Arc'teryx</span>
          </div>
          <div class="i-brand-body">The undisputed gorpcore king. Parent company Amer Sports IPO validated the brand's trajectory. Arc'teryx has transcended outdoor into luxury streetwear without losing credibility — a rare feat. Retail expansion (owned stores in SoHo, London, Tokyo) is building direct relationships. The Beta LT and Alpha SV are as much fashion statements as functional gear. Risk: overexposure if the gorpcore cycle turns.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--green)">
            <span class="i-brand-arrow up">▲</span>
            <span class="i-brand-name">Lululemon</span>
          </div>
          <div class="i-brand-body">Still the premium athleisure benchmark. International expansion (especially China) is the growth engine. The men's category is outpacing women's in growth rate. Product innovation (SenseKnit, Warpstreme) keeps the technical edge. The challenge: defending $100+ leggings against Alo Yoga, Vuori, and Amazon dupes that are closing the quality gap.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--green)">
            <span class="i-brand-arrow up">▲</span>
            <span class="i-brand-name">Carhartt WIP</span>
          </div>
          <div class="i-brand-body">The workwear-to-fashion pipeline's greatest success story. Carhartt WIP occupies a unique lane — authentic utility heritage with streetwear credibility. Collaborations with Sacai and APC elevate without alienating the core. The Michigan Chore Coat and Detroit Jacket are perennial sellers. Distribution discipline keeps it aspirational while mainline Carhartt handles volume.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--yellow)">
            <span class="i-brand-arrow flat">●</span>
            <span class="i-brand-name">Zara / Inditex</span>
          </div>
          <div class="i-brand-body">The fast-fashion machine continues to execute. Inditex's speed-to-market is unmatched — runway-to-rack in 2-3 weeks. The "Zara Effect" still drives trend adoption at scale. Revenue growth remains solid but faces margin pressure from Shein undercutting on price. The bet on larger, premium-feeling stores and curated collections (Zara Studio, SRPLS) is working to hold the aspirational middle ground.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--yellow)">
            <span class="i-brand-arrow flat">●</span>
            <span class="i-brand-name">The North Face</span>
          </div>
          <div class="i-brand-body">The Nuptse puffer is an icon but the brand risks over-reliance on a single silhouette. VF Corp's financial challenges add uncertainty. The brand sits at an interesting crossroads — mainstream enough for mall shoppers, cool enough for streetwear. Collabs with KAWS and Supreme maintain cultural heat. Needs to innovate beyond puffers to sustain the outdoor-lifestyle crossover.</div>
        </div>
        <div class="i-brand-card">
          <div class="i-brand-head" style="border-color:var(--red)">
            <span class="i-brand-arrow down">▼</span>
            <span class="i-brand-name">H&M Group</span>
          </div>
          <div class="i-brand-body">Squeezed from both sides — Shein and Temu underprice on basics while Zara outpaces on trend speed and brand perception. Sustainability messaging has lost credibility after greenwashing controversies. Store rationalization ongoing. COS (the premium sub-brand) is the bright spot, but the core H&M brand struggles to articulate who it's for in a market that demands either extreme value or clear identity.</div>
        </div>
      </div>

      ${iProductGrid(PRODUCTS.apparel, 'Apparel Board')}

      ${iSection('category', 'Category Breakdown', 'What\'s growing, what\'s stable, what\'s declining')}
      ${iHierarchy([
        { label: 'Athleisure & Activewear', color: 'var(--green)', detail: 'Still the largest and most dominant category. Lululemon, Alo Yoga, Vuori, Gymshark — casualization is permanent. The market is bifurcating: premium ($100+ leggings) and value (Amazon dupes). Growth is decelerating but the structural shift is irreversible.' },
        { label: 'Outerwear & Layering', color: 'var(--green)', detail: 'Gorpcore and year-round layering drive demand. Puffer jackets (The North Face, Moncler) are now 12-month items, not seasonal. Technical shell jackets (Arc\'teryx, Patagonia) cross from outdoor to daily wear. Highest growth in outerwear in a decade.' },
        { label: 'Denim', color: 'var(--accent)', detail: 'Denim is in a strong cycle. Wide-leg and barrel silhouettes dominate, replacing the skinny era. Premium denim (Agolde, Citizens of Humanity, Re/Done) is thriving. Levi\'s turnaround is working. Vintage denim resale prices at all-time highs — a sign of genuine demand, not just supply contraction.' },
        { label: 'Knitwear & Basics', color: 'var(--cyan)', detail: 'The "elevated basics" play. Uniqlo, COS, and Pangaia own this space. Merino, cashmere-blend, and technical knits are replacing cheap cotton. Consumers are buying fewer, better pieces. This is the "capsule wardrobe" trend in action.' },
        { label: 'Tailoring & Suiting', color: 'var(--yellow)', detail: 'Slow recovery post-pandemic. Oversized and deconstructed silhouettes (Zegna, Lemaire) are more popular than traditional structured suits. The "office" dress code is now "smart casual" at best. Double-breasted blazers and wide-leg trousers work in fashion; the traditional suit market remains compressed.' },
        { label: 'Formalwear', color: 'var(--red)', detail: 'The most structurally challenged category. Wedding and event-specific dressing is the only reliable demand driver. Rental platforms (Rent the Runway, Hurr) are cannibalizing purchases. Unless you\'re in luxury (Valentino, Dior), this is a shrinking market.' },
      ])}
    </div>`;
  }

  function renderIndustryColorMaterial() {
    const di = dynamicInsights?.industry_color;
    if (di) {
      dashboard.innerHTML = `<div class="tab-content">
        <div class="section-header">
          <h2><span class="material-icons-outlined">palette</span>Color & Material Trends</h2>
          <p>The palette and fabrication signals driving footwear and apparel design</p>
        </div>
        ${di.colors ? iSection('color_lens', 'Color Direction', 'The season\'s dominant palette') + `<div class="i-color-grid">${di.colors.map(c => `<div class="i-color-card"><div class="i-color-swatch" style="background:${c.gradient}"></div><div class="i-color-info"><div class="i-color-name">${c.name}</div><div class="i-color-status ${c.status}">${c.status}</div><div class="i-color-detail">${md(c.detail)}</div></div></div>`).join('')}</div>` : ''}
        ${di.materials ? iSection('texture', 'Material & Fabric Trends', 'Innovation at the material level') + `<div class="i-trend-grid">${di.materials.map(m => iTrend(m.icon || 'layers', m.color || 'var(--blue)', m.title, m.body, m.tags)).join('')}</div>` : ''}
        ${iProductGrid(PRODUCTS.materials, 'Material & Texture Board')}
        ${di.design ? iSection('design_services', 'Design Detail Signals', 'The construction and finish details gaining traction') + iHierarchy(di.design) : ''}
      </div>`;
      return;
    }
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">palette</span>Color, Material & Product Trends</h2>
        <p>Design-level signals — what\'s on the mood boards and factory floors</p>
      </div>

      ${iSection('palette', 'Color Trends', 'The palettes driving sell-through')}
      <div class="i-color-grid">
        <div class="i-color-card">
          <div class="i-color-swatch" style="background:linear-gradient(135deg, #6b4423, #8B6914, #c4a35a)"></div>
          <div class="i-color-info">
            <div class="i-color-name">Earthy Browns & Tans</div>
            <div class="i-color-status hot">Dominant</div>
            <div class="i-color-detail">"Mink," "mocha," "tobacco" — brown is the new black. Driven by quiet luxury and Mediterranean aesthetics. Every major brand from Zara to The Row has brown as a seasonal anchor. Pairs naturally with the outdoor/gorpcore movement. Expect this to persist for 2+ seasons.</div>
          </div>
        </div>
        <div class="i-color-card">
          <div class="i-color-swatch" style="background:linear-gradient(135deg, #5c6b4f, #708238, #8a9a5b)"></div>
          <div class="i-color-info">
            <div class="i-color-name">Forest & Olive Greens</div>
            <div class="i-color-status hot">Rising</div>
            <div class="i-color-detail">Gorpcore\'s signature color. Olive cargo pants, forest green shells, sage knits. Green signals nature-adjacency and works across casual, outdoor, and smart-casual contexts. Military/utility undertones give it edge. Replaces teal and mint from prior seasons.</div>
          </div>
        </div>
        <div class="i-color-card">
          <div class="i-color-swatch" style="background:linear-gradient(135deg, #7b2d3b, #922b3e, #b5485d)"></div>
          <div class="i-color-info">
            <div class="i-color-name">Burgundy & Oxblood</div>
            <div class="i-color-status hot">Rising</div>
            <div class="i-color-detail">The "cherry" and "burgundy" wave is building for fall/winter. Deeper, richer reds replace the brighter scarlets of prior seasons. Luxury loves it (Bottega, Ferragamo); mass-market is following. Works across leather goods, knitwear, and footwear. Cultural tie: "dark feminine" and "mob wife" aesthetics.</div>
          </div>
        </div>
        <div class="i-color-card">
          <div class="i-color-swatch" style="background:linear-gradient(135deg, #b8bcc4, #d1d5db, #e8eaed)"></div>
          <div class="i-color-info">
            <div class="i-color-name">Silver & Metallic Grey</div>
            <div class="i-color-status rising">Emerging</div>
            <div class="i-color-detail">The "going out" revival and futuristic aesthetics are pushing metallics. Silver outerwear (Coperni, Courrèges), chrome accessories, and metallic-finish sneakers are gaining. This works for evening and statement pieces, not everyday — a narrower but high-impact trend.</div>
          </div>
        </div>
        <div class="i-color-card">
          <div class="i-color-swatch" style="background:linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)"></div>
          <div class="i-color-info">
            <div class="i-color-name">Deep Navy & Midnight</div>
            <div class="i-color-status stable">Stable</div>
            <div class="i-color-detail">Navy is the perennial workhorse — never trending, never out. It\'s the quiet luxury default. Every brand needs it, every consumer buys it. Particularly strong in tailoring, outerwear, and knitwear. Not exciting, but commercially essential.</div>
          </div>
        </div>
        <div class="i-color-card">
          <div class="i-color-swatch" style="background:linear-gradient(135deg, #f4a261, #e76f51, #d62828)"></div>
          <div class="i-color-info">
            <div class="i-color-name">Bright Pops — Orange, Coral, Red</div>
            <div class="i-color-status fading">Rotating</div>
            <div class="i-color-detail">Dopamine dressing is waning as the dominant mood shifts toward earth tones and muted palettes. Bright pops still work for accessories, sneaker accents, and athletic wear — but all-over neon/bright looks are cycling out. The exception: red remains strong in luxury as a power color.</div>
          </div>
        </div>
      </div>

      ${iSection('texture', 'Material & Fabric Trends', 'What the supply chain is moving toward')}
      <div class="i-trend-grid">
        ${iTrend('eco', 'var(--green)', 'Recycled & Bio-Based Materials',
          `EU regulation is forcing the industry toward <strong>recycled polyester, organic cotton, and bio-based synthetics</strong>. Nike Flyknit, Adidas Parley (ocean plastic), and Allbirds (merino/eucalyptus) pioneered this. Now it\'s table stakes — every major brand must have a sustainability story in materials. The gap: recycled materials are still 15-30% more expensive, creating a cost-quality tension.`,
          ['Recycled Poly', 'Organic Cotton', 'Bio-Based', 'EU Mandate'])}
        ${iTrend('grain', 'var(--orange)', 'Premium Natural Textures',
          `Suede, nubuck, premium leather, and textured knits are displacing smooth synthetics in the premium segment. Consumers associate natural textures with quality and longevity — a quiet luxury signal. <strong>New Balance\'s suede 990s, Birkenstock\'s oiled leather, and Loro Piana\'s cashmere</strong> all leverage this. Mass-market imitations in faux-suede and PU leather proliferate.`,
          ['Suede', 'Leather', 'Cashmere', 'Texture'])}
        ${iTrend('water_drop', 'var(--cyan)', 'Technical Fabrics in Everyday Wear',
          `Gore-Tex, Pertex, and proprietary tech fabrics are no longer confined to outdoor gear. <strong>Arc\'teryx shells over office wear, Nike ACG as daily streetwear, Veilance as luxury techwear</strong>. The consumer wants clothes that perform — water-resistant, breathable, stretch — without looking like hiking gear. This is the "stealth performance" trend.`,
          ['Gore-Tex', 'Technical', 'Performance', 'Stealth'])}
        ${iTrend('dry_cleaning', 'var(--purple)', 'Linen, Wool, and Natural Fibers Renaissance',
          `A counter-movement to synthetic everything. <strong>Linen for summer, merino for year-round, wool blends for outerwear</strong>. Driven by the quiet luxury aesthetic and consumer desire for "real" materials. Brands like Auralee (Japan), Margaret Howell, and Sézane are built entirely on this proposition. The trade-off: natural fibers wrinkle and need care, which conflicts with convenience expectations.`,
          ['Linen', 'Merino', 'Wool', 'Natural'])}
      </div>

      ${iProductGrid(PRODUCTS.materials, 'Material & Texture Board')}

      ${iSection('design_services', 'Product Design Signals', 'Construction and design details trending now')}
      ${iHierarchy([
        { label: 'Oversized & Relaxed Fit', color: 'var(--green)', detail: 'The dominant silhouette across all categories. Oversized blazers, wide-leg pants, boxy tees, relaxed-fit denim. Slim and skinny are dead outside of athletic base layers. This is a structural shift in how clothes are cut and marketed.' },
        { label: 'Layering-First Design', color: 'var(--accent)', detail: 'Products designed to be worn in combination. Vests over hoodies, shells over knits, shirts under sweaters. This multiplies wardrobe utility and drives cross-category purchasing. Japanese and Korean brands lead this philosophy.' },
        { label: 'Visible Construction', color: 'var(--cyan)', detail: 'Raw hems, exposed stitching, deconstructed seams. Influenced by Maison Margiela and Sacai. The "unfinished" look signals craft awareness. Bode, ERL, and 11.11 use artisanal construction as a design feature.' },
        { label: 'Modular & Multi-Use', color: 'var(--yellow)', detail: 'Convertible jackets, zip-off pants, reversible pieces. Utility-meets-minimalism. Brands like Post Archive Faction and Acronym lead the technical end; Uniqlo and COS do the commercial version. Sustainability angle: one piece, multiple uses.' },
        { label: 'Embellishment Returning', color: 'var(--purple)', detail: 'After years of minimalism, embellishment is creeping back — but different from the Y2K version. Think subtle embroidery, patchwork, and hand-applied details rather than rhinestones and logos. Bode, Story mfg., and Kardo drive the craft-forward version.' },
      ])}
    </div>`;
  }

  function renderIndustryConsumer() {
    const di = dynamicInsights?.industry_consumer;
    if (di) {
      dashboard.innerHTML = `<div class="tab-content">
        <div class="section-header">
          <h2><span class="material-icons-outlined">people</span>Consumer & Culture</h2>
          <p>How generational shifts, shopping behavior, and cultural movements shape footwear & apparel demand</p>
        </div>
        ${di.generations ? iSection('groups', 'Generational Lens', 'How each generation is showing up in the market right now') + `<div class="i-trend-grid">${di.generations.map(g => iTrend(g.icon || 'person', g.color || 'var(--accent)', g.title, g.body, g.tags)).join('')}</div>` : ''}
        ${di.shopping ? iSection('shopping_cart', 'Shopping Behavior Shifts', 'The how and where of consumer purchasing') + `<div class="i-trend-grid">${di.shopping.map(s => iTrend(s.icon || 'storefront', s.color || 'var(--green)', s.title, s.body, s.tags)).join('')}</div>` : ''}
        ${di.culture ? iSection('theater_comedy', 'Cultural Influence Map', 'Music, media, sport, and subculture driving demand') + `<div class="i-trend-grid">${di.culture.map(c => iTrend(c.icon || 'music_note', c.color || 'var(--purple)', c.title, c.body, c.tags)).join('')}</div>` : ''}
      </div>`;
      return;
    }
    dashboard.innerHTML = `<div class="tab-content">
      <div class="section-header">
        <h2><span class="material-icons-outlined">person</span>Consumer Behavior & Culture</h2>
        <p>How people discover, buy, wear, and discard fashion</p>
      </div>

      ${iSection('groups', 'Generational Profiles', 'How each generation is shaping demand differently')}
      <div class="i-trend-grid">
        ${iTrend('child_care', 'var(--cyan)', 'Gen Alpha (Under 14) — The Digital Natives',
          `Born into TikTok and Roblox, Gen Alpha is <strong>brand-aware by age 8</strong>. They\'re already asking for specific sneakers (Nike Dunks, New Balance) and know about "limited drops" through YouTube and gaming culture. <strong>Digital fashion</strong> (Roblox skins, Fortnite outfits) is their gateway drug to physical fashion. Parents are the wallet, but kids are the decision-maker. This generation will be the most brand-literate in history.`,
          ['Roblox', 'Digital Fashion', 'Brand Awareness', 'Influence'])}
        ${iTrend('school', 'var(--accent)', 'Gen Z (14-27) — Identity Through Style',
          `The core market for trend-driven fashion. <strong>Resale-first, TikTok-discovered, anti-loyalty</strong>. They shop Depop and Shein in the same session without contradiction. Sustainability matters — but not more than price. They\'re the most gender-fluid generation in fashion history. Brand heat is measured in TikTok mentions, not ad impressions. They view their wardrobe as a rotating content prop.`,
          ['TikTok', 'Resale', 'Gender-Fluid', 'Anti-Loyalty'])}
        ${iTrend('work', 'var(--orange)', 'Millennials (28-43) — The Premium Loyalists',
          `Peak earning years. <strong>Lululemon, Allbirds, On Running, Vuori</strong> — they built the premium athleisure market. Millennials are more brand-loyal than Gen Z but less than Boomers. They\'ll pay $128 for leggings if the brand aligns with their values (sustainability, quality, community). The "quiet luxury" consumer is disproportionately millennial. They\'re also the biggest users of brand-owned resale programs.`,
          ['Premium', 'Athleisure', 'Values-Driven', 'Loyalty'])}
        ${iTrend('self_improvement', 'var(--purple)', 'Gen X (44-59) — The Overlooked Spenders',
          `The highest per-capita fashion spenders, largely ignored by marketing. <strong>They buy quality over trend</strong> and are the core customer for heritage brands (Ralph Lauren, Barbour, Levi\'s). Less influenced by social media but highly responsive to quality storytelling. They\'re driving the outdoor/gorpcore premium segment (Arc\'teryx, Patagonia) and the "investment piece" economy.`,
          ['Quality', 'Heritage', 'Investment Pieces', 'Ignored'])}
      </div>

      ${iSection('shopping_cart', 'Shopping Behavior', 'How and where consumers are buying')}
      <div class="i-trend-grid">
        ${iTrend('phone_iphone', 'var(--accent)', 'Mobile-First, Social-First Discovery',
          `For under-35 consumers, the discovery funnel is: <strong>TikTok/Instagram → Google search to verify → purchase (often on phone)</strong>. Traditional retail websites are becoming checkout utilities, not discovery platforms. Brands that don\'t have a social content strategy are invisible to the next generation. "SEO" is becoming "TikTok SEO" — optimizing for social search, not Google.`,
          ['Mobile', 'TikTok SEO', 'Social Discovery'])}
        ${iTrend('sync_alt', 'var(--green)', 'The Secondhand-First Mindset',
          `A growing cohort checks resale platforms <strong>before</strong> looking at primary retail. Depop, Vinted, and eBay are the first stop, not the last resort. This behavior is cultural (thrift hauls are aspirational content), economic (budget-stretching), and environmental (guilt-free consumption). Brands must factor resale value into product strategy — items that hold value on StockX or Depop have inherently higher primary demand.`,
          ['Resale-First', 'Thrift', 'Vinted', 'Depop'])}
        ${iTrend('bolt', 'var(--orange)', 'Impulse vs Intentional — The Split',
          `Consumer behavior is splitting into two modes: <strong>impulse micro-purchases</strong> (Shein hauls, TikTok Shop, under $30) and <strong>intentional investment purchases</strong> ($100+, researched, "buy once"). The middle ground — $40-80 impulse purchases from mid-tier brands — is evaporating. This is the Great Bifurcation expressed as shopping behavior.`,
          ['Impulse', 'Intentional', 'Bifurcation'])}
        ${iTrend('loyalty', 'var(--red)', 'Loyalty Is Dead (Mostly)',
          `Brand loyalty among under-30 consumers is at an all-time low. <strong>Switching costs are zero</strong>. A consumer wearing Nike today will wear New Balance tomorrow and Asics next month. Loyalty exists only at the extremes: ultra-premium (The Row customers don\'t switch) and community-driven brands (Corteiz, Aimé Leon Dore create genuine belonging). Everyone in between must earn re-purchase constantly.`,
          ['Anti-Loyalty', 'Switching', 'Community'])}
      </div>

      ${iSection('forum', 'Cultural Influences on Consumption', 'The non-fashion forces shaping what people wear')}
      <div class="i-trend-grid">
        ${iTrend('movie_filter', 'var(--purple)', 'Film & TV as Fashion Catalogs',
          `<strong>Succession</strong> drove quiet luxury. <strong>Euphoria</strong> drove Y2K. <strong>White Lotus</strong> drove Mediterranean resort. <strong>Challengers</strong> reignited tenniscore. <strong>Shogun</strong> boosted Japanese aesthetics. Every major show is now a fashion event — costume designers are the most influential stylists in the industry. Brands are proactively placing product in productions.`,
          ['Succession', 'TV', 'Costume Design', 'Placement'])}
        ${iTrend('sports_esports', 'var(--cyan)', 'Gaming & Virtual Fashion',
          `Fortnite and Roblox generate billions from digital fashion. <strong>Balenciaga × Fortnite, Nike × Roblox (.SWOOSH), and Gucci Garden</strong> proved digital fashion is a revenue channel, not just marketing. Gen Alpha\'s first fashion purchases may be virtual. The long play: digital-to-physical pipelines where virtual try-on drives IRL purchases.`,
          ['Fortnite', 'Roblox', 'Digital Fashion', 'Virtual'])}
        ${iTrend('travel', 'var(--orange)', 'Travel & Place-Based Identity',
          `"Where I\'ve been" is a fashion statement. <strong>Vintage sports tees from foreign cities, souvenir jackets, and place-specific brands</strong> signal cosmopolitan taste. This fuels: Japan-exclusive sneaker colorways, European market vintage, and travel-adjacent aesthetics (coastal, alpine, Mediterranean). The "well-traveled" look is aspirational for consumers who discover it on social media.`,
          ['Travel', 'Souvenir', 'Place-Based', 'Cosmopolitan'])}
        ${iTrend('local_cafe', 'var(--yellow)', 'Food, Coffee & Lifestyle Convergence',
          `Fashion brands are becoming lifestyle ecosystems. <strong>Ralph\'s Coffee, Aimé Leon Dore\'s café, Kith Treats</strong> — the most culturally relevant brands understand that fashion is embedded in a broader lifestyle. The "third place" strategy creates community touchpoints beyond shopping. This convergence means competing with restaurants and coffee shops for consumer attention and wallet.`,
          ['Lifestyle', 'Café', 'Community', 'Third Place'])}
      </div>
    </div>`;
  }

  // ── Podcast Player (Azure Neural TTS via edge-tts) ──────
  (function initPodcast() {
    const overlay = $('#podcast-overlay');
    if (!overlay) return;
    const closeBtn = $('#podcast-close');
    const collapseBtn = $('#podcast-collapse');
    const playBtn = $('#podcast-play-btn');
    const playIcon = $('#podcast-play-icon');
    const transcript = $('#podcast-transcript');
    const statusEl = $('#podcast-status');
    const progressFill = $('#podcast-progress-fill');
    const lineCountEl = $('#podcast-line-count');
    const dateEl = $('#podcast-date');
    const speedBtn = $('#podcast-speed-btn');
    const openBtn = $('#morning-news-btn');
    const progressBar = $('#podcast-progress');
    const progressThumb = $('#podcast-progress-thumb');
    const nowPlaying = $('#podcast-now-playing');
    const nowSpeaker = $('#podcast-now-speaker');
    const nowText = $('#podcast-now-text');

    let podcastLines = null;
    let playing = false;
    let currentLine = 0;
    let currentAudio = null;
    const speeds = [1, 1.15, 1.3, 1.5];
    let speedIdx = 0;
    let generating = false;
    let scrubbing = false;
    let prefetchPromise = null;
    let currentUtterance = null;

    const synth = window.speechSynthesis;
    let voiceAlex = null;
    let voiceSam = null;

    function pickVoices() {
      const all = synth.getVoices().filter(v => v.lang.startsWith('en'));
      if (!all.length) return;
      const males = all.filter(v => /male|daniel|james|guy|aaron|david|thomas/i.test(v.name));
      const females = all.filter(v => /female|samantha|karen|kate|fiona|moira|tessa|zira|susan/i.test(v.name));
      voiceAlex = males[0] || all[0];
      voiceSam = females[0] || all[Math.min(1, all.length - 1)] || all[0];
      if (voiceAlex === voiceSam && all.length > 1) voiceSam = all[1];
    }

    pickVoices();
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = pickVoices;

    const PODCAST_CACHE_KEY = 'podcast_cache_v3';

    function getCachedPodcast() {
      try {
        const raw = localStorage.getItem(PODCAST_CACHE_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (cached.date !== new Date().toISOString().slice(0, 10)) return null;
        if (!cached.lines?.length) return null;
        return cached.lines;
      } catch { return null; }
    }

    function cachePodcast(lines) {
      try {
        localStorage.setItem(PODCAST_CACHE_KEY, JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          lines
        }));
      } catch {}
    }

    function prefetchPodcast() {
      const cached = getCachedPodcast();
      if (cached) {
        prefetchPromise = Promise.resolve(cached);
        return;
      }
      prefetchPromise = fetch('/api/podcast')
        .then(r => r.json())
        .then(data => {
          if (data.error || !data.lines?.length) return null;
          cachePodcast(data.lines);
          return data.lines;
        })
        .catch(() => null);
    }

    prefetchPodcast();

    openBtn?.addEventListener('click', () => {
      if (overlay.classList.contains('open')) {
        overlay.classList.toggle('collapsed');
        return;
      }
      overlay.classList.remove('collapsed');
      overlay.classList.add('open');
      dateEl.textContent = fmtToday();
      if (!podcastLines && !generating) loadFromPrefetch();
    });

    collapseBtn?.addEventListener('click', () => {
      overlay.classList.toggle('collapsed');
    });

    closeBtn?.addEventListener('click', () => {
      overlay.classList.remove('open');
      overlay.classList.remove('collapsed');
      stopPlayback();
    });

    speedBtn.addEventListener('click', () => {
      speedIdx = (speedIdx + 1) % speeds.length;
      speedBtn.textContent = speeds[speedIdx] + 'x';
      if (currentAudio) currentAudio.playbackRate = speeds[speedIdx];
      if (currentUtterance && synth.speaking) {
        synth.cancel();
        playLine(currentLine);
      }
    });

    playBtn.addEventListener('click', () => {
      if (generating) return;
      if (!podcastLines) { generateScript(); return; }
      if (playing) pausePlayback(); else resumePlayback();
    });

    function seekToLine(idx) {
      if (!podcastLines || idx < 0 || idx >= podcastLines.length) return;
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      stopSpeech();
      currentLine = idx;
      updateProgress();
      highlightLine(idx);
      if (playing) playLine(idx);
    }

    function scrubFromEvent(e) {
      if (!podcastLines) return;
      const rect = progressBar.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      const idx = Math.round(pct * (podcastLines.length - 1));
      const displayPct = podcastLines.length > 1 ? ((idx + 1) / podcastLines.length * 100) : 0;
      progressFill.style.width = displayPct + '%';
      progressThumb.style.left = displayPct + '%';
      lineCountEl.textContent = `${idx + 1} / ${podcastLines.length}`;
      return idx;
    }

    function startScrub(e, isTouch) {
      if (!podcastLines) return;
      scrubbing = true;
      progressBar.classList.add('scrubbing');
      const wasPlaying = playing;
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      stopSpeech();
      let targetIdx = scrubFromEvent(e);

      const moveEvent = isTouch ? 'touchmove' : 'mousemove';
      const endEvent = isTouch ? 'touchend' : 'mouseup';

      const onMove = ev => { if (isTouch) ev.preventDefault(); targetIdx = scrubFromEvent(ev); };
      const onEnd = () => {
        scrubbing = false;
        progressBar.classList.remove('scrubbing');
        document.removeEventListener(moveEvent, onMove);
        document.removeEventListener(endEvent, onEnd);
        currentLine = targetIdx;
        updateProgress();
        highlightLine(targetIdx);
        if (wasPlaying) playLine(targetIdx);
      };
      document.addEventListener(moveEvent, onMove, isTouch ? { passive: false } : undefined);
      document.addEventListener(endEvent, onEnd);
    }

    progressBar.addEventListener('mousedown', e => startScrub(e, false));
    progressBar.addEventListener('touchstart', e => startScrub(e, true), { passive: true });

    transcript.addEventListener('click', e => {
      const lineEl = e.target.closest('.podcast-line');
      if (!lineEl || !podcastLines) return;
      const idx = parseInt(lineEl.dataset.idx, 10);
      if (isNaN(idx)) return;
      if (!playing) {
        playing = true;
        playIcon.textContent = 'pause';
        statusEl.textContent = 'Now playing';
      }
      seekToLine(idx);
    });

    function applyPodcastData(lines) {
      podcastLines = lines;
      lineCountEl.textContent = `${podcastLines.length} lines`;
      statusEl.textContent = 'Ready — press play';
      renderTranscript();
      playIcon.textContent = 'play_arrow';
    }

    async function loadFromPrefetch() {
      if (!prefetchPromise) return;
      generating = true;
      statusEl.innerHTML = '<span class="podcast-loading-dot"></span> Loading today\'s briefing...';
      playIcon.textContent = 'hourglass_top';
      try {
        const lines = await prefetchPromise;
        if (lines) {
          applyPodcastData(lines);
          generating = false;
          return;
        }
      } catch {}
      generating = false;
      statusEl.textContent = 'Press play to start generating today\'s briefing';
      playIcon.textContent = 'play_arrow';
    }

    async function generateScript() {
      generating = true;
      statusEl.innerHTML = '<span class="podcast-loading-dot"></span> Generating today\'s briefing — this takes ~30s...';
      playIcon.textContent = 'hourglass_top';
      transcript.innerHTML = '';

      try {
        if (prefetchPromise) {
          const cached = await prefetchPromise;
          if (cached) {
            applyPodcastData(cached);
            generating = false;
            resumePlayback();
            return;
          }
        }

        const resp = await fetch('/api/podcast');
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        if (!data.lines?.length) throw new Error('Empty script');

        cachePodcast(data.lines);
        applyPodcastData(data.lines);
        generating = false;
        resumePlayback();
      } catch (e) {
        console.error('Podcast error:', e);
        statusEl.textContent = 'Generation failed — tap play to retry';
        playIcon.textContent = 'play_arrow';
        generating = false;
      }
    }

    function renderTranscript() {
      transcript.innerHTML = podcastLines.map((l, i) => {
        const cls = l.speaker === 'Alex' ? 'speaker-a' : 'speaker-b';
        return `<div class="podcast-line ${cls}" data-idx="${i}">` +
          `<span class="podcast-speaker">${l.speaker}</span>` +
          `<span class="podcast-text">${l.text}</span></div>`;
      }).join('');
    }

    function stopSpeech() {
      if (currentUtterance) { currentUtterance = null; }
      synth.cancel();
    }

    function playLine(idx) {
      if (idx >= podcastLines.length) { finishPlayback(); return; }
      currentLine = idx;
      updateProgress();
      highlightLine(idx);

      const line = podcastLines[idx];

      if (line.audio) {
        const audio = new Audio('data:audio/mpeg;base64,' + line.audio);
        audio.playbackRate = speeds[speedIdx];
        currentAudio = audio;
        audio.onended = () => { currentAudio = null; if (playing) playLine(idx + 1); };
        audio.onerror = () => { currentAudio = null; if (playing) playLine(idx + 1); };
        audio.play().catch(() => { currentAudio = null; if (playing) playLine(idx + 1); });
        return;
      }

      const utt = new SpeechSynthesisUtterance(line.text);
      utt.rate = speeds[speedIdx];
      utt.pitch = line.speaker === 'Alex' ? 1.0 : 1.1;
      utt.voice = line.speaker === 'Alex' ? voiceAlex : voiceSam;
      currentUtterance = utt;

      utt.onend = () => {
        currentUtterance = null;
        if (playing) playLine(idx + 1);
      };
      utt.onerror = (e) => {
        if (e.error === 'canceled') return;
        currentUtterance = null;
        if (playing) playLine(idx + 1);
      };

      synth.cancel();
      synth.speak(utt);
    }

    function resumePlayback() {
      if (!podcastLines) return;
      playing = true;
      playIcon.textContent = 'pause';
      statusEl.textContent = 'Now playing';

      if (currentAudio && currentAudio.paused && currentAudio.currentTime > 0) {
        currentAudio.play();
      } else if (synth.paused) {
        synth.resume();
      } else {
        playLine(currentLine);
      }
    }

    function pausePlayback() {
      playing = false;
      playIcon.textContent = 'play_arrow';
      statusEl.textContent = 'Paused';
      if (currentAudio) currentAudio.pause();
      if (synth.speaking && !synth.paused) synth.pause();
    }

    function stopPlayback() {
      playing = false;
      playIcon.textContent = 'play_arrow';
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      stopSpeech();
    }

    function finishPlayback() {
      playing = false;
      playIcon.textContent = 'replay';
      statusEl.textContent = 'Finished — tap to replay';
      currentLine = 0;
      currentAudio = null;
      currentUtterance = null;
      progressFill.style.width = '100%';
      progressThumb.style.left = '100%';
    }

    function highlightLine(idx) {
      $$('.podcast-line.active', transcript).forEach(el => el.classList.remove('active'));
      const el = $(`.podcast-line[data-idx="${idx}"]`, transcript);
      if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      if (podcastLines && podcastLines[idx]) {
        const line = podcastLines[idx];
        const cls = line.speaker === 'Alex' ? 'speaker-a' : 'speaker-b';
        nowPlaying.className = 'podcast-now-playing ' + cls;
        nowSpeaker.textContent = line.speaker;
        nowText.textContent = line.text;
      }
    }

    function updateProgress() {
      if (scrubbing) return;
      const pct = podcastLines ? ((currentLine + 1) / podcastLines.length * 100) : 0;
      progressFill.style.width = pct + '%';
      progressThumb.style.left = pct + '%';
      lineCountEl.textContent = `${currentLine + 1} / ${podcastLines.length}`;
    }
  })();

  init();
})();

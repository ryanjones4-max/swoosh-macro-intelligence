const FRED = (() => {
  const API_KEY = '98a1be06f9fa0a9aefa91e1dbaa888bb';
  const BASE = '/api/fred';
  const cache = new Map();
  const CACHE_TTL = 3600000; // 1 hour

  const S = (id, name, unit, decimals, freq, opts) => ({id, name, unit, decimals, freq, ...opts});
  const SERIES = {
    GDP: S('GDP','Nominal GDP','$B',0,'q'), GDPC1: S('GDPC1','Real GDP','$B',0,'q'),
    GDPGROWTH: S('A191RL1Q225SBEA','Real GDP Growth','%',1,'q'),
    INDPRO: S('INDPRO','Industrial Production','idx',1,'m'), CAPACITY: S('TCU','Capacity Utilization','%',1,'m'),
    UNRATE: S('UNRATE','Unemployment Rate','%',1,'m'), PAYEMS: S('PAYEMS','Nonfarm Payrolls','K',0,'m'),
    ICSA: S('ICSA','Initial Jobless Claims','',0,'w'), CIVPART: S('CIVPART','Labor Force Participation','%',1,'m'),
    U6RATE: S('U6RATE','U-6 Underemployment','%',1,'m'), AWHAEPBS: S('AWHAEPBS','Avg Weekly Hours (Prof & Biz Svcs)','hrs',1,'m'),
    CES0500000003: S('CES0500000003','Avg Hourly Earnings','$',2,'m'), JTSJOL: S('JTSJOL','Job Openings (JOLTS)','K',0,'m'),
    CPIAUCSL: S('CPIAUCSL','CPI (All Urban)','idx',1,'m'),
    CPIYOY: S('CPIAUCNS','CPI Year-over-Year','%',1,'m',{calcYoY:true}),
    CPILFESL: S('CPILFESL','Core CPI','idx',1,'m'), PCEPI: S('PCEPI','PCE Price Index','idx',1,'m'),
    PCEPILFE: S('PCEPILFE','Core PCE','idx',1,'m'),
    PCEYOY: S('PCEPI','PCE Year-over-Year','%',1,'m',{calcYoY:true}),
    PPIACO: S('PPIACO','PPI (All Commodities)','idx',1,'m'), GASREGW: S('GASREGW','Regular Gas Price','$/gal',2,'w'),
    T5YIE: S('T5YIE','5-Yr Breakeven Inflation','%',2,'d'), T10YIE: S('T10YIE','10-Yr Breakeven Inflation','%',2,'d'),
    FEDFUNDS: S('FEDFUNDS','Fed Funds Rate','%',2,'m'), DFF: S('DFF','Effective Fed Funds (Daily)','%',2,'d'),
    DGS2: S('DGS2','2-Year Treasury','%',2,'d'), DGS5: S('DGS5','5-Year Treasury','%',2,'d'),
    DGS10: S('DGS10','10-Year Treasury','%',2,'d'), DGS30: S('DGS30','30-Year Treasury','%',2,'d'),
    T10Y2Y: S('T10Y2Y','10Y-2Y Spread','bps',0,'d',{multiplier:100}),
    T10Y3M: S('T10Y3M','10Y-3M Spread','bps',0,'d',{multiplier:100}),
    MORTGAGE30US: S('MORTGAGE30US','30-Year Mortgage Rate','%',2,'w'),
    WALCL: S('WALCL','Fed Balance Sheet','$M',0,'w'), M2SL: S('M2SL','M2 Money Supply','$B',0,'m'),
    HOUST: S('HOUST','Housing Starts','K',0,'m'), PERMIT: S('PERMIT','Building Permits','K',0,'m'),
    EXHOSLUSM495S: S('EXHOSLUSM495S','Existing Home Sales','K',0,'m'),
    CSUSHPISA: S('CSUSHPISA','Case-Shiller Home Price','idx',1,'m'),
    MSPUS: S('MSPUS','Median Home Sale Price','$',0,'q'), MSACSR: S('MSACSR','Months Supply of Homes','mo',1,'m'),
    RSAFS: S('RSAFS','Retail Sales','$M',0,'m'), UMCSENT: S('UMCSENT','Consumer Sentiment (UMich)','idx',1,'m'),
    PCE: S('PCE','Personal Consumption','$B',0,'m'), PSAVERT: S('PSAVERT','Personal Savings Rate','%',1,'m'),
    DSPIC96: S('DSPIC96','Real Disposable Income','$B',0,'m'), DGORDER: S('DGORDER','Durable Goods Orders','$M',0,'m'),
    BOPGSTB: S('BOPGSTB','Trade Balance','$M',0,'m'), ISMNMAN: S('MANEMP','Manufacturing Employment','K',0,'m'),
    POPTHM: S('POPTHM','US Population','K',0,'m'), POPGROW: S('SPPOPGROWUSA','Population Growth Rate','%',2,'a'),
    FERTILITY: S('SPDYNTFRTINUSA','Fertility Rate','',2,'a'), BIRTHRATE: S('SPDYNCBRTINUSA','Birth Rate (per 1,000)','',1,'a'),
    LIFEEXP: S('SPDYNLE00INUSA','Life Expectancy','yrs',1,'a'), INFANTMORT: S('SPDYNIMRTINUSA','Infant Mortality (per 1,000)','',1,'a'),
    POP65: S('SPPOP65UPTOZSUSA','Population 65+ Share','%',1,'a'), POP014: S('SPPOP0014TOZSUSA','Population 0-14 Share','%',1,'a'),
    WORKAGEPOP: S('LFWA64TTUSM647S','Working Age Pop (15-64)','',0,'m'), CLF16OV: S('CLF16OV','Civilian Labor Force','K',0,'m'),
    NETMIG: S('SMPOPNETMUSA','Net Migration','',0,'a'), POPBEA: S('B230RC0Q173SBEA','Population (BEA, Quarterly)','K',0,'q'),
    APPARELCPI: S('CUSR0000SAA1','CPI: Apparel','idx',1,'m'), FOOTWEARCPI: S('CUSR0000SEAE','CPI: Footwear','idx',1,'m'),
    MENAPPAREL: S('CUUR0000SAA2',"CPI: Men's & Boys' Apparel",'idx',1,'m'),
    FOOTWEARPCE: S('DFXARG3M086SBEA','PCE: Footwear','idx',1,'m'),
    CLOTHRETAIL: S('MRTSSM4481USS','Clothing Store Sales','$M',0,'m'), SHOERETAIL: S('MRTSSM4482USS','Shoe Store Sales','$M',0,'m'),
    ECOMMPCT: S('ECOMPCTSA','E-Commerce % of Retail','%',1,'q'),
    RETAILTRADE: S('CEU4200000001','Retail Trade Employment','K',1,'m'),
    CLOTHINGEMP: S('CEU4244200001','Clothing Store Employment','K',1,'m'),
    YOUTH1624UE: S('LNS14024887','Youth Unemployment (16-24)','%',1,'m'),
    YOUTH1619UE: S('LNS14000012','Teen Unemployment (16-19)','%',1,'m'),
    YOUTH2024UE: S('LNS14000036','Young Adult Unemp (20-24)','%',1,'m'),
    YOUTH1619EMP: S('LNS12000012','Teen Employment (16-19)','K',0,'m'),
    YOUTH2024EMP: S('LNS12000036','Young Adult Emp (20-24)','K',0,'m'),
    REVOLVCREDIT: S('REVOLSL','Revolving Consumer Credit','$B',0,'m'),
    CCBALANCE: S('CCLACBW027SBOG','Credit Card Balances','$B',0,'w'),
    DISCRETPCE: S('PCEDG','Durable Goods PCE','$B',0,'m'),
    FOOTWEARPPI: S('PCU316316','PPI: Footwear Manufacturing','idx',1,'m'),
    GENSALES: S('RSCCAS','Gen Merchandise Sales','$M',0,'m'),
    SP500: S('SP500','S&P 500','',0,'d'), VIXCLS: S('VIXCLS','VIX','',1,'d'),
    DTWEXBGS: S('DTWEXBGS','US Dollar Index (Broad)','idx',1,'d'),
    BAMLH0A0HYM2: S('BAMLH0A0HYM2','HY Credit Spread','bps',0,'d',{multiplier:100}),
    GFDEBTN: S('GFDEBTN','Federal Debt','$M',0,'q'),
    BOGZ1FL073164003Q: S('BOGZ1FL073164003Q','Corporate Profits','$B',0,'q'),
    DCOILWTICO: S('DCOILWTICO','WTI Crude Oil','idx',2,'d'), DCOILBRENTEU: S('DCOILBRENTEU','Brent Crude Oil','idx',2,'d'),
    GOLDAMGBD228NLBM: S('GOLDAMGBD228NLBM','Gold Price (London Fix)','$/oz',2,'d'),
    DHHNGSP: S('DHHNGSP','Henry Hub Natural Gas','$/MMBtu',2,'d'), PCOPPUSDM: S('PCOPPUSDM','Copper Price','$/mt',0,'m'),
    DEXUSEU: S('DEXUSEU','EUR/USD','',4,'d'), DEXJPUS: S('DEXJPUS','USD/JPY','',2,'d'),
    DEXUSUK: S('DEXUSUK','GBP/USD','',4,'d'), DEXCHUS: S('DEXCHUS','USD/CNY','',4,'d'),
    DEXMXUS: S('DEXMXUS','USD/MXN','',2,'d'), DEXKOUS: S('DEXKOUS','USD/KRW','',0,'d'),
    GDEBTPCTGDP: S('GFDEGDQ188S','US Debt-to-GDP','%',1,'q'), NASDAQCOM: S('NASDAQCOM','NASDAQ Composite','',0,'d'),
    CPIGB: S('CPALTT01GBM659N','UK CPI YoY','%',1,'m'), CPICN: S('CPALTT01CNM659N','China CPI YoY','%',1,'m'),
    CPIIN: S('CPALTT01INM659N','India CPI YoY','%',1,'m'), CPIDE: S('CPALTT01DEM659N','Germany CPI YoY','%',1,'m'),
    CPIBR: S('CPALTT01BRM659N','Brazil CPI YoY','%',1,'m'), CPIJP: S('FPCPITOTLZGJPN','Japan CPI','%',1,'a'),
    CPIKR: S('FPCPITOTLZGKOR','South Korea CPI','%',1,'a'),
    UEJP: S('LRUNTTTTJPM156S','Japan Unemployment','%',1,'m'), UEGB: S('LRHUTTTTGBM156S','UK Unemployment','%',1,'m'),
    UEDE: S('LRUNTTTTDEA156S','Germany Unemployment','%',1,'a'),
    RATEEZ: S('IRLTLT01EZM156N','Eurozone 10Y Yield','%',2,'m'), RATEJP: S('IRLTLT01JPM156N','Japan 10Y Yield','%',2,'m'),
    RATEGB: S('IRLTLT01GBM156N','UK 10Y Gilt Yield','%',2,'m'),
  };

  function buildUrl(endpoint, params) {
    const qs = new URLSearchParams({ _endpoint: endpoint, ...params });
    return `${BASE}?${qs.toString()}`;
  }

  async function fetchSeries(seriesId, opts = {}) {
    const limit = opts.limit || 500;
    const sort = opts.sort || 'desc';
    const cacheKey = `${seriesId}_${limit}_${sort}_${opts.startDate || ''}_${opts.endDate || ''}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    const params = {
      series_id: seriesId,
      sort_order: sort,
      limit: limit.toString(),
    };
    if (opts.startDate) params.observation_start = opts.startDate;
    if (opts.endDate) params.observation_end = opts.endDate;

    try {
      const res = await fetch(buildUrl('series/observations', params));
      if (!res.ok) throw new Error(`FRED ${res.status}`);
      const json = await res.json();
      const observations = (json.observations || [])
        .filter(o => o.value !== '.')
        .map(o => ({ date: o.date, value: parseFloat(o.value) }));

      cache.set(cacheKey, { data: observations, ts: Date.now() });
      return observations;
    } catch (err) {
      console.error(`Error fetching ${seriesId}:`, err);
      return [];
    }
  }

  async function getLatest(key) {
    const spec = SERIES[key];
    if (!spec) return null;
    const data = await fetchSeries(spec.id, { limit: 15 });
    if (!data.length) return null;
    let val = data[0].value;
    if (spec.divisor) val /= spec.divisor;
    if (spec.multiplier) val *= spec.multiplier;
    return {
      value: val,
      date: data[0].date,
      formatted: formatValue(val, spec),
      name: spec.name,
      unit: spec.unit,
      raw: data,
    };
  }

  async function getLatestWithChange(key) {
    const spec = SERIES[key];
    if (!spec) return null;
    const data = await fetchSeries(spec.id, { limit: 30 });
    if (data.length < 2) return null;
    let curr = data[0].value;
    let prev = data[1].value;
    if (spec.divisor) { curr /= spec.divisor; prev /= spec.divisor; }
    if (spec.multiplier) { curr *= spec.multiplier; prev *= spec.multiplier; }
    const change = curr - prev;
    const changePct = prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : 0;
    return {
      value: curr,
      prevValue: prev,
      date: data[0].date,
      prevDate: data[1].date,
      change,
      changePct,
      formatted: formatValue(curr, spec),
      changeFormatted: (change >= 0 ? '+' : '') + formatValue(change, spec),
      changePctFormatted: (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%',
      direction: change > 0.001 ? 'up' : change < -0.001 ? 'down' : 'flat',
      name: spec.name,
      unit: spec.unit,
      raw: data,
    };
  }

  async function getTimeSeries(key, opts = {}) {
    const spec = SERIES[key];
    if (!spec) return [];
    const defaultLimit = spec.freq === 'd' ? 5000 : spec.freq === 'w' ? 2000 : 500;
    const limit = opts.limit || defaultLimit;
    const data = await fetchSeries(spec.id, { limit, sort: 'asc', startDate: opts.startDate, endDate: opts.endDate });
    return data.map(d => {
      let val = d.value;
      if (spec.divisor) val /= spec.divisor;
      if (spec.multiplier) val *= spec.multiplier;
      return { date: d.date, value: val };
    });
  }

  async function getYoYChange(key) {
    const spec = SERIES[key];
    if (!spec) return null;
    const data = await fetchSeries(spec.id, { limit: 15, sort: 'desc' });
    if (!data.length) return null;

    const latestDate = new Date(data[0].date + 'T00:00:00');
    const targetDate = new Date(latestDate);
    targetDate.setFullYear(targetDate.getFullYear() - 1);
    targetDate.setDate(targetDate.getDate() + 15);
    const endDateStr = targetDate.toISOString().slice(0, 10);

    const dataOld = await fetchSeries(spec.id, {
      limit: 5,
      sort: 'desc',
      endDate: endDateStr,
    });
    if (!dataOld.length) return null;

    const curr = data[0].value;
    const yearAgo = dataOld[0].value;
    const yoy = ((curr - yearAgo) / yearAgo) * 100;

    let prevYoY = null;
    if (data.length >= 2 && dataOld.length >= 2) {
      prevYoY = ((data[1].value - dataOld[1].value) / dataOld[1].value) * 100;
    }
    const direction = prevYoY !== null ? (yoy > prevYoY + 0.05 ? 'up' : yoy < prevYoY - 0.05 ? 'down' : 'flat') : 'flat';

    return {
      value: yoy,
      formatted: yoy.toFixed(1) + '%',
      current: curr,
      yearAgo,
      date: data[0].date,
      name: spec.name,
      unit: spec.unit,
      direction,
    };
  }

  async function getReleases() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const nextWeek = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const url = buildUrl('releases/dates', {
        include_release_dates_with_no_data: 'true',
        sort_order: 'asc',
      });
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.release_dates || []).slice(0, 30);
    } catch (err) {
      console.error('Error fetching releases:', err);
      return [];
    }
  }

  function formatValue(val, spec) {
    const d = spec.decimals ?? 1;
    let s = Math.abs(val) >= 1000
      ? val.toLocaleString('en-US', { maximumFractionDigits: d })
      : val.toFixed(d);
    if (spec.unit && spec.unit !== '%' && spec.unit !== 'idx' && spec.unit !== '' && spec.unit !== 'bps') {
      if (spec.unit.startsWith('$')) {
        const suffix = spec.unit.slice(1);
        return '$' + s + (suffix ? suffix : '');
      }
      return s + ' ' + spec.unit;
    }
    if (spec.unit === '%') return s + '%';
    if (spec.unit === 'bps') return s + ' bps';
    return s;
  }

  function getSpec(key) { return SERIES[key]; }

  function sourceUrl(key) {
    const spec = SERIES[key];
    return spec ? `https://fred.stlouisfed.org/series/${spec.id}` : '#';
  }

  function clearCache() { cache.clear(); }

  function seriesName(key) {
    const spec = SERIES[key];
    return spec ? spec.name : key;
  }

  return {
    SERIES,
    fetchSeries,
    getLatest,
    getLatestWithChange,
    getTimeSeries,
    getYoYChange,
    getReleases,
    getSpec,
    formatValue,
    sourceUrl,
    seriesName,
    clearCache,
  };
})();

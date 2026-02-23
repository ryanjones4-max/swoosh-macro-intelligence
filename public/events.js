const Events = (() => {
  async function getUpcomingReleases() {
    try {
      const releases = await FRED.getReleases();
      return releases.map(r => ({
        date: r.date,
        title: r.release_name || r.release_id,
        releaseId: r.release_id,
        type: 'data',
      }));
    } catch { return []; }
  }

  function getEconomicCalendar() {
    const today = new Date();
    const events = [];

    const fedMeetings2026 = [
      { start: '2026-01-27', end: '2026-01-28' },
      { start: '2026-03-17', end: '2026-03-18' },
      { start: '2026-05-05', end: '2026-05-06' },
      { start: '2026-06-16', end: '2026-06-17' },
      { start: '2026-07-28', end: '2026-07-29' },
      { start: '2026-09-15', end: '2026-09-16' },
      { start: '2026-10-27', end: '2026-10-28' },
      { start: '2026-12-15', end: '2026-12-16' },
    ];

    fedMeetings2026.forEach(m => {
      events.push({
        date: m.end,
        title: 'FOMC Rate Decision',
        desc: `Federal Reserve meeting concludes. Interest rate decision and statement released.`,
        type: 'fed',
        tag: 'Fed Policy',
      });
    });

    const recurringMonthly = [
      { day: 'first-friday', title: 'Employment Situation Report', desc: 'Nonfarm payrolls, unemployment rate, and wage growth data from BLS.', type: 'data', tag: 'Labor' },
      { day: 10, title: 'CPI Report', desc: 'Consumer Price Index measuring inflation at the consumer level.', type: 'data', tag: 'Inflation' },
      { day: 14, title: 'PPI Report', desc: 'Producer Price Index measuring wholesale inflation.', type: 'data', tag: 'Inflation' },
      { day: 15, title: 'Retail Sales', desc: 'Monthly retail and food services sales data.', type: 'data', tag: 'Consumer' },
      { day: 16, title: 'Industrial Production', desc: 'Output of factories, mines, and utilities.', type: 'data', tag: 'Growth' },
      { day: 25, title: 'GDP Estimate', desc: 'Quarterly GDP advance/preliminary/final estimate.', type: 'data', tag: 'Growth' },
      { day: 26, title: 'PCE Price Index', desc: 'Fed\'s preferred inflation measure — personal consumption expenditures.', type: 'data', tag: 'Inflation' },
      { day: 27, title: 'Consumer Sentiment (UMich)', desc: 'University of Michigan consumer sentiment final reading.', type: 'data', tag: 'Consumer' },
    ];

    for (let m = 0; m < 6; m++) {
      const month = new Date(today.getFullYear(), today.getMonth() + m, 1);
      recurringMonthly.forEach(ev => {
        let day;
        if (ev.day === 'first-friday') {
          const first = new Date(month.getFullYear(), month.getMonth(), 1);
          const dow = first.getDay();
          day = dow <= 5 ? (5 - dow + 1) : (5 + 7 - dow + 1);
        } else {
          day = ev.day;
        }
        const evDate = new Date(month.getFullYear(), month.getMonth(), day);
        if (evDate >= new Date(today.toDateString())) {
          events.push({
            date: evDate.toISOString().slice(0, 10),
            title: ev.title,
            desc: ev.desc,
            type: ev.type,
            tag: ev.tag,
          });
        }
      });
    }

    const keyEvents2026 = [
      { date: '2026-01-20', title: 'Debt Ceiling Deadline', desc: 'Congressional deadline to raise or suspend the federal debt ceiling.', type: 'fiscal', tag: 'Fiscal' },
      { date: '2026-04-15', title: 'Tax Filing Deadline', desc: 'Federal income tax filing deadline. Government revenue surge.', type: 'fiscal', tag: 'Fiscal' },
      { date: '2026-10-01', title: 'New Fiscal Year Begins', desc: 'FY2027 starts. Any continuing resolutions or government shutdown risk.', type: 'fiscal', tag: 'Fiscal' },
    ];

    events.push(...keyEvents2026);

    events.sort((a, b) => a.date.localeCompare(b.date));
    return events;
  }

  function getDailyBriefing(data) {
    const briefCfg = [
      ['UNRATE', 'Labor Market', d => {
        const t = d.direction === 'up' ? 'rose' : d.direction === 'down' ? 'fell' : 'held steady';
        return [`Unemployment ${t} to ${d.formatted}`, `Rate ${t} at ${d.formatted}, ${d.direction === 'up' ? 'signaling softening' : d.direction === 'down' ? 'showing strength' : 'stable'}.`, d.direction === 'down' ? 'positive' : d.direction === 'up' ? 'negative' : 'neutral'];
      }],
      ['GDPGROWTH', 'Growth', d => {
        const s = d.value > 3 ? 'strong' : d.value > 1.5 ? 'moderate' : d.value > 0 ? 'slow' : 'contracting';
        return [`GDP growth at ${d.formatted} — ${s}`, `Real GDP grew at ${d.formatted} annualized.`, d.value > 2 ? 'positive' : d.value > 0 ? 'neutral' : 'negative'];
      }],
      ['DFF', 'Monetary Policy', d => [`Fed Funds rate at ${d.formatted}`, `Rate at ${d.formatted}. ${d.value > 5 ? 'Policy tight.' : d.value > 3 ? 'Elevated, nearing cycle end.' : 'Accommodative.'}`, 'neutral']],
      ['T10Y2Y', 'Rates', d => {
        const inv = d.value < 0;
        return [`Yield curve ${inv ? 'inverted' : 'positive'} at ${d.formatted}`, `10Y-2Y spread at ${d.formatted}. ${inv ? 'Inversion historically precedes recession.' : 'Normal term structure.'}`, inv ? 'negative' : 'positive'];
      }],
      ['CPIYOY', 'Inflation', d => [`CPI at ${d.formatted} YoY`, `${d.value > 4 ? 'Well above 2% target.' : d.value > 2.5 ? 'Moderating, above target.' : 'Near 2% target.'}`, d.value > 4 ? 'negative' : d.value > 2.5 ? 'neutral' : 'positive']],
      ['VIXCLS', 'Markets', d => [`VIX at ${d.formatted}`, `${d.value > 30 ? 'Elevated fear.' : d.value > 20 ? 'Moderate volatility.' : 'Calm markets.'}`, d.value > 25 ? 'negative' : d.value > 18 ? 'neutral' : 'positive']],
      ['MORTGAGE30US', 'Housing', d => [`30-yr mortgage at ${d.formatted}`, `${d.value > 7 ? 'Freezing housing market.' : d.value > 6 ? 'Weighing on demand.' : 'Easing, unlocking demand.'}`, d.value > 7 ? 'negative' : d.value > 6 ? 'neutral' : 'positive']],
      ['BOPGSTB', 'Trade', d => [`Trade balance at ${d.formatted}`, `${d.value < -60 ? 'Large deficit reflects import demand.' : 'Gap manageable.'}`, d.value < -80 ? 'negative' : 'neutral']],
    ];
    return briefCfg.filter(([k]) => data[k]).map(([k, cat, fn]) => {
      const [headline, body, sentiment] = fn(data[k]);
      return { headline, body, sentiment, category: cat };
    });
  }

  function getRecessionIndicators(data) {
    const cfgs = [
      ['T10Y2Y', 'Yield Curve (10Y-2Y)', d => d.value < 0, 'Inverted — precedes recession', 'Normal term structure'],
      ['UNRATE', 'Unemployment Trend', d => d.direction === 'up', 'Rising — Sahm Rule watch', 'Stable or falling'],
      ['GDPGROWTH', 'GDP Growth', d => d.value < 0 ? 'danger' : d.value < 1 ? 'warning' : 'ok', d => d.value < 0 ? 'Contraction' : d.value < 1 ? 'Below trend' : 'Healthy', null],
      ['ICSA', 'Initial Jobless Claims', d => d.value > 300, 'Elevated — stress', 'Low — strong market'],
      ['UMCSENT', 'Consumer Sentiment', d => d.value < 65, 'Depressed', 'Reasonable confidence'],
    ];
    return cfgs.filter(([k]) => data[k]).map(([k, name, test, warn, ok]) => {
      const d = data[k];
      if (typeof test(d) === 'string') return { name, value: d.formatted, signal: test(d), detail: typeof warn === 'function' ? warn(d) : warn };
      const bad = test(d);
      return { name, value: d.formatted, signal: bad ? 'warning' : 'ok', detail: bad ? warn : ok };
    });
  }

  function computeHealthScore(data) {
    const rules = [
      ['GDPGROWTH', 'GDP Growth', 0.25, v => v > 3 ? 90 : v > 2 ? 75 : v > 1 ? 55 : v > 0 ? 35 : 15],
      ['UNRATE', 'Employment', 0.2, v => v < 3.5 ? 90 : v < 4.5 ? 75 : v < 5.5 ? 55 : v < 7 ? 35 : 15],
      ['CPIYOY', 'Inflation', 0.2, v => { const d = Math.abs(v - 2); return d < 0.5 ? 90 : d < 1.5 ? 70 : d < 3 ? 45 : 20; }],
      ['UMCSENT', 'Sentiment', 0.15, v => v > 90 ? 85 : v > 75 ? 70 : v > 60 ? 50 : v > 45 ? 30 : 15],
      ['T10Y2Y', 'Yield Curve', 0.1, v => v > 100 ? 80 : v > 0 ? 65 : v > -50 ? 40 : 20],
      ['VIXCLS', 'Volatility', 0.1, v => v < 15 ? 80 : v < 20 ? 65 : v < 25 ? 45 : v < 35 ? 25 : 10],
    ];
    let score = 50;
    const factors = {};
    for (const [k, name, weight, fn] of rules) {
      if (!data[k]) continue;
      const s = fn(data[k].value);
      factors[name] = s;
      score += (s - 50) * weight;
    }
    return { score: Math.round(Math.max(0, Math.min(100, score))), factors };
  }

  return { getUpcomingReleases, getEconomicCalendar, getDailyBriefing, getRecessionIndicators, computeHealthScore };
})();

const Charts = (() => {
  const defaultColors = {
    blue:   { line: '#3b82f6', fill: 'rgba(59,130,246,0.08)' },
    green:  { line: '#22c55e', fill: 'rgba(34,197,94,0.08)' },
    red:    { line: '#ef4444', fill: 'rgba(239,68,68,0.08)' },
    purple: { line: '#a855f7', fill: 'rgba(168,85,247,0.08)' },
    cyan:   { line: '#06b6d4', fill: 'rgba(6,182,212,0.08)' },
    orange: { line: '#f97316', fill: 'rgba(249,115,22,0.08)' },
    yellow: { line: '#eab308', fill: 'rgba(234,179,8,0.08)' },
    white:  { line: '#94a3b8', fill: 'rgba(148,163,184,0.06)' },
  };

  const crosshairPlugin = {
    id: 'crosshair',
    afterDraw(chart) {
      const active = chart.tooltip?.getActiveElements();
      if (active && active.length) {
        const x = active[0].element.x;
        const ctx = chart.ctx;
        const yAxis = chart.scales.y;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, yAxis.top);
        ctx.lineTo(x, yAxis.bottom);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx.stroke();
        ctx.restore();
      }
    },
  };

  function buildOpts(opts) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      hover: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: opts.showLegend
          ? { display: true, labels: { color: '#8892a4', font: { family: 'Inter', size: 11 }, boxWidth: 12, padding: 16 } }
          : { display: false },
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
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            title(items) {
              if (!items.length) return '';
              const raw = items[0].raw;
              if (raw && raw.x) {
                const d = new Date(raw.x + 'T00:00:00');
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              }
              return items[0].label || '';
            },
            label(item) {
              const label = item.dataset.label || '';
              const val = typeof item.raw?.y === 'number' ? item.raw.y.toLocaleString('en-US', { maximumFractionDigits: 2 }) : item.formattedValue;
              return label ? `${label}: ${val}` : val;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          grid: { color: 'rgba(30,36,51,0.6)', drawBorder: false },
          ticks: { color: '#5a6478', font: { family: 'Inter', size: 10 }, maxTicksLimit: 8 },
          border: { display: false },
        },
        y: {
          grid: { color: 'rgba(30,36,51,0.6)', drawBorder: false },
          ticks: { color: '#5a6478', font: { family: 'Inter', size: 10 }, maxTicksLimit: 6 },
          border: { display: false },
          ...(opts.yLabel ? { title: { display: true, text: opts.yLabel, color: '#5a6478', font: { family: 'Inter', size: 10 } } } : {}),
          ...(opts.yMin !== undefined ? { min: opts.yMin } : {}),
          ...(opts.yMax !== undefined ? { max: opts.yMax } : {}),
          ...(opts.stacked ? { stacked: true } : {}),
        },
      },
    };
  }

  function decimate(data, maxPoints) {
    if (!data || data.length <= maxPoints) return data;
    const step = Math.ceil(data.length / maxPoints);
    const result = [];
    for (let i = 0; i < data.length; i += step) {
      result.push(data[i]);
    }
    if (result[result.length - 1] !== data[data.length - 1]) {
      result.push(data[data.length - 1]);
    }
    return result;
  }

  const MAX_POINTS = 1500;

  function createLine(canvasId, data, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const color = defaultColors[opts.color || 'blue'];
    const chartOpts = buildOpts(opts);

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.offsetHeight || 280);
    gradient.addColorStop(0, color.fill);
    gradient.addColorStop(1, 'transparent');

    const datasets = Array.isArray(data[0]) ? data.map((d, i) => {
      const c = defaultColors[opts.colors?.[i] || Object.keys(defaultColors)[i] || 'blue'];
      const g = ctx.createLinearGradient(0, 0, 0, canvas.parentElement?.offsetHeight || 280);
      g.addColorStop(0, c.fill);
      g.addColorStop(1, 'transparent');
      const decimated = decimate(d, MAX_POINTS);
      return {
        label: opts.labels?.[i] || `Series ${i + 1}`,
        data: decimated.map(p => ({ x: p.date, y: p.value })),
        borderColor: c.line,
        backgroundColor: opts.noFill ? 'transparent' : g,
        fill: !opts.noFill,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 8,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: c.line,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      };
    }) : (() => {
      const decimated = decimate(data, MAX_POINTS);
      return [{
        label: opts.label || 'Value',
        data: decimated.map(p => ({ x: p.date, y: p.value })),
        borderColor: color.line,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 8,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color.line,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }];
    })();

    return new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: chartOpts,
      plugins: [crosshairPlugin],
    });
  }

  function createBar(canvasId, data, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const color = defaultColors[opts.color || 'blue'];
    const chartOpts = buildOpts(opts);

    const colors = data.map(p => {
      if (opts.conditionalColor) {
        return p.value >= 0 ? defaultColors.green.line : defaultColors.red.line;
      }
      return color.line;
    });

    return new Chart(ctx, {
      type: 'bar',
      data: {
        datasets: [{
          label: opts.label || 'Value',
          data: data.map(p => ({ x: p.date, y: p.value })),
          backgroundColor: colors.map(c => c + '80'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: chartOpts,
      plugins: [crosshairPlugin],
    });
  }

  function createSparkline(canvasId, data, opts = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const color = defaultColors[opts.color || 'blue'];

    const gradient = ctx.createLinearGradient(0, 0, 0, 48);
    gradient.addColorStop(0, color.fill);
    gradient.addColorStop(1, 'transparent');

    return new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          data: data.map(p => ({ x: p.date, y: p.value })),
          borderColor: color.line,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          borderWidth: 1.5,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false, type: 'time' },
          y: { display: false },
        },
      },
    });
  }

  function destroyAll() {
    Object.values(Chart.instances).forEach(c => c.destroy());
  }

  return { createLine, createBar, createSparkline, destroyAll, defaultColors };
})();

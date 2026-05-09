/**
 * assets/charts.js
 *
 * Renders five live charts from data/workouts.json + data/days.json using Chart.js.
 *
 *   1. Run pace at HR        (scatter — date × pace, colored by HR bucket)
 *   2. Run cadence            (line + reference line at cadence target)
 *   3. Swim pace per 100yd    (line)
 *   4. Recovery               (resting HR + HRV on dual axes)
 *   5. Weekly volume by sport (stacked bar — swim/bike/run minutes per week)
 *
 * Chart.js is loaded via CDN <script> tag in index.html.
 */

const TRAINING_START = '2026-03-22';   // Day 1 of the plan
const CADENCE_TARGET = 145;            // Min cadence target

// HR buckets for the run pace-at-HR scatter — one color per intensity zone.
const HR_BUCKETS = [
  { max: 140, label: 'HR ≤140 (Z1)',    color: '#1D9E75' },
  { max: 150, label: 'HR 141–150 (Z2)', color: '#7BB661' },
  { max: 160, label: 'HR 151–160 (Z3)', color: '#BA7517' },
  { max: 999, label: 'HR >160 (Z4+)',   color: '#A32D2D' },
];

const COLOR = {
  run: '#A32D2D',
  bike: '#BA7517',
  swim: '#1D9E75',
  hrv: '#534AB7',
};

(async function renderCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('[charts] Chart.js not loaded — skipping chart rendering.');
    return;
  }

  let workouts, days;
  try {
    const [wRes, dRes] = await Promise.all([
      fetch('data/workouts.json', { cache: 'no-store' }),
      fetch('data/days.json',     { cache: 'no-store' }),
    ]);
    if (!wRes.ok) throw new Error(`workouts HTTP ${wRes.status}`);
    workouts = await wRes.json();
    days     = dRes.ok ? await dRes.json() : [];
  } catch (err) {
    console.warn('[charts] Could not load data files — skipping charts.', err);
    return;
  }

  if (!Array.isArray(workouts) || workouts.length === 0) return;

  applyChartDefaults();
  renderRunPaceAtHrChart(workouts);
  renderCadenceChart(workouts);
  renderSwimPaceChart(workouts);
  renderRecoveryChart(days);
  renderWeeklyVolumeChart(workouts);
})();

// ---------- Theme ----------------------------------------------------------

function applyChartDefaults() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  Chart.defaults.color = isDark ? '#9a9893' : '#6b6b68';
  Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  Chart.defaults.font.family = "'Barlow', sans-serif";
  Chart.defaults.font.size = 11;
}

// ---------- 1. Run pace at HR (scatter) ------------------------------------

function renderRunPaceAtHrChart(workouts) {
  const canvas = document.getElementById('chart-run-pace-hr');
  if (!canvas) return;

  const runs = workouts
    .filter((w) => w.sport === 'run' && w.pace && w.hr && w.hr.avg != null)
    .map((w) => {
      const secPerMi = paceToSecPerMi(w.pace);
      if (secPerMi == null) return null;
      return {
        x: dateToDayNumber(w.date),
        y: secPerMi,
        date: w.date,
        hr: Math.round(w.hr.avg),
      };
    })
    .filter(Boolean);

  if (runs.length === 0) return;

  const datasets = HR_BUCKETS.map((bucket, i) => {
    const prevMax = i === 0 ? 0 : HR_BUCKETS[i - 1].max;
    const points = runs.filter((r) => r.hr > prevMax && r.hr <= bucket.max);
    return {
      label: bucket.label,
      data: points,
      backgroundColor: bucket.color,
      borderColor: bucket.color,
      pointRadius: 5,
      pointHoverRadius: 7,
    };
  }).filter((ds) => ds.data.length > 0);

  new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.raw?.date || '',
            label: (ctx) => `${formatPaceFromSec(ctx.parsed.y)}/mi · HR ${ctx.raw.hr}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Day of plan' },
          grid: { display: false },
          ticks: { precision: 0 },
        },
        y: {
          reverse: true,  // Lower seconds = faster, so reverse so "up" = improvement
          title: { display: true, text: 'Pace /mi' },
          ticks: { callback: (v) => formatPaceFromSec(v) },
        },
      },
    },
  });
}

// ---------- 2. Run cadence (line) -----------------------------------------

function renderCadenceChart(workouts) {
  const canvas = document.getElementById('chart-cadence');
  if (!canvas) return;

  const runs = workouts
    .filter((w) => w.sport === 'run' && w.cadence != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (runs.length === 0) return;

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: runs.map((w) => formatShortDate(w.date)),
      datasets: [
        {
          label: 'Cadence',
          data: runs.map((w) => Math.round(w.cadence)),
          borderColor: COLOR.run,
          backgroundColor: hexToRgba(COLOR.run, 0.12),
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
        },
        referenceLine(runs.length, CADENCE_TARGET, `Target ${CADENCE_TARGET}`, COLOR.run),
      ],
    },
    options: lineChartOptions({
      yLabel: 'spm',
      yMin: 115,
      yMax: 160,
      tooltipUnit: 'spm',
    }),
  });
}

// ---------- 3. Swim pace per 100yd (line) ----------------------------------

function renderSwimPaceChart(workouts) {
  const canvas = document.getElementById('chart-swim-pace');
  if (!canvas) return;

  const swims = workouts
    .filter((w) => w.sport === 'swim' && w.pace)
    .map((w) => ({
      date: w.date,
      secPer100yd: swimPaceToSecPer100yd(w.pace),
    }))
    .filter((s) => s.secPer100yd != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (swims.length === 0) return;

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: swims.map((s) => formatShortDate(s.date)),
      datasets: [
        {
          label: 'Pace /100yd',
          data: swims.map((s) => s.secPer100yd),
          borderColor: COLOR.swim,
          backgroundColor: hexToRgba(COLOR.swim, 0.12),
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => `${formatPaceFromSec(ctx.parsed.y)}/100yd` },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          reverse: true,
          title: { display: true, text: 'Pace /100yd' },
          ticks: { callback: (v) => formatPaceFromSec(v) },
        },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

// ---------- 4. Recovery (dual-axis: resting HR + HRV) ----------------------

function renderRecoveryChart(days) {
  const canvas = document.getElementById('chart-recovery');
  if (!canvas || !Array.isArray(days)) return;

  const points = days
    .filter((d) => d.heart && (d.heart.restingHr != null || d.heart.hrv != null))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) return;

  const hasRestingHr = points.some((d) => d.heart.restingHr != null);
  const hasHrv       = points.some((d) => d.heart.hrv != null);

  const datasets = [];
  if (hasRestingHr) {
    datasets.push({
      label: 'Resting HR',
      data: points.map((d) => d.heart.restingHr ?? null),
      borderColor: COLOR.run,
      backgroundColor: hexToRgba(COLOR.run, 0.12),
      tension: 0.25,
      pointRadius: 2,
      pointHoverRadius: 4,
      yAxisID: 'y',
      spanGaps: true,
    });
  }
  if (hasHrv) {
    datasets.push({
      label: 'HRV',
      data: points.map((d) => d.heart.hrv ?? null),
      borderColor: COLOR.hrv,
      backgroundColor: hexToRgba(COLOR.hrv, 0.12),
      tension: 0.25,
      pointRadius: 2,
      pointHoverRadius: 4,
      yAxisID: 'y1',
      spanGaps: true,
    });
  }

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map((d) => formatShortDate(d.date)),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, padding: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const unit = ctx.dataset.label === 'HRV' ? 'ms' : 'bpm';
              return `${ctx.dataset.label}: ${ctx.parsed.y} ${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 10 },
        },
        y: {
          position: 'left',
          title: { display: true, text: 'Resting HR (bpm)' },
        },
        y1: {
          position: 'right',
          title: { display: true, text: 'HRV (ms)' },
          grid: { drawOnChartArea: false },
        },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

// ---------- 5. Weekly volume by sport (stacked bar) ------------------------

function renderWeeklyVolumeChart(workouts) {
  const canvas = document.getElementById('chart-weekly-volume');
  if (!canvas) return;

  const weeks = {};
  for (const w of workouts) {
    if (w.durationMin == null) continue;
    const idx = weekIndex(w.date, TRAINING_START);
    if (!weeks[idx]) weeks[idx] = { swim: 0, bike: 0, run: 0 };
    if (['swim', 'bike', 'run'].includes(w.sport)) {
      weeks[idx][w.sport] += w.durationMin;
    }
  }

  const sortedIdx = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  if (sortedIdx.length === 0) return;

  const first = sortedIdx[0];
  const last = sortedIdx[sortedIdx.length - 1];
  const labels = [], swim = [], bike = [], run = [];
  for (let i = first; i <= last; i++) {
    const w = weeks[i] || { swim: 0, bike: 0, run: 0 };
    labels.push(`W${i + 1}`);
    swim.push(Math.round(w.swim));
    bike.push(Math.round(w.bike));
    run.push(Math.round(w.run));
  }

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Swim', data: swim, backgroundColor: COLOR.swim },
        { label: 'Bike', data: bike, backgroundColor: COLOR.bike },
        { label: 'Run',  data: run,  backgroundColor: COLOR.run  },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, padding: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} min` },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: 'Minutes' },
        },
      },
    },
  });
}

// ---------- Shared options + helpers ---------------------------------------

function lineChartOptions({ yLabel, yMin, yMax, tooltipUnit }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 10, padding: 10, font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.dataset.isReference) return null;
            return `${ctx.dataset.label}: ${ctx.parsed.y} ${tooltipUnit}`;
          },
        },
      },
    },
    scales: {
      y: {
        suggestedMin: yMin,
        suggestedMax: yMax,
        title: { display: !!yLabel, text: yLabel },
      },
      x: {
        grid: { display: false },
        ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
      },
    },
    interaction: { intersect: false, mode: 'index' },
  };
}

function referenceLine(n, value, label, color) {
  return {
    label,
    data: new Array(n).fill(value),
    borderColor: hexToRgba(color, 0.5),
    borderDash: [4, 4],
    borderWidth: 1,
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    isReference: true,
  };
}

// ---------- Pace conversions ------------------------------------------------

/** "6:47 /km" → seconds per mile. */
function paceToSecPerMi(paceStr) {
  if (!paceStr) return null;
  const km = paceStr.match(/(\d+):(\d+)\s*\/km/i);
  if (km) {
    const secPerKm = parseInt(km[1], 10) * 60 + parseInt(km[2], 10);
    return Math.round(secPerKm * 1.609344);
  }
  const mi = paceStr.match(/(\d+):(\d+)\s*\/mi/i);
  if (mi) return parseInt(mi[1], 10) * 60 + parseInt(mi[2], 10);
  return null;
}

/** "2:35 /100m" → seconds per 100yd. */
function swimPaceToSecPer100yd(paceStr) {
  if (!paceStr) return null;
  const m = paceStr.match(/(\d+):(\d+)\s*\/100m/i);
  if (m) {
    const secPer100m = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return Math.round(secPer100m * 0.9144);
  }
  const yd = paceStr.match(/(\d+):(\d+)\s*\/100yd/i);
  if (yd) return parseInt(yd[1], 10) * 60 + parseInt(yd[2], 10);
  return null;
}

/** Seconds → "M:SS" string. */
function formatPaceFromSec(totalSec) {
  if (totalSec == null) return '';
  const s = Math.round(totalSec);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ---------- Date helpers ----------------------------------------------------

function formatShortDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateToDayNumber(iso) {
  const start = new Date(TRAINING_START + 'T12:00:00');
  const date = new Date(iso + 'T12:00:00');
  return Math.floor((date - start) / (1000 * 60 * 60 * 24)) + 1;
}

function weekIndex(dateStr, startStr) {
  const start = new Date(startStr + 'T12:00:00');
  const date = new Date(dateStr + 'T12:00:00');
  const diffDays = Math.floor((date - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, Math.floor(diffDays / 7));
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

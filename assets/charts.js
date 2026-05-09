/**
 * assets/charts.js
 *
 * Renders three live charts from data/workouts.json using Chart.js:
 *   1. Run HR over time         (line + reference line at HR ceiling)
 *   2. Run cadence over time    (line + reference line at cadence target)
 *   3. Weekly volume by sport   (stacked bar — swim/bike/run minutes per week)
 *
 * Chart.js is loaded via CDN <script> tag in index.html.
 */

const TRAINING_START = '2026-03-22';   // Day 1 of the plan
const RUN_HR_CEILING = 150;            // Easy-run HR ceiling (your declared target)
const CADENCE_TARGET = 145;            // Min cadence target (your declared target)

// Brand colors — match index.html CSS variables.
const COLOR = {
  run: '#A32D2D',
  bike: '#BA7517',
  swim: '#1D9E75',
};

(async function renderCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('[charts] Chart.js not loaded — skipping chart rendering.');
    return;
  }

  let workouts;
  try {
    const res = await fetch('data/workouts.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    workouts = await res.json();
  } catch (err) {
    console.warn('[charts] Could not load workouts.json — skipping charts.', err);
    return;
  }

  if (!Array.isArray(workouts) || workouts.length === 0) return;

  applyChartDefaults();
  renderRunHrChart(workouts);
  renderCadenceChart(workouts);
  renderWeeklyVolumeChart(workouts);
})();

// ---------- Theme integration ----------------------------------------------

function applyChartDefaults() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  Chart.defaults.color = isDark ? '#9a9893' : '#6b6b68';
  Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  Chart.defaults.font.family = "'Barlow', sans-serif";
  Chart.defaults.font.size = 11;
}

// ---------- Charts ----------------------------------------------------------

function renderRunHrChart(workouts) {
  const canvas = document.getElementById('chart-run-hr');
  if (!canvas) return;

  const runs = workouts
    .filter((w) => w.sport === 'run' && w.hr && w.hr.avg != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (runs.length === 0) return;

  const labels = runs.map((w) => formatShortDate(w.date));
  const data = runs.map((w) => w.hr.avg);

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Avg HR',
          data,
          borderColor: COLOR.run,
          backgroundColor: hexToRgba(COLOR.run, 0.12),
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
        },
        referenceLine(runs.length, RUN_HR_CEILING, `Ceiling ${RUN_HR_CEILING}`, COLOR.run),
      ],
    },
    options: lineChartOptions({
      yLabel: 'bpm',
      yMin: 130,
      yMax: 170,
      tooltipUnit: 'bpm',
    }),
  });
}

function renderCadenceChart(workouts) {
  const canvas = document.getElementById('chart-cadence');
  if (!canvas) return;

  const runs = workouts
    .filter((w) => w.sport === 'run' && w.cadence != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (runs.length === 0) return;

  const labels = runs.map((w) => formatShortDate(w.date));
  const data = runs.map((w) => Math.round(w.cadence));

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Cadence',
          data,
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

function renderWeeklyVolumeChart(workouts) {
  const canvas = document.getElementById('chart-weekly-volume');
  if (!canvas) return;

  // Bucket workouts into 7-day weeks starting from TRAINING_START.
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

  // Fill any gap weeks so the x-axis stays continuous.
  const first = sortedIdx[0];
  const last = sortedIdx[sortedIdx.length - 1];
  const labels = [];
  const swim = [];
  const bike = [];
  const run = [];

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
            // Suppress tooltip for the flat reference line
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
        ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
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

function formatShortDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

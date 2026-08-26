/**
 * assets/charts.js
 *
 * Renders nine live charts from the decrypted workouts + days payload using Chart.js.
 *
 *   1. Run pace at HR        (scatter — date × pace, colored by HR bucket)
 *   2. Run cadence            (line + reference line at cadence target)
 *   3. Swim pace per 100yd    (line)
 *   4. Recovery               (resting HR + HRV on dual axes)
 *   5. Weekly volume by sport (stacked bar — swim/bike/run minutes per week)
 *   6. Zone-2 ceiling compliance (bar — % of runs under the HR ceiling, weekly)
 *   7. Readiness           (Body Battery low→high range + Garmin sleep score)
 *   8. Training load       (acute vs chronic load + acute:chronic ratio)
 *   9. Aerobic efficiency  (metres per heartbeat across runs)
 *
 * Data does NOT come from fetch: crypto-gate.js decrypts data/*.enc after the
 * visitor supplies the passphrase and hands it over via window.IronmanData.
 *
 * Chart.js is loaded via CDN <script> tag in index.html.
 */

const TRAINING_START = '2026-03-22';   // Day 1 of the plan
const CADENCE_TARGET = 145;            // Min cadence target
const HR_CEILING     = 150;            // Easy-run HR ceiling from the plan

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

  // Data arrives decrypted from crypto-gate.js rather than by fetch — the
  // published files are ciphertext and there is nothing here to fetch in the
  // clear. This resolves only after the visitor's passphrase succeeds.
  let workouts, days;
  try {
    ({ workouts, days } = await window.IronmanData.ready);
  } catch (err) {
    console.warn('[charts] Data never unlocked — skipping charts.', err);
    return;
  }

  if (!Array.isArray(workouts) || workouts.length === 0) return;

  applyChartDefaults();
  renderRunPaceAtHrChart(workouts);
  renderCadenceChart(workouts);
  renderSwimPaceChart(workouts);
  renderRecoveryChart(days);
  renderWeeklyVolumeChart(workouts);
  renderZone2ComplianceChart(workouts);
  renderReadinessChart(days);
  renderTrainingLoadChart(days);
  renderEfficiencyChart(workouts);
})();

// ---------- Gap handling ----------------------------------------------------
//
// Garmin holds nothing between 2026-05-09 and 2026-07-21, so plotting only the
// days that HAVE data puts 05-08 and 07-22 side by side and draws a confident
// straight line across ten missing weeks. Every day-series chart is built on a
// continuous calendar spine instead, with missing days as nulls and spanGaps
// off, so the hole reads as a hole.

function calendarSpine(days) {
  const withDate = days.filter((d) => d && d.date).sort((a, b) => a.date.localeCompare(b.date));
  if (withDate.length === 0) return [];
  const byDate = new Map(withDate.map((d) => [d.date, d]));
  const out = [];
  const cur = new Date(withDate[0].date + 'T00:00:00Z');
  const end = new Date(withDate[withDate.length - 1].date + 'T00:00:00Z');
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    out.push({ date: iso, day: byDate.get(iso) || null });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

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

  // Continuous calendar, not just the days with readings — see calendarSpine.
  const spine = calendarSpine(days);
  if (spine.length === 0) return;
  const points = spine.map((s) => ({
    date: s.date,
    heart: (s.day && s.day.heart) || {},
  }));

  const hasRestingHr = points.some((d) => d.heart.restingHr != null);
  const hasHrv       = points.some((d) => d.heart.hrv != null);
  if (!hasRestingHr && !hasHrv) return;

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
      spanGaps: false,
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
      spanGaps: false,
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

// ---------- 6. Zone-2 ceiling compliance (bar) ------------------------------
//
// The plan says every easy run sits under 150 bpm. It has not, since April.
// A scatter of individual runs lets a bad week hide among good ones; the
// weekly percentage does not, which is the entire point of this chart.

function renderZone2ComplianceChart(workouts) {
  const canvas = document.getElementById('chart-z2');
  if (!canvas) return;

  const runs = workouts.filter((w) => w.sport === 'run' && w.hr && w.hr.avg != null);
  if (runs.length === 0) return;

  const weeks = new Map();
  for (const w of runs) {
    const wk = weekIndex(w.date, TRAINING_START);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk).push(w.hr.avg);
  }

  const keys = [...weeks.keys()].sort((a, b) => a - b);
  const pct = keys.map((k) => {
    const hrs = weeks.get(k);
    return Math.round((hrs.filter((h) => h <= HR_CEILING).length / hrs.length) * 100);
  });
  const avgHr = keys.map((k) => {
    const hrs = weeks.get(k);
    return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
  });

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: keys.map((k) => `W${k + 1}`),
      datasets: [
        {
          label: `% of runs ≤ ${HR_CEILING} bpm`,
          data: pct,
          backgroundColor: pct.map((p) =>
            p === 100 ? '#1D9E75' : p >= 50 ? '#BA7517' : '#A32D2D'
          ),
          borderRadius: 3,
          yAxisID: 'y',
        },
        {
          label: 'Avg run HR',
          data: avgHr,
          type: 'line',
          borderColor: COLOR.hrv,
          backgroundColor: hexToRgba(COLOR.hrv, 0.1),
          tension: 0.25,
          pointRadius: 2,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ctx.dataset.yAxisID === 'y'
                ? `${ctx.parsed.y}% of runs under the ceiling`
                : `Avg run HR ${ctx.parsed.y} bpm`,
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { min: 0, max: 100, title: { display: true, text: '% compliant' } },
        y1: {
          position: 'right',
          min: 120,
          max: 175,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Avg HR' },
        },
      },
    },
  });
}

// ---------- 7. Readiness (Body Battery range + sleep score) -----------------

function renderReadinessChart(days) {
  const canvas = document.getElementById('chart-readiness');
  if (!canvas) return;

  const spine = calendarSpine(days);
  if (spine.length === 0) return;

  // Only the Garmin era has these at all, so trim the empty Apple-era runway
  // rather than rendering two months of blank axis.
  const firstIdx = spine.findIndex((s) => s.day && (s.day.bodyBattery || s.day.sleep?.score != null));
  if (firstIdx < 0) return;
  const view = spine.slice(firstIdx);

  const bb = view.map((s) => {
    const b = s.day && s.day.bodyBattery;
    return b && b.lowest != null && b.highest != null ? [b.lowest, b.highest] : null;
  });
  const score = view.map((s) => (s.day && s.day.sleep && s.day.sleep.score != null ? s.day.sleep.score : null));

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: view.map((s) => formatShortDate(s.date)),
      datasets: [
        {
          label: 'Body Battery (low→high)',
          data: bb,
          backgroundColor: hexToRgba('#1D9E75', 0.45),
          borderColor: '#1D9E75',
          borderWidth: 1,
          borderSkipped: false,
        },
        {
          label: 'Sleep score',
          data: score,
          type: 'line',
          borderColor: COLOR.hrv,
          backgroundColor: hexToRgba(COLOR.hrv, 0.1),
          tension: 0.25,
          pointRadius: 2,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              Array.isArray(ctx.raw)
                ? `Body Battery ${ctx.raw[0]}–${ctx.raw[1]}`
                : `Sleep score ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
        y: { min: 0, max: 100, title: { display: true, text: '0–100' } },
      },
    },
  });
}

// ---------- 8. Training load + ACWR ----------------------------------------
//
// Load ratio is the injury-predictive number here. The shaded band is the
// conventional 0.8–1.3 "sweet spot"; above it is where ramp-rate injuries live.

function renderTrainingLoadChart(days) {
  const canvas = document.getElementById('chart-load');
  if (!canvas) return;

  const spine = calendarSpine(days);
  const firstIdx = spine.findIndex((s) => s.day && s.day.load && s.day.load.acute != null);
  if (firstIdx < 0) return;
  const view = spine.slice(firstIdx);

  const acute = view.map((s) => (s.day && s.day.load ? s.day.load.acute ?? null : null));
  const chronic = view.map((s) => (s.day && s.day.load ? s.day.load.chronic ?? null : null));
  const ratio = view.map((s) => (s.day && s.day.load ? s.day.load.ratio ?? null : null));

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: view.map((s) => formatShortDate(s.date)),
      datasets: [
        {
          label: 'Acute load (7d)',
          data: acute,
          borderColor: COLOR.run,
          backgroundColor: hexToRgba(COLOR.run, 0.12),
          tension: 0.25,
          pointRadius: 0,
          spanGaps: false,
          yAxisID: 'y',
        },
        {
          label: 'Chronic load (28d)',
          data: chronic,
          borderColor: COLOR.bike,
          backgroundColor: hexToRgba(COLOR.bike, 0.12),
          tension: 0.25,
          pointRadius: 0,
          borderDash: [4, 3],
          spanGaps: false,
          yAxisID: 'y',
        },
        {
          label: 'Acute:chronic ratio',
          data: ratio,
          borderColor: COLOR.hrv,
          backgroundColor: hexToRgba(COLOR.hrv, 0.12),
          tension: 0.25,
          pointRadius: 2,
          spanGaps: false,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
        y: { title: { display: true, text: 'Load' } },
        y1: {
          position: 'right',
          min: 0,
          max: 2,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'ACWR' },
        },
      },
    },
  });
}

// ---------- 9. Aerobic efficiency ------------------------------------------
//
// Speed per heartbeat. Pace alone flatters a run done hard and punishes one
// done in heat; dividing by HR is the closest thing here to an honest read on
// whether aerobic fitness is actually moving.

function renderEfficiencyChart(workouts) {
  const canvas = document.getElementById('chart-efficiency');
  if (!canvas) return;

  const runs = workouts
    .filter((w) => w.sport === 'run' && w.hr && w.hr.avg > 0 && w.durationMin > 0 && w.distance && w.distance.km > 0)
    .map((w) => ({
      date: w.date,
      // metres per minute, per beat per minute -> metres per beat
      ef: (w.distance.km * 1000) / w.durationMin / w.hr.avg,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (runs.length < 2) return;

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: runs.map((r) => formatShortDate(r.date)),
      datasets: [
        {
          label: 'Metres per beat',
          data: runs.map((r) => +r.ef.toFixed(3)),
          borderColor: COLOR.run,
          backgroundColor: hexToRgba(COLOR.run, 0.12),
          tension: 0.25,
          pointRadius: 3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} m/beat — higher is fitter` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
        y: { title: { display: true, text: 'm / beat' } },
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

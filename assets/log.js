/**
 * assets/log.js
 *
 * Reads data/workouts.json and replaces the training log <tbody> with
 * dynamically rendered rows that match the existing site's visual style.
 *
 * Falls back gracefully: if the JSON can't be loaded, the hardcoded rows
 * already in the HTML stay visible — your site never goes blank.
 */
(async function renderTrainingLog() {
  const tbody = document.getElementById('log-tbody');
  if (!tbody) return; // No placeholder on this page — nothing to do.

  let workouts;
  try {
    const res = await fetch('data/workouts.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    workouts = await res.json();
  } catch (err) {
    console.warn('[training-log] Could not load workouts.json — keeping fallback rows.', err);
    return;
  }

  if (!Array.isArray(workouts) || workouts.length === 0) return;

  // Sort chronologically. Same date → preserve workout index order.
  workouts.sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    return d !== 0 ? d : (a.index || 0) - (b.index || 0);
  });

  // Replace tbody content in one shot to avoid layout thrash.
  tbody.innerHTML = workouts.map((w, i) => renderRow(w, i + 1)).join('');

  // Update "Days logged" stat card if present.
  const doneCount = document.getElementById('doneCount');
  if (doneCount) doneCount.textContent = String(workouts.length);

  // Update training-log section title with the real day count.
  const logTitle = document.getElementById('log-title');
  if (logTitle) {
    const uniqueDays = new Set(workouts.map((w) => w.date)).size;
    logTitle.textContent = `${uniqueDays}-day training log`;
  }
})();

// ---------- Row rendering ---------------------------------------------------

function renderRow(w, dayNum) {
  const dateLabel = formatDate(w.date);
  const session = sportEmoji(w.sport) + ' ' + sessionLabel(w);
  const metrics = formatMetrics(w);
  const hr = w.hr && w.hr.avg != null ? Math.round(w.hr.avg) : '—';
  const grade = autoGrade(w);

  return [
    '<tr>',
    `<td>${dayNum}</td>`,
    `<td>${escapeHtml(dateLabel)}</td>`,
    `<td>${escapeHtml(session)}</td>`,
    `<td>${escapeHtml(metrics)}</td>`,
    `<td>${hr}</td>`,
    `<td><span class="log-grade" style="background:${grade.color}">${escapeHtml(grade.label)}</span></td>`,
    '</tr>',
  ].join('');
}

// ---------- Formatters ------------------------------------------------------

const SPORT_EMOJI = { run: '🏃', bike: '🚴', swim: '🏊', walk: '🚶', strength: '🏋️', other: '⚡' };
const sportEmoji = (sport) => SPORT_EMOJI[sport] || '⚡';

/** "2026-04-21" → "Tue Apr 21" */
function formatDate(iso) {
  if (!iso) return '';
  // Parse as local-noon to avoid TZ off-by-one.
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Sport-aware session label. */
function sessionLabel(w) {
  switch (w.sport) {
    case 'run':
      return 'Run';
    case 'bike':
      return 'Cycle';
    case 'swim':
      return 'Swim';
    case 'walk':
      return 'Walk';
    case 'strength':
      return 'Strength';
    default:
      return w.rawType || 'Workout';
  }
}

/** Build the "Key metrics" column string in the existing site's style. */
function formatMetrics(w) {
  const parts = [];

  if (w.distance) parts.push(formatDistance(w.distance, w.sport));
  if (w.durationMin != null) parts.push(formatDuration(w.durationMin));

  if (w.sport === 'run') {
    if (w.pace) parts.push(formatPaceToImperial(w.pace, '/mi'));
    if (w.cadence != null) parts.push(`${Math.round(w.cadence)}spm`);
  } else if (w.sport === 'bike') {
    if (w.power && w.power.avg != null) parts.push(`${Math.round(w.power.avg)}W`);
    if (w.cadence != null) parts.push(`${Math.round(w.cadence)}rpm`);
  } else if (w.sport === 'swim') {
    if (w.pace) parts.push(formatPaceToImperial(w.pace, '/100yd'));
  }

  return parts.join(' · ');
}

/** Distance formatted by sport: mi for run/bike, yd for swim. */
function formatDistance(d, sport) {
  if (!d) return '';
  if (sport === 'swim' && d.yd != null) return `${formatNumber(d.yd)}yd`;
  if ((sport === 'run' || sport === 'bike') && d.mi != null) {
    return `${d.mi.toFixed(2)}mi`;
  }
  if (d.km != null) return `${d.km.toFixed(2)}km`;
  return '';
}

/** Duration in minutes (decimal) → "44:50" or "1:13" for >=60min. */
function formatDuration(minutes) {
  const totalSec = Math.round(minutes * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${pad2(m)}`;
  return `${m}:${pad2(s)}`;
}

/**
 * Convert "6:47 /km" to imperial.
 *   target='/mi'    → "10'55"/mi"   (run pace)
 *   target='/100yd' → "2'30"/100yd" (swim pace, /100m → /100yd)
 */
function formatPaceToImperial(paceStr, target) {
  if (!paceStr) return '';

  if (target === '/mi') {
    const m = paceStr.match(/(\d+):(\d+)\s*\/km/i);
    if (!m) return paceStr;
    const secPerKm = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const secPerMi = Math.round(secPerKm * 1.609344);
    return `${Math.floor(secPerMi / 60)}'${pad2(secPerMi % 60)}"/mi`;
  }

  if (target === '/100yd') {
    // Health.md emits swim pace as "M:SS /100m"
    const m = paceStr.match(/(\d+):(\d+)\s*\/100m/i);
    if (!m) return paceStr;
    const secPer100m = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const secPer100yd = Math.round(secPer100m * 0.9144);
    return `${Math.floor(secPer100yd / 60)}'${pad2(secPer100yd % 60)}"/100yd`;
  }

  return paceStr;
}

// ---------- Auto-grading ----------------------------------------------------
// Simple rule-based grades using your declared HR ceilings (150 easy, 148 long).
// You can override per-workout later by adding annotations in a separate file.

function autoGrade(w) {
  const SWIM = '#1D9E75';
  const BIKE = '#BA7517';
  const RUN = '#A32D2D';
  const REST = '#5F5E5A';
  const GOOD = '#1D9E75';
  const WARN = '#BA7517';
  const BAD = '#A32D2D';

  if (!w.hr || w.hr.avg == null) return { label: 'Logged', color: REST };

  const hr = w.hr.avg;

  if (w.sport === 'run') {
    if (hr > 155) return { label: 'HR too high', color: BAD };
    if (hr > 150) return { label: 'At ceiling', color: WARN };
    return { label: 'Zone 2', color: GOOD };
  }
  if (w.sport === 'swim') {
    if (hr > 145) return { label: 'High effort', color: WARN };
    return { label: 'Logged', color: GOOD };
  }
  if (w.sport === 'bike') {
    if (hr > 140) return { label: 'High effort', color: WARN };
    return { label: 'Logged', color: GOOD };
  }
  return { label: 'Logged', color: REST };
}

// ---------- Utilities -------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
const formatNumber = (n) => Number(n).toLocaleString('en-US');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

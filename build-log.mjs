#!/usr/bin/env node
/**
 * build-log.mjs
 *
 * Reads Health.md daily exports from your Obsidian vault, extracts workout
 * and daily-context data, and writes data/workouts.json + data/days.json
 * for the website to render.
 *
 * Run from your repo root:   node build-log.mjs
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- CONFIG ----------------------------------------------------------
// Edit these if your setup changes.

const CONFIG = {
  // Folder where Health.md drops daily files (YYYY-MM-DD.md).
  // NOTE the typo "Obsedian" matches the actual folder name on your machine.
  obsidianFolder: 'C:\\Users\\Peter\\iCloudDrive\\iCloud~md~obsidian\\Main Obsedian',

  // Where to write the JSON output (relative to this script).
  outputFolder: 'data',

  // File naming pattern.
  filenameRegex: /^(\d{4})-(\d{2})-(\d{2})\.md$/,
};

// ---------- HELPERS ---------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Map raw workout type from Health.md into a canonical sport bucket. */
const categorizeWorkout = (rawType) => {
  const t = String(rawType).toLowerCase();
  if (t.includes('run')) return 'run';
  if (t.includes('cycl') || t.includes('bike')) return 'bike';
  if (t.includes('swim')) return 'swim';
  if (t.includes('strength') || t.includes('weight')) return 'strength';
  if (t.includes('walk') || t.includes('hik')) return 'walk';
  return 'other';
};

/** Parse a "- **Key:** value" markdown bullet. Returns [key, value] or null. */
const parseField = (line) => {
  const m = line.match(/^\s*-\s*\*\*(.+?):\*\*\s*(.+?)\s*$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
};

/** Pull "6.61 km" / "162 bpm" into { value, unit }. */
const parseValueUnit = (str) => {
  if (str == null) return { value: null, unit: null };
  const m = String(str).match(/^([\d.,]+)\s*([^\d].*)?$/);
  if (!m) return { value: null, unit: null };
  return {
    value: parseFloat(m[1].replace(/,/g, '')),
    unit: (m[2] || '').trim() || null,
  };
};

/** Convert any distance unit into a normalized object with km/mi/yd. */
const normalizeDistance = (value, unit) => {
  if (value == null || !unit) return null;
  const u = unit.toLowerCase();
  let km = null;
  if (u === 'km') km = value;
  else if (u === 'm') km = value / 1000;
  else if (u === 'mi') km = value * 1.609344;
  else if (u === 'yd') km = value * 0.0009144;
  else if (u === 'ft') km = value * 0.0003048;
  if (km == null) return { raw: { value, unit } };
  return {
    raw: { value, unit },
    km: +km.toFixed(3),
    mi: +(km * 0.621371).toFixed(3),
    yd: Math.round(km * 1093.6133),
  };
};

/** "1h 23m" / "44m" / "44:50" → minutes (decimal). */
const parseDurationToMin = (str) => {
  if (!str) return null;
  const s = String(str).trim();
  const hm = s.match(/^(?:(\d+)h\s*)?(?:(\d+)m)?$/);
  if (hm && (hm[1] || hm[2])) {
    return parseInt(hm[1] || '0', 10) * 60 + parseInt(hm[2] || '0', 10);
  }
  const ms = s.match(/^(\d+):(\d+)$/);
  if (ms) return parseInt(ms[1], 10) + parseInt(ms[2], 10) / 60;
  return null;
};

// ---------- PARSER ----------------------------------------------------------

const parseFrontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+?)\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
};

/** Extract a top-level "## Header" section through the next ## or EOF. */
const extractSection = (text, header) => {
  const re = new RegExp(
    `##\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i'
  );
  const m = text.match(re);
  return m ? m[1].trim() : null;
};

/** Split the ## Workouts block on "### N. Type" into individual workouts. */
const parseWorkouts = (workoutsBlock) => {
  if (!workoutsBlock) return [];
  // (?:^|\n) handles the workout starting at position 0 (post-trim) AND
  // subsequent workouts preceded by newline — fixes the missing-first-workout bug.
  const parts = workoutsBlock.split(/(?:^|\n)###\s+\d+\.\s+/);
  const workouts = [];
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const nl = block.indexOf('\n');
    const rawType = (nl === -1 ? block : block.slice(0, nl)).trim();
    const body = nl === -1 ? '' : block.slice(nl + 1);
    workouts.push(parseSingleWorkout(rawType, body, i));
  }
  return workouts;
};

const parseSingleWorkout = (rawType, body, index) => {
  const fields = {};
  const laps = [];
  let inLapTable = false;

  for (const line of body.split('\n')) {
    // Lap table header e.g. "| # | Distance | Time | Pace |"
    if (line.match(/^\|\s*#\s*\|/)) {
      inLapTable = true;
      continue;
    }
    if (inLapTable && line.match(/^\|\s*\d+\s*\|/)) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 4) {
        laps.push({
          num: parseInt(cells[0], 10),
          distance: cells[1],
          time: cells[2],
          pace: cells[3],
        });
      }
      continue;
    }
    if (inLapTable && line.match(/^\|/)) continue; // separator row
    if (inLapTable && line.trim() === '') {
      inLapTable = false;
      continue;
    }

    const kv = parseField(line);
    if (kv) fields[kv[0]] = kv[1];
  }

  const distVU = parseValueUnit(fields['Distance']);

  return {
    index,
    rawType,
    sport: categorizeWorkout(rawType),
    startTime: fields['Time'] || null,
    durationMin: parseDurationToMin(fields['Duration']),
    durationRaw: fields['Duration'] || null,
    distance: normalizeDistance(distVU.value, distVU.unit),
    pace: fields['Avg Pace'] || null,
    calories: parseValueUnit(fields['Calories']).value,
    hr: {
      avg: parseValueUnit(fields['Avg Heart Rate']).value,
      max: parseValueUnit(fields['Max Heart Rate']).value,
      min: parseValueUnit(fields['Min Heart Rate']).value,
    },
    cadence: parseValueUnit(fields['Avg Cadence']).value,
    power: {
      avg: parseValueUnit(fields['Avg Power']).value,
      max: parseValueUnit(fields['Max Power']).value,
    },
    elevation: parseValueUnit(fields['Elevation Gain']).value,
    strideLength: parseValueUnit(fields['Avg Stride Length']).value,
    groundContact: parseValueUnit(fields['Avg Ground Contact']).value,
    verticalOscillation: parseValueUnit(fields['Avg Vertical Oscillation']).value,
    laps,
  };
};

/** Pull useful daily context (sleep / heart / activity) for trend charts. */
const parseDailyContext = (text) => {
  const ctx = {};
  const sectionFields = (sectionName) => {
    const block = extractSection(text, sectionName);
    if (!block) return null;
    const fields = {};
    for (const line of block.split('\n')) {
      const kv = parseField(line);
      if (kv) fields[kv[0]] = kv[1];
    }
    return fields;
  };

  const sleep = sectionFields('Sleep');
  if (sleep) {
    ctx.sleep = {
      totalMin: parseDurationToMin(sleep['Total']),
      bedtime: sleep['Bedtime'] || null,
      wake: sleep['Wake'] || null,
      deepMin: parseDurationToMin(sleep['Deep']),
      remMin: parseDurationToMin(sleep['REM']),
      coreMin: parseDurationToMin(sleep['Core']),
      awakeMin: parseDurationToMin(sleep['Awake']),
    };
  }

  const heart = sectionFields('Heart');
  if (heart) {
    ctx.heart = {
      restingHr: parseValueUnit(heart['Resting HR']).value,
      walkingHr: parseValueUnit(heart['Walking HR Average']).value,
      avgHr: parseValueUnit(heart['Average HR']).value,
      maxHr: parseValueUnit(heart['Max HR']).value,
      hrv: parseValueUnit(heart['HRV']).value,
      hrRecovery: parseValueUnit(heart['Heart Rate Recovery']).value,
    };
  }

  const activity = sectionFields('Activity');
  if (activity) {
    ctx.activity = {
      steps: parseValueUnit(activity['Steps']).value,
      activeCalories: parseValueUnit(activity['Active Calories']).value,
      exerciseMin: parseValueUnit(activity['Exercise']).value,
      vo2max: parseValueUnit(activity['Cardio Fitness (VO2 Max)']).value,
    };
  }

  return ctx;
};

// ---------- MAIN ------------------------------------------------------------

const main = () => {
  const { obsidianFolder, outputFolder, filenameRegex } = CONFIG;

  if (!existsSync(obsidianFolder)) {
    console.error(`❌ Obsidian folder not found:\n   ${obsidianFolder}`);
    console.error('\nEdit CONFIG.obsidianFolder at the top of build-log.mjs.');
    process.exit(1);
  }

  const files = readdirSync(obsidianFolder)
    .filter((f) => filenameRegex.test(f))
    .sort();

  console.log(`\n📂 Reading from: ${obsidianFolder}`);
  console.log(`   Found ${files.length} daily file(s)\n`);

  const days = [];
  const workouts = [];

  for (const file of files) {
    const text = readFileSync(join(obsidianFolder, file), 'utf8');
    const fm = parseFrontmatter(text);
    const date = fm.date || file.replace(/\.md$/, '');

    const dayContext = parseDailyContext(text);
    const workoutsBlock = extractSection(text, 'Workouts');
    const dayWorkouts = parseWorkouts(workoutsBlock);

    days.push({ date, ...dayContext, workoutCount: dayWorkouts.length });
    for (const w of dayWorkouts) workouts.push({ date, ...w });

    const summary = dayWorkouts.map((w) => w.sport).join(', ') || '(rest)';
    console.log(`  ${date}: ${dayWorkouts.length} workout(s) — ${summary}`);
  }

  workouts.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : a.index - b.index;
  });

  const outDir = join(__dirname, outputFolder);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, 'workouts.json'),
    JSON.stringify(workouts, null, 2)
  );
  writeFileSync(join(outDir, 'days.json'), JSON.stringify(days, null, 2));

  console.log(
    `\n✅ ${workouts.length} workouts → ${outputFolder}/workouts.json`
  );
  console.log(`✅ ${days.length} days → ${outputFolder}/days.json\n`);
};

main();

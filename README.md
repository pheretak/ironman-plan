# Ironman 70.3 Long Beach 2026 — Training Plan

Personal single-page site tracking a 27-week build to Ironman 70.3 Long Beach on **Sep 27, 2026**. Renders the plan by week, a data-driven training log with charts, and reference cards (phases, adjustments, nutrition, gear).

**Plan window:** Mar 21, 2026 → Sep 27, 2026 · 27 weeks across 5 phases: Foundation → Base Build → Performance → Race Specific → Taper.

## Structure

```
├── index.html          Single-page app — 6 tabs: Plan · Training log · Phases · Adjustments · Nutrition · Gear
├── assets/
│   ├── log.js          Renders the training log from data/*.json
│   └── charts.js       Chart.js visualizations — volume, HR, pace, recovery
├── data/
│   ├── workouts.json   Every logged workout (generated)
│   └── days.json       Daily biometric context — sleep, HR, HRV, activity (generated)
└── build-log.mjs       Reads Obsidian daily notes → writes data/*.json
```

## Data pipeline

```
Apple Health  ──►  Health.md exporter  ──►  Obsidian daily notes  ──►  build-log.mjs  ──►  data/*.json  ──►  index.html
                                            (YYYY-MM-DD.md)
```

The site reads only from `data/workouts.json` and `data/days.json`. To refresh after new daily notes drop:

```bash
node build-log.mjs
```

`CONFIG.obsidianFolder` at the top of `build-log.mjs` points at the local Obsidian Health folder — edit it if the vault path changes.

Days may carry any combination of the sections the parser knows — `## Sleep`, `## Activity`, `## Heart`, `## Workouts`. Missing sections are tolerated; the parser fills what it can.

### Alternate source: Garmin Connect CSV

When the Health.md exporter isn't available for a stretch of days, activities can be backfilled from a Garmin Connect CSV export. The importer writes minimal daily notes containing only the `## Workouts` section into the same Health folder, tagged with `source: garmin-csv` in the frontmatter so they're distinguishable from full Health.md exports. The standard `node build-log.mjs` then picks them up. Sleep, HRV, and heart baselines are absent for CSV-sourced days.

## Local

Zero npm dependencies. Open `index.html` directly in a browser, or host the folder statically. Chart.js loads from a CDN.

## Files not in git

`data/*.json` are checked in — they're the deployment artifact. The Obsidian source notes live outside the repo and are not versioned here.

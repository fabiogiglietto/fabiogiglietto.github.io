/**
 * Site health record — catches the failures that never fail a run.
 *
 * Collectors swallow their errors by design (they return null and the last
 * real file is kept), so a run can be green while Scholar 403s for days or the
 * published bio carries a stale date. This module
 * turns each run into per-check observations, folds them into a persistent
 * state (public/data/health.json, committed by the workflow) and reports only
 * TRANSITIONS: a check that has just become degraded or just recovered. A
 * chronic problem is reported once, not on every one of the 3-4 daily runs.
 *
 * Flow:
 *   collect-all.js  -> writeRunObservations()   public/data/.health-run.json (gitignored)
 *   health-report.js -> contentChecks() + nextState()  public/data/health.json
 *   health-report.js notify -> Slack, ops-autofix dispatch, issue close
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public/data');
const RUN_FILE = path.join(DATA_DIR, '.health-run.json');
const STATE_FILE = path.join(DATA_DIR, 'health.json');

// A check turns degraded after this many consecutive bad runs. Sources get
// three (about a day at 3-4 runs/day): Scholar fails intermittently and one
// bad run is not news. Content checks are deterministic, so one is enough.
const BAD_RUNS_TO_DEGRADE = { source: 3, content: 1 };
const OK_RUNS_TO_RECOVER = 2;
// A count below this fraction of the last good count is a drop — but only when
// the last good count is big enough for a fraction to mean anything.
const DROP_RATIO = 0.5;
const DROP_MIN_BASELINE = 4;

/** Collector keys as returned by collect-all's Phase 1, with what to count. */
const SOURCES = {
  orcid: { label: 'ORCID', count: d => d.works?.length },
  scholar: { label: 'Google Scholar', count: d => d.publications?.length },
  university: { label: 'University profile', count: d => (d.profile ? 1 : 0) },
  github: { label: 'GitHub', count: d => d.repositories?.length },
  news: { label: 'News (Mastodon)', count: d => d.news?.length },
  // Zero validated mentions is a legitimate outcome, not an outage.
  websearch: { label: 'Web mentions', count: d => (Array.isArray(d) ? d.length : d.results?.length), allowEmpty: true },
  wos: { label: 'Web of Science', count: d => d.publications?.length },
  scopus: { label: 'Scopus', count: d => d.publications?.length },
  semanticScholar: { label: 'Semantic Scholar', count: d => d.publications?.length },
  toread: { label: 'toread feed', count: d => d.papers?.length },
  ora: { label: 'ORA UNIURB', count: d => d.publications?.length },
  researchRadio: { label: 'Research Radio', count: d => d.episodes?.length },
  zettelkasten: { label: 'fg-zettelkasten', count: d => Object.keys(d.notesByBibtexKey || {}).length },
  ownPaperClaims: { label: 'Own paper claims', count: d => d.papers?.length },
  aggregatedPublications: { label: 'Aggregated publications', count: d => d.publications?.length },
};

const STATUS_TEXT = {
  failed: 'collector returned nothing',
  empty: 'returned 0 records',
  dropped: 'record count dropped sharply',
  bad: 'check failed',
};

/**
 * Classify one collector result.
 * @param {string} key  SOURCES key
 * @param {*} data      what the collector returned (null on failure)
 * @param {number|null} lastOkCount  count from the last healthy run, if any
 * @return {{status: string, count: number|null}}
 */
function classifySource(key, data, lastOkCount) {
  const spec = SOURCES[key] || { count: () => null };
  // `unavailable` marks a placeholder file standing in for a source that has
  // never returned real data (semantic-scholar.json since 2026-11-07).
  if (data === null || data === undefined || data.unavailable) return { status: 'failed', count: null };
  let count = null;
  try {
    const c = spec.count(data);
    count = Number.isFinite(c) ? c : null;
  } catch {
    count = null;
  }
  if (count === 0 && !spec.allowEmpty) return { status: 'empty', count };
  // A source allowed to be empty fluctuates by nature, so drops say nothing.
  if (!spec.allowEmpty && count !== null && Number.isFinite(lastOkCount) && lastOkCount >= DROP_MIN_BASELINE &&
      count < lastOkCount * DROP_RATIO) {
    return { status: 'dropped', count };
  }
  return { status: 'ok', count };
}

/** Observations for every Phase-1/2 collector result, keyed like SOURCES. */
function observeSources(results, previousState) {
  const obs = {};
  for (const key of Object.keys(SOURCES)) {
    if (!(key in results)) continue;
    const lastOk = previousState?.checks?.[key]?.lastOkCount ?? null;
    const { status, count } = classifySource(key, results[key], lastOk);
    obs[key] = { kind: 'source', label: SOURCES[key].label, status, count };
  }
  return obs;
}

const SOURCE_FILES = {
  orcid: 'orcid.json', scholar: 'scholar.json', university: 'university.json', github: 'github.json',
  news: 'news.json', websearch: 'websearch.json', wos: 'wos.json',
  scopus: 'scopus.json', semanticScholar: 'semantic-scholar.json', toread: 'toread.json', ora: 'ora.json',
  researchRadio: 'research-radio.json', zettelkasten: 'zettelkasten.json',
  ownPaperClaims: 'own-paper-claims.json', aggregatedPublications: 'aggregated-publications.json',
};

/**
 * Observations from the committed files, for --dry-run when no collection ran.
 * A file can only show what was last saved, so a source that fails without
 * overwriting its file looks healthy here; CI uses the live results instead.
 */
function observeFromDisk(dataDir = DATA_DIR) {
  const results = {};
  for (const [key, file] of Object.entries(SOURCE_FILES)) {
    results[key] = readJson(path.join(dataDir, file));
  }
  return observeSources(results, readState());
}

/** Called by collect-all.js. Never throws: health must not break collection. */
function writeRunObservations(results) {
  try {
    const obs = observeSources(results, readState());
    fs.writeFileSync(RUN_FILE, JSON.stringify({ observedAt: new Date().toISOString(), checks: obs }, null, 2));
    return obs;
  } catch (error) {
    console.warn(`Health: could not record source observations: ${error.message}`);
    return null;
  }
}

/** Checks on what the site publishes, run after the generators. */
function contentChecks(rootDir = ROOT) {
  const obs = {};
  const bioPath = path.join(rootDir, '_includes/generated-about.html');
  const bio = fs.existsSync(bioPath) ? fs.readFileSync(bioPath, 'utf8') : '';
  const text = bio.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const problems = [];
  if (text.length < 500) problems.push(`only ${text.length} characters of text`);
  const stamp = text.match(/\bas of (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/i);
  if (stamp) problems.push(`contains a dated status stamp ("${stamp[0]}")`);
  if (/see the (?:\w+ )?table below/i.test(text)) problems.push('refers to "the table below", which the page does not have');

  obs.bio = {
    kind: 'content',
    label: 'Published bio',
    status: problems.length ? 'bad' : 'ok',
    count: null,
    detail: problems.join('; ') || undefined,
  };
  return obs;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readState() {
  return readJson(STATE_FILE);
}

/**
 * Fold one run's observations into the persistent state.
 * @return {{state: Object, degraded: Array, recovered: Array, baseline: boolean}}
 */
function nextState(previous, observations, { now = new Date().toISOString(), runUrl = null } = {}) {
  const baseline = !previous || !previous.checks;
  const prevChecks = previous?.checks || {};
  const checks = {};
  const degraded = [];
  const recovered = [];

  // Checks not observed this run (e.g. a collector removed) are carried over
  // unchanged rather than counted as good or bad.
  for (const [key, prev] of Object.entries(prevChecks)) {
    if (!(key in observations)) checks[key] = prev;
  }

  for (const [key, ob] of Object.entries(observations)) {
    const prev = prevChecks[key] || { consecutiveBad: 0, consecutiveOk: 0, degraded: false, lastOkCount: null };
    const bad = ob.status !== 'ok';
    const entry = {
      kind: ob.kind,
      label: ob.label,
      status: ob.status,
      count: ob.count ?? null,
      detail: ob.detail,
      lastOkCount: !bad && ob.count !== null ? ob.count : prev.lastOkCount ?? null,
      consecutiveBad: bad ? (prev.consecutiveBad || 0) + 1 : 0,
      consecutiveOk: bad ? 0 : (prev.consecutiveOk || 0) + 1,
      degraded: !!prev.degraded,
      since: prev.since || null,
    };

    const threshold = BAD_RUNS_TO_DEGRADE[ob.kind] || BAD_RUNS_TO_DEGRADE.source;
    if (!entry.degraded && bad && (baseline || entry.consecutiveBad >= threshold)) {
      entry.degraded = true;
      entry.since = now;
      degraded.push({ key, ...entry });
    } else if (entry.degraded && !bad && entry.consecutiveOk >= OK_RUNS_TO_RECOVER) {
      entry.degraded = false;
      entry.since = null;
      recovered.push({ key, ...entry });
    }
    checks[key] = entry;
  }

  return {
    state: { updatedAt: now, runUrl, checks },
    degraded,
    recovered,
    baseline,
  };
}

function describe(entry) {
  let line = `*${entry.label}* — ${STATUS_TEXT[entry.status] || entry.status}`;
  if (entry.detail) line += `: ${entry.detail}`;
  if (entry.status === 'dropped') line += ` (${entry.count} vs ${entry.lastOkCount})`;
  else if (entry.kind === 'source' && Number.isFinite(entry.lastOkCount)) line += ` · last good: ${entry.lastOkCount} records`;
  return line;
}

/** Slack mrkdwn for one run's transitions, or null when there is nothing to say. */
function formatMessage({ degraded, recovered, baseline }, { repo, runUrl, triage = false }) {
  if (!degraded.length && !recovered.length) return null;
  const lines = [];
  if (degraded.length) {
    const head = baseline
      ? `:stethoscope: *${repo}* / site health baseline — ${degraded.length} problem(s) already present`
      : `:warning: *${repo}* / site health — ${degraded.length} new problem(s); the run itself passed`;
    lines.push(head);
    for (const d of degraded) lines.push(`• ${describe(d)}`);
  }
  if (recovered.length) {
    lines.push(`:white_check_mark: *${repo}* / recovered: ` +
      recovered.map(r => `*${r.label}*${Number.isFinite(r.count) ? ` (${r.count} records)` : ''}`).join(', '));
  }
  if (degraded.length && triage) lines.push('Triage started (ops-autofix) — it will report here.');
  if (runUrl) lines.push(`Run: ${runUrl}`);
  return lines.join('\n');
}

module.exports = {
  SOURCES,
  RUN_FILE,
  STATE_FILE,
  BAD_RUNS_TO_DEGRADE,
  OK_RUNS_TO_RECOVER,
  classifySource,
  observeSources,
  observeFromDisk,
  writeRunObservations,
  contentChecks,
  readJson,
  readState,
  nextState,
  formatMessage,
};

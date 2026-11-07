/**
 * Tests for scripts/health.js — soft-failure detection and change-only alerting.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const health = require('../scripts/health');

const { classifySource, nextState, formatMessage, contentChecks } = health;

const src = (status, extra = {}) => ({ kind: 'source', label: 'Google Scholar', status, count: status === 'ok' ? 163 : null, ...extra });

/** Run a sequence of observations through nextState, returning every result. */
function runSequence(statuses, { key = 'scholar', previous = { checks: {} }, make = src } = {}) {
  const results = [];
  let state = previous;
  for (const status of statuses) {
    const r = nextState(state, { [key]: make(status) }, { now: '2026-11-07T12:00:00Z' });
    results.push(r);
    state = r.state;
  }
  return results;
}

describe('classifySource', () => {
  test('null is a failure', () => {
    expect(classifySource('scholar', null, 163)).toEqual({ status: 'failed', count: null });
  });

  test('a placeholder for an unavailable source is a failure, not "0 records"', () => {
    expect(classifySource('semanticScholar', { unavailable: true, publications: [] }, null).status).toBe('failed');
  });

  test('zero records is empty, unless the source allows it', () => {
    expect(classifySource('news', { news: [] }, null).status).toBe('empty');
    expect(classifySource('websearch', [], 6).status).toBe('ok');
  });

  test('a sharp drop against the last good count is flagged', () => {
    expect(classifySource('scholar', { publications: new Array(40) }, 163)).toEqual({ status: 'dropped', count: 40 });
    expect(classifySource('scholar', { publications: new Array(150) }, 163).status).toBe('ok');
  });

  test('small baselines do not trigger drops', () => {
    expect(classifySource('ownPaperClaims', { papers: [1] }, 3).status).toBe('ok');
  });
});

describe('nextState hysteresis', () => {
  test('two bad runs do not alert; the third does', () => {
    const r = runSequence(['failed', 'failed', 'failed']);
    expect(r[0].degraded).toHaveLength(0);
    expect(r[1].degraded).toHaveLength(0);
    expect(r[2].degraded.map(d => d.key)).toEqual(['scholar']);
  });

  test('an intermittent source that recovers in between never alerts', () => {
    const r = runSequence(['failed', 'failed', 'ok', 'failed', 'failed', 'ok']);
    expect(r.every(x => x.degraded.length === 0)).toBe(true);
  });

  test('a degraded check alerts once, not on every following run', () => {
    const r = runSequence(['failed', 'failed', 'failed', 'failed', 'failed']);
    expect(r.flatMap(x => x.degraded)).toHaveLength(1);
  });

  test('recovery needs two good runs and is reported once', () => {
    const r = runSequence(['failed', 'failed', 'failed', 'ok', 'ok', 'ok']);
    expect(r[3].recovered).toHaveLength(0);
    expect(r[4].recovered.map(x => x.key)).toEqual(['scholar']);
    expect(r[5].recovered).toHaveLength(0);
    expect(r[5].state.checks.scholar.degraded).toBe(false);
  });

  test('content checks degrade on the first bad run', () => {
    const r = runSequence(['bad'], { key: 'bio', make: s => ({ kind: 'content', label: 'Published bio', status: s, count: null }) });
    expect(r[0].degraded).toHaveLength(1);
  });

  test('the first run ever (no previous state) is a baseline of everything bad', () => {
    const r = nextState(null, { scholar: src('failed'), orcid: { ...src('ok'), label: 'ORCID' } });
    expect(r.baseline).toBe(true);
    expect(r.degraded.map(d => d.key)).toEqual(['scholar']);
  });

  test('lastOkCount survives failures so drops compare against real data', () => {
    const r = runSequence(['ok', 'failed', 'failed']);
    expect(r[2].state.checks.scholar.lastOkCount).toBe(163);
  });

  test('checks not observed this run are carried over unchanged', () => {
    const prev = runSequence(['failed', 'failed', 'failed'])[2].state;
    const r = nextState(prev, { bio: { kind: 'content', label: 'Published bio', status: 'ok', count: null } });
    expect(r.state.checks.scholar).toEqual(prev.checks.scholar);
  });
});

describe('formatMessage', () => {
  const opts = { repo: 'o/r', runUrl: 'https://example/run/1' };

  test('nothing to say means no message', () => {
    expect(formatMessage({ degraded: [], recovered: [], baseline: false }, opts)).toBeNull();
  });

  test('new problems name the source, status and last good count', () => {
    const msg = formatMessage({
      degraded: [{ key: 'scholar', kind: 'source', label: 'Google Scholar', status: 'failed', lastOkCount: 163 }],
      recovered: [],
      baseline: false,
    }, { ...opts, triage: true });
    expect(msg).toContain('1 new problem(s)');
    expect(msg).toContain('*Google Scholar* — collector returned nothing');
    expect(msg).toContain('last good: 163 records');
    expect(msg).toContain('Triage started');
    expect(msg).toContain('https://example/run/1');
  });

  test('the baseline is labelled as such', () => {
    const msg = formatMessage({ degraded: [{ key: 'news', kind: 'source', label: 'News', status: 'empty' }], recovered: [], baseline: true }, opts);
    expect(msg).toContain('baseline');
  });

  test('recoveries are listed', () => {
    const msg = formatMessage({ degraded: [], recovered: [{ key: 'scopus', label: 'Scopus', count: 25 }], baseline: false }, opts);
    expect(msg).toContain('recovered: *Scopus* (25 records)');
  });
});

describe('contentChecks (published bio)', () => {
  let dir;
  const longText = 'Fabio Giglietto is Full Professor of Internet Studies. '.repeat(15);
  const writeBio = html => {
    fs.mkdirSync(path.join(dir, '_includes'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_includes/generated-about.html'), html);
  };

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a normal bio passes', () => {
    writeBio(`<p>${longText}</p>`);
    expect(contentChecks(dir).bio.status).toBe('ok');
  });

  test('a dated status stamp fails', () => {
    writeBio(`<p>${longText} As of August 2026 he is a member of the ICA.</p>`);
    const { bio } = contentChecks(dir);
    expect(bio.status).toBe('bad');
    expect(bio.detail).toContain('As of August 2026');
  });

  test('a reference to a table the page does not have fails', () => {
    writeBio(`<p>${longText} (see the projects table below)</p>`);
    expect(contentChecks(dir).bio.status).toBe('bad');
  });

  test('a missing or truncated bio fails', () => {
    expect(contentChecks(dir).bio.status).toBe('bad');
    writeBio('<p>Short.</p>');
    expect(contentChecks(dir).bio.detail).toMatch(/only \d+ characters/);
  });

  test('the bio published today passes', () => {
    expect(contentChecks(path.join(__dirname, '..')).bio.status).toBe('ok');
  });
});

describe('no mock data anywhere', () => {
  // Mock fallbacks published invented data: Semantic Scholar citation counts
  // (2026-02-24 to 2026-11-07), hardcoded WoS counts, a fake social-media
  // feed, and made-up class times and rooms on the teaching page.
  const SCAN_DIRS = ['scripts/collectors', 'scripts/generators', 'assets/js'];
  const root = path.join(__dirname, '..');

  test.each(SCAN_DIRS)('%s has no mock-data fallback', dir => {
    for (const file of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(root, dir, file), 'utf8');
      expect({ file, hit: /getMock\w*\(|mock data|sample data|placeholder schedule/i.test(src) })
        .toEqual({ file, hit: false });
    }
  });

  test('a failing collector returns null instead of invented data', async () => {
    const saved = { ...process.env };
    delete process.env.S2_API_KEY;
    delete process.env.SCOPUS_API_KEY;
    delete process.env.WOS_API_KEY;
    try {
      for (const name of ['semantic-scholar', 'scopus', 'wos']) {
        const collector = require(`../scripts/collectors/${name}`);
        await expect(collector.collect()).resolves.toBeNull();
      }
    } finally {
      process.env = saved;
    }
  });
});

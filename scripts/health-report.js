#!/usr/bin/env node
/**
 * Site health report. Two modes, both run by .github/workflows/update-site.yml:
 *
 *   node scripts/health-report.js            evaluate (before commit)
 *     Adds content checks to the run's source observations, folds them into
 *     public/data/health.json and writes the transitions to
 *     $HEALTH_TRANSITIONS_FILE. With --dry-run nothing is written and the
 *     Slack message it would post is printed.
 *
 *   node scripts/health-report.js notify     (after push)
 *     Posts the transitions to #pipeline-ops, dispatches ops-autofix in
 *     health mode for new problems, and closes ops-autofix issues whose
 *     checks have all recovered.
 *
 * Neither mode exits non-zero: health reporting must never fail the run that
 * it is reporting on. Problems are logged as ::warning:: annotations.
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const health = require('./health');

const TRANSITIONS_FILE = process.env.HEALTH_TRANSITIONS_FILE ||
  path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'health-transitions.json');
const REPO = process.env.GITHUB_REPOSITORY || 'fabiogiglietto/fabiogiglietto.github.io';
const RUN_URL = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function evaluate({ dryRun }) {
  const run = health.readJson(health.RUN_FILE);
  let sources = run?.checks;
  if (!sources && dryRun) {
    console.log('No run observations — reading the committed data files instead');
    sources = health.observeFromDisk();
  } else if (!sources) {
    console.warn('::warning title=Site health::no source observations from collect-all — only content checks ran');
  }
  const observations = { ...(sources || {}), ...health.contentChecks() };

  const previous = health.readState();
  const result = health.nextState(previous, observations, { runUrl: RUN_URL });

  for (const [key, c] of Object.entries(result.state.checks)) {
    const flag = c.status === 'ok' ? 'ok ' : 'BAD';
    console.log(`  [${flag}] ${key.padEnd(24)} ${c.status}${c.count !== null ? ` (${c.count})` : ''}${c.degraded ? ' — degraded' : ''}`);
  }

  const message = health.formatMessage(result, { repo: REPO, runUrl: RUN_URL, triage: result.degraded.length > 0 });
  if (dryRun) {
    console.log(message ? `\nWould post:\n${message}` : '\nNo transitions — nothing would be posted.');
    return;
  }

  fs.writeFileSync(health.STATE_FILE, JSON.stringify(result.state, null, 2));
  fs.rmSync(health.RUN_FILE, { force: true });
  fs.writeFileSync(TRANSITIONS_FILE, JSON.stringify({
    baseline: result.baseline,
    degraded: result.degraded,
    recovered: result.recovered,
    message,
  }, null, 2));

  for (const d of result.degraded) console.warn(`::warning title=Site health::${d.label}: ${d.status}${d.detail ? ` — ${d.detail}` : ''}`);
  setOutput('has_transitions', message ? 'true' : 'false');
  setOutput('has_new_problems', result.degraded.length ? 'true' : 'false');
  console.log(`Health: ${result.degraded.length} newly degraded, ${result.recovered.length} recovered`);
}

async function postSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERT_CHANNEL;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  // Same precedence as the failure alert: the explicit channel wins, because
  // the webhook is bound to #toread at creation.
  if (token && channel) {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text }),
    });
    // HTTP 200 with {"ok":false} for a channel the bot is not in.
    const body = await res.json().catch(() => ({}));
    if (!body.ok) console.log(`::error title=Site health::Slack rejected the health report: ${JSON.stringify(body)}`);
    return !!body.ok;
  }
  if (webhook) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.log(`::error title=Site health::Slack webhook rejected the health report (${res.status})`);
    return res.ok;
  }
  console.log('No Slack credentials configured — skipping health report');
  return false;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function dispatchTriage(degraded) {
  const problems = degraded.map(d => ({ key: d.key, label: d.label, status: d.status, count: d.count, lastOkCount: d.lastOkCount, detail: d.detail }));
  gh(['workflow', 'run', 'ops-autofix.yml',
    '-f', 'mode=health',
    '-f', `run_id=${process.env.GITHUB_RUN_ID}`,
    '-f', `problems=${JSON.stringify(problems)}`]);
  console.log(`Dispatched ops-autofix (health mode) for: ${problems.map(p => p.key).join(', ')}`);
}

/** Close escalation issues once every check they name is healthy again. */
function closeRecoveredIssues(recovered) {
  if (!recovered.length) return;
  const state = health.readState();
  const issues = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', 'ops-autofix', '--json', 'number,body']));
  for (const issue of issues) {
    const keys = [...(issue.body || '').matchAll(/health-key: ([\w-]+)/g)].map(m => m[1]);
    if (!keys.length || !keys.some(k => recovered.some(r => r.key === k))) continue;
    if (keys.some(k => state?.checks?.[k]?.degraded)) continue;
    gh(['issue', 'close', String(issue.number), '--reason', 'completed',
      '--comment', `All checks named here have recovered${RUN_URL ? ` (${RUN_URL})` : ''}.`]);
    console.log(`Closed ops-autofix issue #${issue.number}`);
  }
}

async function notify() {
  const t = health.readJson(TRANSITIONS_FILE);
  if (!t || !t.message) {
    console.log('No health transitions to report');
    return;
  }
  await postSlack(t.message);
  // Each step is independent: a failed dispatch must not stop issue cleanup.
  if (t.degraded.length) {
    try {
      dispatchTriage(t.degraded);
    } catch (e) {
      console.log(`::warning title=Site health::could not dispatch ops-autofix: ${e.stderr || e.message}`);
    }
  }
  try {
    closeRecoveredIssues(t.recovered);
  } catch (e) {
    console.log(`::warning title=Site health::could not close recovered issues: ${e.stderr || e.message}`);
  }
}

async function main() {
  const mode = process.argv[2] === 'notify' ? 'notify' : 'evaluate';
  try {
    if (mode === 'notify') await notify();
    else evaluate({ dryRun: process.argv.includes('--dry-run') });
  } catch (error) {
    console.log(`::warning title=Site health::health ${mode} crashed: ${error.message}`);
    // A crash in evaluate still gets one message out, so silence never
    // looks like health.
    if (mode === 'evaluate' && !process.argv.includes('--dry-run')) {
      try {
        fs.writeFileSync(TRANSITIONS_FILE, JSON.stringify({
          degraded: [], recovered: [],
          message: `:warning: *${REPO}* / site health check crashed: ${error.message}${RUN_URL ? `\nRun: ${RUN_URL}` : ''}`,
        }));
        setOutput('has_transitions', 'true');
      } catch { /* nothing more to do */ }
    }
  }
}

if (require.main === module) main();

module.exports = { evaluate, notify };

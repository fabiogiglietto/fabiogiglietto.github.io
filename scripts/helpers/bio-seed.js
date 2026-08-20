/**
 * Bio Seed Loader
 *
 * Reads the hand-maintained fact sheet at scripts/data/bio-seed.md. Generators
 * consume it as CONSTRAINTS — confirmed facts the generated prose may never
 * contradict — not as a biography to reuse. Collected API data is supplementary.
 *
 * The fact sheet stamps its status claims with a month ("as of August 2026") so
 * a generator can tell a current role from a concluded one. Nothing in the
 * pipeline refreshes that stamp: it is maintained by hand, and a stale stamp
 * silently turns "as of" claims into assertions about a year that has passed.
 * readBioSeed() therefore warns as the stamp ages.
 */

const fs = require('fs');
const path = require('path');

const BIO_SEED_PATH = path.join(__dirname, '..', 'data', 'bio-seed.md');

// Warn once the stamp is this old, escalate at the second threshold. Six months
// is roughly the horizon over which an academic's roles, grants and
// appointments turn over; a year-old stamp should be treated as unverified.
const STAMP_WARN_MONTHS = 6;
const STAMP_STALE_MONTHS = 12;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Extract the fact sheet's status stamp, e.g. `as of August 2026`.
 * @return {{month: Number, year: Number, label: String}|null} null when absent
 *   or unparseable — an unstamped sheet is not an error, just uncheckable.
 */
function parseSeedStamp(text) {
  const match = /as of\s+([A-Za-z]+)\s+(\d{4})/i.exec(text || '');
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  const year = Number(match[2]);
  if (month === -1 || !Number.isFinite(year)) return null;
  return { month, year, label: `${match[1]} ${match[2]}` };
}

/**
 * Age of the stamp in whole months, or null when there is no usable stamp.
 * A stamp in the future returns a negative age rather than null, so the caller
 * can flag it as the mistake it is.
 */
function seedStampAgeMonths(text, now = new Date()) {
  const stamp = parseSeedStamp(text);
  if (!stamp) return null;
  return (now.getFullYear() - stamp.year) * 12 + (now.getMonth() - stamp.month);
}

/**
 * Log a message proportionate to how stale the stamp is. Returns the level used
 * so callers and tests can assert on it without capturing console output.
 * @return {'ok'|'warn'|'stale'|'future'|'missing'}
 */
function checkSeedStamp(text, now = new Date()) {
  const stamp = parseSeedStamp(text);
  if (!stamp) {
    console.warn('bio-seed.md has no "as of <Month> <Year>" status stamp — status claims in it cannot be checked for staleness');
    return 'missing';
  }
  const age = seedStampAgeMonths(text, now);
  if (age < 0) {
    console.warn(`bio-seed.md is stamped "${stamp.label}", which is in the future — check the stamp`);
    return 'future';
  }
  if (age >= STAMP_STALE_MONTHS) {
    console.error(`bio-seed.md is stamped "${stamp.label}", ${age} months ago. Its "as of" claims — current title, active programmes, live appointments — are no longer verified. Review scripts/data/bio-seed.md and re-stamp it.`);
    return 'stale';
  }
  if (age >= STAMP_WARN_MONTHS) {
    console.warn(`bio-seed.md is stamped "${stamp.label}", ${age} months ago. Roles and appointments may have turned over — worth re-checking scripts/data/bio-seed.md.`);
    return 'warn';
  }
  return 'ok';
}

function readBioSeed() {
  if (!fs.existsSync(BIO_SEED_PATH)) {
    return null;
  }
  try {
    const text = fs.readFileSync(BIO_SEED_PATH, 'utf8').trim();
    checkSeedStamp(text);
    return text;
  } catch (err) {
    console.error(`Error reading bio seed at ${BIO_SEED_PATH}:`, err.message);
    return null;
  }
}

module.exports = {
  readBioSeed,
  BIO_SEED_PATH,
  _testing: { parseSeedStamp, seedStampAgeMonths, checkSeedStamp, STAMP_WARN_MONTHS, STAMP_STALE_MONTHS },
};

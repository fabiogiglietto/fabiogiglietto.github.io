/**
 * Bio Seed Loader
 *
 * Reads the authoritative, hand-maintained biography at scripts/data/bio-seed.md.
 * Generators consume this as the primary ground truth for Fabio's profile,
 * projects, software tools, memberships, and timeline — collected API data
 * is supplementary.
 */

const fs = require('fs');
const path = require('path');

const BIO_SEED_PATH = path.join(__dirname, '..', 'data', 'bio-seed.md');

function readBioSeed() {
  if (!fs.existsSync(BIO_SEED_PATH)) {
    return null;
  }
  try {
    return fs.readFileSync(BIO_SEED_PATH, 'utf8').trim();
  } catch (err) {
    console.error(`Error reading bio seed at ${BIO_SEED_PATH}:`, err.message);
    return null;
  }
}

module.exports = { readBioSeed, BIO_SEED_PATH };

/**
 * Own Paper Claims Collector
 *
 * Fetches, from fg-zettelkasten, what Fabio's OWN papers actually claim —
 * their Summary, Key Contributions and Findings sections — so that generated
 * prose about his research can be checked against the research itself rather
 * than against journalists' characterisations of it.
 *
 * This exists because the two are demonstrably not the same. The Meta political
 * content reduction paper finds that extremist accounts offset a per-post reach
 * decline by posting far more often; Italian coverage rendered that as "Facebook
 * premia gli estremisti" (Facebook rewards extremists), which asserts algorithmic
 * promotion the paper does not claim. Web mentions are evidence that coverage
 * happened. They are not evidence of what the research found.
 *
 * Own papers are identified by intersecting the bibtex keys in
 * `public/data/own-publications.json` with the notes tracked in the kasten's
 * `data/state.json`, then confirmed against each note's `kind: own` frontmatter.
 * That avoids fetching all ~278 notes to discover the ~26 that are his.
 *
 * Note bodies are cached by the kasten's own `content_hash`, so a daily run
 * re-fetches only notes that actually changed.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const STATE_URL =
  'https://raw.githubusercontent.com/fabiogiglietto/fg-zettelkasten/main/data/state.json';
const VAULT_RAW =
  'https://raw.githubusercontent.com/fabiogiglietto/fg-zettelkasten/main/vault/';

const OWN_PUBLICATIONS_PATH = path.join(__dirname, '../../public/data/own-publications.json');
const CACHE_PATH = path.join(__dirname, '../../public/data/own-paper-claims.json');

// Sections worth extracting. "Methods" is deliberately excluded: it is long and
// a biography never needs it.
const SECTIONS = ['Summary', 'Key Contributions', 'Findings'];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

/**
 * Read a single scalar out of a note's YAML frontmatter without a YAML parser —
 * the fields we need (kind, year, doi, title) are all simple scalars.
 */
function frontmatterValue(markdown, field) {
  const match = markdown.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Extract a `## Section` body from a note, stopping at the next heading.
 * Returns bullet lines as an array and prose as a single string.
 */
function extractSection(markdown, heading) {
  // `(?![\s\S])` is end-of-input. JavaScript has no \Z anchor — using one
  // would match a literal "Z" and silently drop every note's final section.
  const match = markdown.match(
    new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm')
  );
  if (!match) return null;
  const body = match[1].trim();
  if (!body) return null;
  const bullets = body
    .split('\n')
    .filter(line => /^\s*[-*]\s+/.test(line))
    .map(line => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);
  return bullets.length > 0 ? bullets : body;
}

function parseNote(markdown, bibtexKey) {
  // Defence in depth: the intersection should already guarantee this, but a
  // mis-keyed publication must not smuggle someone else's paper in as "own".
  if (frontmatterValue(markdown, 'kind') !== 'own') return null;

  const claims = {
    bibtexKey,
    title: frontmatterValue(markdown, 'title'),
    year: Number(frontmatterValue(markdown, 'year')) || null,
    doi: frontmatterValue(markdown, 'doi'),
  };
  for (const section of SECTIONS) {
    const extracted = extractSection(markdown, section);
    if (extracted) {
      claims[section.replace(/\s+/g, '')] = extracted;
    }
  }
  // A note with no substantive section is not worth carrying.
  return SECTIONS.some(s => claims[s.replace(/\s+/g, '')]) ? claims : null;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Bibtex keys of Fabio's own publications, from the already-collected feed.
 */
function ownBibtexKeys() {
  const own = readJson(OWN_PUBLICATIONS_PATH);
  const items = (own && own.items) || [];
  return new Set(
    items.map(i => i && i._academic && i._academic.bibtex_key).filter(Boolean)
  );
}

async function collect() {
  try {
    const state = JSON.parse(await fetchUrl(STATE_URL));
    const papers = (state && state.papers) || {};
    const ownKeys = ownBibtexKeys();
    if (ownKeys.size === 0) {
      console.log('Own paper claims: no own-publications.json bibtex keys — skipping');
      return null;
    }

    const cached = readJson(CACHE_PATH);
    const cachedByKey = new Map(
      ((cached && cached.papers) || []).map(p => [p.bibtexKey, p])
    );

    const targets = [];
    for (const [id, entry] of Object.entries(papers)) {
      const bibtexKey = id.replace(/^bibtex:/, '');
      if (!entry || !entry.note_path || !ownKeys.has(bibtexKey)) continue;
      targets.push({ bibtexKey, notePath: entry.note_path, contentHash: entry.content_hash });
    }

    const results = [];
    let fetched = 0;
    let reused = 0;
    for (const target of targets) {
      const previous = cachedByKey.get(target.bibtexKey);
      if (previous && previous.contentHash && previous.contentHash === target.contentHash) {
        results.push(previous);
        reused++;
        continue;
      }
      try {
        const markdown = await fetchUrl(VAULT_RAW + target.notePath);
        const parsed = parseNote(markdown, target.bibtexKey);
        fetched++;
        if (parsed) {
          results.push({ ...parsed, contentHash: target.contentHash });
        }
      } catch (noteError) {
        console.log(`  Could not fetch note for ${target.bibtexKey}: ${noteError.message}`);
        // Keep a stale copy rather than losing the paper entirely.
        if (previous) results.push(previous);
      }
    }

    results.sort((a, b) => (b.year || 0) - (a.year || 0));
    console.log(
      `Own paper claims: ${results.length} own papers (${fetched} fetched, ${reused} unchanged) of ${targets.length} candidates`
    );
    return { lastUpdated: new Date().toISOString(), source: STATE_URL, papers: results };
  } catch (error) {
    console.error('Error collecting own paper claims:', error.message);
    return null;
  }
}

module.exports = {
  collect,
  name: 'own-paper-claims',
  _testing: { parseNote, extractSection, frontmatterValue },
};

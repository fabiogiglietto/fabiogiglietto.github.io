/**
 * Shared deterministic BibTeX citation-key helper.
 *
 * The key is the stable identity of a paper across the research pipeline
 * (research-radio episode id / audio filename, fg-zettelkasten note name), so
 * it must be reproducible from publication metadata alone — never dependent on
 * iteration order or a collision counter.
 *
 * Format: `<LastName><Year>-<hash>` e.g. `Giglietto2026-a1b2c3d4`. The 8-hex-char
 * hash is seeded by the DOI when available, otherwise the normalized title, so
 * the same paper always yields the same key while accidental collisions between
 * distinct papers stay negligible.
 */

const crypto = require('crypto');

/** Extract the first author's last name, letters only. */
function firstAuthorLastName(authors) {
  if (!authors) return 'Unknown';
  const first = String(authors).split(/[,;&]|\sand\s/)[0].trim();
  const parts = first.split(/\s+/).filter(Boolean);
  const last = (parts[parts.length - 1] || '').replace(/[^a-zA-Z]/g, '');
  return last || 'Unknown';
}

/** Deterministic short hash seeded by DOI (preferred) or normalized title. */
function keyHash(pub) {
  const seed = (pub.doi || pub.title || '')
    .toString()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('md5').update(seed).digest('hex').slice(0, 8);
}

/**
 * Generate a deterministic BibTeX key for a publication object.
 * `pub` needs `authors` (string), `year`, and `doi` or `title`.
 */
function generateBibtexKey(pub) {
  const lastName = firstAuthorLastName(pub.authors);
  const year = pub.year || 'XXXX';
  return `${lastName}${year}-${keyHash(pub)}`;
}

module.exports = { generateBibtexKey, firstAuthorLastName };

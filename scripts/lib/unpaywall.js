/**
 * Unpaywall — resolve a direct open-access PDF URL for a DOI.
 *
 * Fallback for the own-publications feed when ORA has no green-OA copy:
 * Unpaywall indexes OA full text across publishers, repositories, arXiv and
 * PubMed Central. Only a *direct* PDF link (`url_for_pdf`) is returned —
 * landing pages are skipped, since downstream consumers need a downloadable
 * PDF, not an HTML page.
 *
 * The API requires an `email` query parameter to identify the caller; it is
 * not a secret and not an API key.
 */

const https = require('https');

const UNPAYWALL_API = 'https://api.unpaywall.org/v2';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Return a direct OA PDF URL for `doi`, or null when none is available.
 * Never throws — a failed lookup resolves to null so the caller falls back.
 */
async function resolveOaPdf(doi, email) {
  if (!doi || !email) return null;
  const url = `${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  try {
    const data = await fetchJson(url);
    if (!data || !data.is_oa) return null;
    // Scan the best location first, then every other OA location.
    const locations = [data.best_oa_location, ...(data.oa_locations || [])];
    for (const loc of locations) {
      if (loc && loc.url_for_pdf) return loc.url_for_pdf;
    }
    return null;
  } catch (err) {
    console.warn(`  Unpaywall: lookup failed for ${doi}: ${err.message}`);
    return null;
  }
}

module.exports = { resolveOaPdf };

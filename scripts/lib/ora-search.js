/**
 * ORA UNIURB - resolve a direct open-access PDF URL by DOI search.
 *
 * Fallback for own-publications when ORA's OAI-PMH endpoint hasn't yet
 * indexed a newly-deposited record. ORCID surfaces an author's paper on
 * publication day, but ORA's OAI publication of the metadata can lag by
 * days/weeks even when the PDF is already deposited and browseable on the
 * author's ORA page.
 *
 * Two-step lookup against the public site (no auth, OAI-PMH bypassed):
 *   1. /simple-search?query=<DOI>  -> returns the matching /handle/<id> URL
 *   2. fetch the handle page       -> read its `citation_pdf_url` meta tag
 *
 * Returns null when nothing matches. Never throws.
 */

const https = require('https');

const ORA_BASE = 'https://ora.uniurb.it';
const UA = 'Mozilla/5.0';
const TIMEOUT_MS = 20000;

class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchText(next).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new HttpError(res.statusCode));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
  });
}

/**
 * Return the first `/handle/<id>` URL found on the search results page,
 * or null when no record matches the DOI.
 */
async function findOraHandleByDoi(doi) {
  if (!doi) return null;
  const url = `${ORA_BASE}/simple-search?query=${encodeURIComponent(doi)}`;
  try {
    const html = await fetchText(url);
    const match = html.match(/href=["'](\/handle\/[^"']+)["']/);
    return match ? new URL(match[1], ORA_BASE).toString() : null;
  } catch (err) {
    // ORA returns 404 when no records match the DOI -- that's the common case
    // for any paper not in the institutional repository (datasets, preprints,
    // external journals). Treat as "no match", not as an error.
    if (err.status === 404) return null;
    console.warn(`  ORA search: failed for ${doi}: ${err.message}`);
    return null;
  }
}

/**
 * Read the `citation_pdf_url` meta tag from an ORA handle landing page.
 * Returns null when the record has no public PDF or the page is unreachable.
 */
async function fetchOaPdfFromHandle(handleUrl) {
  if (!handleUrl) return null;
  try {
    const html = await fetchText(handleUrl);
    const tag = (html.match(/<meta\b[^>]*name=["']citation_pdf_url["'][^>]*>/i) || [])[0];
    if (!tag) return null;
    const content = tag.match(/content=["']([^"']+)["']/i);
    return content ? content[1] : null;
  } catch (err) {
    console.warn(`  ORA handle fetch: failed for ${handleUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Resolve a direct OA PDF URL for `doi` via ORA's public site.
 * Returns null when ORA has no matching record or no deposited PDF.
 */
async function findOraPdfByDoi(doi) {
  const handleUrl = await findOraHandleByDoi(doi);
  if (!handleUrl) return null;
  return fetchOaPdfFromHandle(handleUrl);
}

module.exports = { findOraPdfByDoi };

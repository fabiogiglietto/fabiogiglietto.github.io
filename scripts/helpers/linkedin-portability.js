/**
 * LinkedIn Member Data Portability client
 *
 * Reads Fabio's own LinkedIn posts for the News & Updates aggregator.
 *
 * LinkedIn closed the ordinary post-reading endpoints (`/v2/posts`,
 * `/v2/ugcPosts`, `/v2/shares`) to personal apps: they need `r_member_social`,
 * which is granted to approved partners only. The route that remains is the
 * Member Data Portability API LinkedIn offers under the EU Digital Markets Act
 * — self-serve, scope `r_dma_portability_self_serve`, available to members in
 * the EEA and Switzerland. Its Snapshot API returns the same rows as the
 * `Shares.csv` of a LinkedIn data export, under the `MEMBER_SHARE_INFO` domain.
 *
 * Setup and token renewal: API_SETUP.md.
 */

const axios = require('axios');
const config = require('../config');

const API_ORIGIN = 'https://api.linkedin.com';
const SNAPSHOT_PATH = '/rest/memberSnapshotData';
const INTROSPECT_URL = 'https://www.linkedin.com/oauth/v2/introspectToken';

// The Snapshot API accepts this version only; any other answers
// `426 NONEXISTENT_VERSION`.
const API_VERSION = '202312';
const SHARE_DOMAIN = 'MEMBER_SHARE_INFO';

// `paging.total` is unreliable (LinkedIn's own docs), so pages are followed
// until there is no `next` link or a 404 — with this as the ceiling.
const MAX_PAGES = 300;
const REQUEST_TIMEOUT_MS = 15000;

// Only posts LinkedIn marks with one of these visibilities reach the public
// website. Anything else — including a value this code has never seen — is
// dropped: publishing a restricted post is worse than missing a public one.
//
// `MEMBER_NETWORK` is what the snapshot calls an ordinary "Anyone" post.
// Verified 2026-10-02: all 122 rows carried it, and the recent ones sampled
// were readable by a logged-out visitor. What a connections-only post is
// labelled has not been observed — there was none to look at.
const PUBLIC_VISIBILITIES = new Set(['MEMBER_NETWORK', 'PUBLIC']);

const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a snapshot `Date` into an ISO string, or null if it is not a date.
 *
 * Snapshot rows carry `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker, which
 * `new Date()` would read as local time.
 */
function parseLinkedInDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  let text = value.trim().replace(/\s+UTC$/i, 'Z');
  const bare = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/);
  if (bare) {
    text = `${bare[1]}T${bare[2]}Z`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Pull the post URN out of a `ShareLink`, which arrives percent-encoded
 * (`.../feed/update/urn%3Ali%3Ashare%3A123`).
 *
 * Returns null for anything that is not a feed post. That is deliberate for
 * `urn:li:groupPost`: posts made inside a group carry the same
 * `MEMBER_NETWORK` visibility as public ones, so the link is the only thing
 * that tells them apart.
 */
function extractShareUrn(link) {
  if (typeof link !== 'string') {
    return null;
  }
  let decoded = link;
  try {
    decoded = decodeURIComponent(link);
  } catch {
    // Malformed escape — match against the raw string instead.
  }
  const match = decoded.match(/urn:li:(?:share|ugcPost):\d+/);
  return match ? match[0] : null;
}

/**
 * The link ends up in an href on the homepage, so accept it only if it is an
 * https URL on linkedin.com; otherwise fall back to the profile.
 */
function safeLinkedInUrl(link) {
  try {
    const url = new URL(link);
    const onLinkedIn = url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com');
    if (url.protocol === 'https:' && onLinkedIn) {
      return url.toString();
    }
  } catch {
    // Not a URL at all.
  }
  return config.social.linkedin.url;
}

/**
 * Turn snapshot rows into the post shape the aggregator expects, keeping only
 * public, dated feed posts that have text of their own.
 *
 * Undated rows are dropped rather than stamped with today's date: a post that
 * cannot be dated would otherwise always look brand new.
 */
function selectPublicPosts(rows) {
  const posts = [];
  const seen = new Set();
  const stats = {
    total: 0,
    kept: 0,
    notPublic: 0,
    notFeedPost: 0,
    undated: 0,
    empty: 0,
    byVisibility: {}
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    stats.total++;

    const visibility = String(row.Visibility || 'UNKNOWN')
      .trim()
      .toUpperCase();
    stats.byVisibility[visibility] = (stats.byVisibility[visibility] || 0) + 1;
    if (!PUBLIC_VISIBILITIES.has(visibility)) {
      stats.notPublic++;
      continue;
    }

    const id = extractShareUrn(row.ShareLink);
    if (!id) {
      stats.notFeedPost++;
      continue;
    }

    const date = parseLinkedInDate(row.Date);
    if (!date) {
      stats.undated++;
      continue;
    }

    const content = typeof row.ShareCommentary === 'string' ? row.ShareCommentary.trim() : '';
    if (!content) {
      stats.empty++;
      continue;
    }

    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    posts.push({
      id,
      content,
      date,
      platform: 'LinkedIn',
      url: safeLinkedInUrl(row.ShareLink)
    });
  }

  stats.kept = posts.length;
  return { posts, stats };
}

function nextPagePath(paging) {
  const links = paging && Array.isArray(paging.links) ? paging.links : [];
  const next = links.find(link => link && link.rel === 'next');
  // Follow the link only if it stays on the snapshot endpoint — the bearer
  // token goes wherever this path points.
  return next && typeof next.href === 'string' && next.href.startsWith(`${SNAPSHOT_PATH}?`)
    ? next.href
    : null;
}

/**
 * Fetch every `MEMBER_SHARE_INFO` row. Throws on any failure other than the
 * 404 LinkedIn uses to say "no more pages".
 */
async function fetchShareRows(token, { http = axios, maxPages = MAX_PAGES } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Linkedin-Version': API_VERSION,
    'Content-Type': 'application/json'
  };

  const rows = [];
  const visited = new Set();
  let path = `${SNAPSHOT_PATH}?q=criteria&domain=${SHARE_DOMAIN}`;
  let pages = 0;

  while (path && pages < maxPages && !visited.has(path)) {
    visited.add(path);

    let response;
    try {
      response = await http.get(`${API_ORIGIN}${path}`, { headers, timeout: REQUEST_TIMEOUT_MS });
    } catch (error) {
      if (error.response && error.response.status === 404) {
        break;
      }
      throw error;
    }
    pages++;

    const elements = Array.isArray(response.data && response.data.elements)
      ? response.data.elements
      : [];
    for (const element of elements) {
      if (
        element &&
        element.snapshotDomain === SHARE_DOMAIN &&
        Array.isArray(element.snapshotData)
      ) {
        rows.push(...element.snapshotData);
      }
    }

    path = nextPagePath(response.data && response.data.paging);
  }

  return { rows, pages, truncated: Boolean(path) && pages >= maxPages };
}

/**
 * Fetch Fabio's public LinkedIn posts. Throws on API failure — the caller
 * decides how to degrade.
 */
async function fetchPublicPosts(token, options = {}) {
  const { rows, pages, truncated } = await fetchShareRows(token, options);
  const { posts, stats } = selectPublicPosts(rows);
  return { posts, stats: { ...stats, pages, truncated } };
}

/**
 * Days until the access token expires, or null when that cannot be determined
 * (no client credentials, or the introspection call failed). The token is
 * renewed by hand and the previous one sat expired for over a year before
 * anyone noticed — this exists so a run can warn before the token dies instead
 * of after.
 */
async function daysUntilExpiry(token, { clientId, clientSecret, http = axios, now = Date.now() }) {
  if (!token || !clientId || !clientSecret) {
    return null;
  }
  try {
    const response = await http.post(
      INTROSPECT_URL,
      new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
      { timeout: REQUEST_TIMEOUT_MS }
    );
    const expiresAt = response.data && response.data.expires_at;
    if (!response.data || !response.data.active || typeof expiresAt !== 'number') {
      return null;
    }
    return Math.floor((expiresAt * 1000 - now) / DAY_MS);
  } catch {
    return null;
  }
}

/**
 * One-line, token-free explanation of a failed call. Axios errors carry the
 * request headers, so the error object itself is never logged.
 */
function describeError(error) {
  const status = error && error.response && error.response.status;
  const code = error && error.response && error.response.data && error.response.data.code;
  const detail = code ? ` (${code})` : '';

  switch (status) {
    case 401:
      return `access token expired or revoked${detail} — generate a new one (API_SETUP.md) and update the LINKEDIN_ACCESS_TOKEN secret`;
    case 403:
      return `access denied${detail} — the app lacks the "Member Data Portability API (Member)" product or the token lacks the r_dma_portability_self_serve scope`;
    case 426:
      return `LinkedIn rejected API version ${API_VERSION}${detail}`;
    case 429:
      return `rate limited${detail}`;
    default:
      return status
        ? `HTTP ${status}${detail}`
        : `request failed: ${(error && error.code) || 'unknown error'}`;
  }
}

module.exports = {
  fetchPublicPosts,
  daysUntilExpiry,
  describeError,
  EXPIRY_WARNING_DAYS,
  _testing: {
    parseLinkedInDate,
    extractShareUrn,
    safeLinkedInUrl,
    selectPublicPosts,
    fetchShareRows,
    nextPagePath,
    API_VERSION,
    MAX_PAGES
  }
};

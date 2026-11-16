/**
 * Mastodon API client
 *
 * Reads Fabio's own Mastodon posts through the instance's REST API — never by
 * scraping the profile page, which aoir.social answers with 403 for
 * datacenter clients. Used by the News collector (collectors/news.js) and by
 * the News & Updates aggregator (collectors/social-media-aggregator.js).
 *
 *   GET /api/v1/accounts/lookup?acct=<username>    -> account id
 *   GET /api/v1/accounts/<id>/statuses             -> newest statuses first
 *
 * Both endpoints are public for a public account. MASTODON_ACCESS_TOKEN is
 * sent when present (some instances restrict unauthenticated API access), but
 * an owner's token also returns followers-only and direct posts, so only
 * `visibility: public` statuses ever leave this module.
 */

const axios = require('axios');
const config = require('../config');

const TIMEOUT_MS = 10000;
const DEFAULT_LIMIT = 20; // the API caps a page at 40
const PUBLIC = 'public';

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[^;\s]+;/g, ' ')
    .trim();
}

/** Only public posts reach the website. */
function selectPublicStatuses(statuses) {
  return (statuses || []).filter(s => s && s.visibility === PUBLIC && s.url && s.created_at);
}

/** Describe a failure without echoing request headers (the token). */
function describeError(error) {
  if (error.code === 'ECONNABORTED') return 'request timed out';
  const status = error.response?.status;
  if (status === 401) return 'HTTP 401 — MASTODON_ACCESS_TOKEN rejected';
  if (status === 404) return 'HTTP 404 — account not found on the instance';
  if (status) return `HTTP ${status}`;
  return error.message;
}

/**
 * Fetch the account's newest public, original (non-reply, non-boost) statuses.
 * Throws on failure so the caller can tell "failed" from "no posts".
 *
 * @param {object} [options]
 * @param {object} [options.http] - axios-compatible client (injected in tests)
 * @param {string} [options.instance]
 * @param {string} [options.username]
 * @param {string} [options.token]
 * @param {number} [options.limit]
 * @returns {Promise<object[]>} raw Mastodon status objects
 */
async function fetchPublicStatuses({
  http = axios,
  instance = config.social.mastodon.instance,
  username = config.social.mastodon.username,
  token = process.env.MASTODON_ACCESS_TOKEN,
  limit = DEFAULT_LIMIT
} = {}) {
  const headers = {
    'User-Agent': 'FabioGigliettoAcademicWebsite/1.0',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  try {
    const account = await http.get(`https://${instance}/api/v1/accounts/lookup`, {
      params: { acct: username },
      headers,
      timeout: TIMEOUT_MS
    });
    const accountId = account.data?.id;
    if (!accountId) throw new Error(`lookup returned no id for @${username}@${instance}`);

    const statuses = await http.get(`https://${instance}/api/v1/accounts/${accountId}/statuses`, {
      params: { limit, exclude_replies: true, exclude_reblogs: true },
      headers,
      timeout: TIMEOUT_MS
    });
    if (!Array.isArray(statuses.data)) throw new Error('statuses response is not a list');
    return selectPublicStatuses(statuses.data);
  } catch (error) {
    // Re-throw a clean error: axios errors carry the request config, token included.
    throw new Error(`Mastodon API (${instance}): ${describeError(error)}`);
  }
}

module.exports = {
  fetchPublicStatuses,
  stripHtml,
  _testing: { selectPublicStatuses, describeError }
};

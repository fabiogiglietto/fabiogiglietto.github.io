/**
 * News collector — Fabio's recent Mastodon posts, via the Mastodon API.
 *
 * Writes public/data/news.json, which the health check reports as
 * "News (Mastodon)". It used to scrape six HTML pages (Mastodon, Threads,
 * LinkedIn, BlueSky, the university news page, Google News) with generic CSS
 * selectors; none of them yielded posts and aoir.social answered 403. No
 * scraping here: the posts come from the platform API (helpers/mastodon-api.js).
 *
 * Returns null on failure, so health records "failed" rather than "empty".
 */

const mastodon = require('../helpers/mastodon-api');

const MAX_ITEMS = 10;
const TITLE_CHARS = 100;

function toNewsItem(status) {
  const text = mastodon.stripHtml(status.content);
  const firstLine = text.split('\n').find(line => line.trim()) || 'Mastodon post';
  return {
    title: firstLine.length > TITLE_CHARS ? `${firstLine.slice(0, TITLE_CHARS - 1)}…` : firstLine,
    date: status.created_at,
    summary: text,
    url: status.url,
    source: 'Mastodon'
  };
}

async function collect({ http } = {}) {
  console.log('Collecting News data (Mastodon API)...');
  try {
    const statuses = await mastodon.fetchPublicStatuses(http ? { http } : {});
    const news = statuses
      .map(toNewsItem)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, MAX_ITEMS);
    console.log(`News: ${news.length} Mastodon posts`);
    return { news, lastUpdated: new Date().toISOString() };
  } catch (error) {
    console.error('News collection error:', error.message);
    return null;
  }
}

module.exports = {
  collect,
  name: 'news',
  _testing: { toNewsItem }
};

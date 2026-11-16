/**
 * Tests for mastodon-api.js and the News collector built on it.
 *
 * Covers the publish-path guard — only public posts reach the website, even
 * though the owner's token also returns private ones — the request shape, and
 * token-free errors. The HTTP client is injected, so nothing touches the network.
 */

const mastodon = require('../scripts/helpers/mastodon-api');
const news = require('../scripts/collectors/news');
const { selectPublicStatuses } = mastodon._testing;

function status(overrides = {}) {
  return {
    id: '1',
    created_at: '2026-11-10T09:00:00.000Z',
    visibility: 'public',
    url: 'https://aoir.social/@fabiogiglietto/1',
    content: '<p>New paper on coordinated link sharing &amp; elections.</p><p>Read it here.</p>',
    tags: [],
    ...overrides
  };
}

function fakeHttp(statuses, { lookupId = '42' } = {}) {
  const calls = [];
  return {
    calls,
    get: jest.fn(async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/v1/accounts/lookup')) return { data: { id: lookupId } };
      if (url.includes('/statuses')) return { data: statuses };
      throw new Error(`unexpected url ${url}`);
    })
  };
}

function httpError(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status };
  error.config = { headers: { Authorization: 'Bearer secret-token' } };
  return error;
}

describe('selectPublicStatuses', () => {
  test('drops followers-only, direct and unlisted posts', () => {
    const kept = selectPublicStatuses([
      status({ id: 'a' }),
      status({ id: 'b', visibility: 'private' }),
      status({ id: 'c', visibility: 'direct' }),
      status({ id: 'd', visibility: 'unlisted' })
    ]);
    expect(kept.map(s => s.id)).toEqual(['a']);
  });

  test('drops entries without url or date', () => {
    expect(
      selectPublicStatuses([status({ url: null }), status({ created_at: null }), null])
    ).toEqual([]);
  });
});

describe('fetchPublicStatuses', () => {
  test('looks up the account, then reads original statuses through the API', async () => {
    const http = fakeHttp([status()]);
    const out = await mastodon.fetchPublicStatuses({
      http,
      instance: 'aoir.social',
      username: 'fabiogiglietto',
      token: ''
    });
    expect(out).toHaveLength(1);
    expect(http.calls[0].url).toBe('https://aoir.social/api/v1/accounts/lookup');
    expect(http.calls[0].options.params).toEqual({ acct: 'fabiogiglietto' });
    expect(http.calls[1].url).toBe('https://aoir.social/api/v1/accounts/42/statuses');
    expect(http.calls[1].options.params).toMatchObject({
      exclude_replies: true,
      exclude_reblogs: true
    });
    expect(http.calls[1].options.headers.Authorization).toBeUndefined();
  });

  test('sends the token when present', async () => {
    const http = fakeHttp([status()]);
    await mastodon.fetchPublicStatuses({ http, instance: 'x.social', username: 'u', token: 'tok' });
    expect(http.calls[1].options.headers.Authorization).toBe('Bearer tok');
  });

  test('errors never carry the token', async () => {
    const http = { get: jest.fn(async () => Promise.reject(httpError(401))) };
    await expect(
      mastodon.fetchPublicStatuses({
        http,
        instance: 'x.social',
        username: 'u',
        token: 'secret-token'
      })
    ).rejects.toThrow(/401/);
    await mastodon
      .fetchPublicStatuses({ http, instance: 'x.social', username: 'u', token: 'secret-token' })
      .catch(e => expect(JSON.stringify(e) + e.message).not.toContain('secret-token'));
  });
});

describe('news collector', () => {
  test('maps public statuses to news items, newest first', async () => {
    const http = fakeHttp([
      status({ id: 'old', created_at: '2026-11-01T00:00:00Z', url: 'https://aoir.social/@f/old' }),
      status({ id: 'new', created_at: '2026-11-12T00:00:00Z', url: 'https://aoir.social/@f/new' }),
      status({ id: 'priv', visibility: 'private' })
    ]);
    const out = await news.collect({ http });
    expect(out.news.map(n => n.url)).toEqual([
      'https://aoir.social/@f/new',
      'https://aoir.social/@f/old'
    ]);
    expect(out.news[0]).toMatchObject({
      source: 'Mastodon',
      title: 'New paper on coordinated link sharing & elections.',
      summary: 'New paper on coordinated link sharing & elections.\n\nRead it here.'
    });
  });

  test('returns null on API failure, so health records "failed" not "empty"', async () => {
    const http = { get: jest.fn(async () => Promise.reject(httpError(503))) };
    expect(await news.collect({ http })).toBeNull();
  });
});

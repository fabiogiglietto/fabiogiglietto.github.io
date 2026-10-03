/**
 * Tests for linkedin-portability.js
 *
 * Covers the publish-path guards — only public, dated posts with text reach
 * the website — plus pagination and the token-free error descriptions. The
 * HTTP client is injected, so nothing here touches the network.
 */

const linkedin = require('../scripts/helpers/linkedin-portability');
const { parseLinkedInDate, extractShareUrn, safeLinkedInUrl, selectPublicPosts, fetchShareRows } =
  linkedin._testing;

const PROFILE_URL = 'https://www.linkedin.com/in/fabiogiglietto';
const SHARE_LINK = 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7240000000000000001';

function share(overrides = {}) {
  return {
    Date: '2026-09-12 08:30:11',
    ShareLink: SHARE_LINK,
    ShareCommentary: 'New paper out on coordinated link sharing.',
    SharedUrl: '',
    MediaUrl: '',
    Visibility: 'MEMBER_NETWORK',
    ...overrides
  };
}

function page(rows, nextHref) {
  return {
    data: {
      paging: { links: nextHref ? [{ rel: 'next', href: nextHref }] : [] },
      elements: [{ snapshotDomain: 'MEMBER_SHARE_INFO', snapshotData: rows }]
    }
  };
}

function httpError(status, code) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: { status, code } };
  error.config = { headers: { Authorization: 'Bearer secret-token' } };
  return error;
}

describe('parseLinkedInDate', () => {
  test('reads a zoneless snapshot timestamp as UTC', () => {
    expect(parseLinkedInDate('2026-09-12 08:30:11')).toBe('2026-09-12T08:30:11.000Z');
  });

  test('accepts an explicit UTC suffix and epoch milliseconds', () => {
    expect(parseLinkedInDate('2026-09-12 08:30:11 UTC')).toBe('2026-09-12T08:30:11.000Z');
    expect(parseLinkedInDate(Date.UTC(2026, 8, 12, 8, 30, 11))).toBe('2026-09-12T08:30:11.000Z');
  });

  test('returns null rather than inventing a date', () => {
    expect(parseLinkedInDate('')).toBeNull();
    expect(parseLinkedInDate('not a date')).toBeNull();
    expect(parseLinkedInDate(undefined)).toBeNull();
  });
});

describe('extractShareUrn', () => {
  test('decodes the percent-encoded URN in a ShareLink', () => {
    expect(extractShareUrn(SHARE_LINK)).toBe('urn:li:share:7240000000000000001');
  });

  test('reads ugcPost URNs as well as share URNs', () => {
    expect(
      extractShareUrn(
        'https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A7504087293931053056'
      )
    ).toBe('urn:li:ugcPost:7504087293931053056');
  });

  test('returns null when there is no feed-post URN', () => {
    expect(extractShareUrn(PROFILE_URL)).toBeNull();
    expect(extractShareUrn(undefined)).toBeNull();
    expect(
      extractShareUrn('https://www.linkedin.com/feed/update/urn%3Ali%3AgroupPost%3A1792820-649119')
    ).toBeNull();
  });
});

describe('safeLinkedInUrl', () => {
  test('keeps an https linkedin.com link', () => {
    expect(safeLinkedInUrl(SHARE_LINK)).toBe(SHARE_LINK);
  });

  test('falls back to the profile for anything else', () => {
    expect(safeLinkedInUrl('javascript:alert(1)')).toBe(PROFILE_URL);
    expect(safeLinkedInUrl('https://linkedin.com.evil.example/feed')).toBe(PROFILE_URL);
    expect(safeLinkedInUrl('http://www.linkedin.com/feed/update/x')).toBe(PROFILE_URL);
    expect(safeLinkedInUrl(undefined)).toBe(PROFILE_URL);
  });
});

describe('selectPublicPosts', () => {
  test('maps a public share to the aggregator post shape', () => {
    const { posts } = selectPublicPosts([share()]);

    expect(posts).toEqual([
      {
        id: 'urn:li:share:7240000000000000001',
        content: 'New paper out on coordinated link sharing.',
        date: '2026-09-12T08:30:11.000Z',
        platform: 'LinkedIn',
        url: SHARE_LINK
      }
    ]);
  });

  test('keeps both visibility values known to mean public', () => {
    const { posts } = selectPublicPosts([
      share(),
      share({
        Visibility: 'PUBLIC',
        ShareLink: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7240000000000000002'
      })
    ]);

    expect(posts).toHaveLength(2);
  });

  test('drops every post with any other visibility', () => {
    const { posts, stats } = selectPublicPosts([
      share({ Visibility: 'CONNECTIONS' }),
      share({ Visibility: 'SOMETHING_NEW' }),
      share({ Visibility: undefined })
    ]);

    expect(posts).toEqual([]);
    expect(stats.notPublic).toBe(3);
    expect(stats.byVisibility).toEqual({ CONNECTIONS: 1, SOMETHING_NEW: 1, UNKNOWN: 1 });
  });

  test('drops group posts, which carry the same visibility as public ones', () => {
    const { posts, stats } = selectPublicPosts([
      share({
        ShareLink: 'https://www.linkedin.com/feed/update/urn%3Ali%3AgroupPost%3A1792820-649119'
      }),
      share({ ShareLink: '' })
    ]);

    expect(posts).toEqual([]);
    expect(stats.notFeedPost).toBe(2);
  });

  test('drops undated posts instead of dating them today', () => {
    const { posts, stats } = selectPublicPosts([share({ Date: '' })]);

    expect(posts).toEqual([]);
    expect(stats.undated).toBe(1);
  });

  test('drops reshares with no commentary', () => {
    const { posts, stats } = selectPublicPosts([share({ ShareCommentary: '   ' })]);

    expect(posts).toEqual([]);
    expect(stats.empty).toBe(1);
  });

  test('keeps one copy of a post repeated across pages', () => {
    const { posts, stats } = selectPublicPosts([share(), share()]);

    expect(posts).toHaveLength(1);
    expect(stats.total).toBe(2);
    expect(stats.kept).toBe(1);
  });

  test('tolerates malformed input', () => {
    expect(selectPublicPosts(undefined).posts).toEqual([]);
    expect(selectPublicPosts([null, 'row', 42]).posts).toEqual([]);
  });
});

describe('fetchShareRows', () => {
  test('sends the bearer token and the only API version the endpoint accepts', async () => {
    const http = { get: jest.fn().mockResolvedValue(page([share()])) };

    await fetchShareRows('tok', { http });

    const [url, options] = http.get.mock.calls[0];
    expect(url).toBe(
      'https://api.linkedin.com/rest/memberSnapshotData?q=criteria&domain=MEMBER_SHARE_INFO'
    );
    expect(options.headers.Authorization).toBe('Bearer tok');
    expect(options.headers['Linkedin-Version']).toBe('202312');
  });

  test('follows next links and stops at the 404 that ends the history', async () => {
    const next1 = '/rest/memberSnapshotData?q=criteria&domain=MEMBER_SHARE_INFO&start=1';
    const next2 = '/rest/memberSnapshotData?q=criteria&domain=MEMBER_SHARE_INFO&start=2';
    const http = {
      get: jest
        .fn()
        .mockResolvedValueOnce(page([share({ Date: '2026-09-12 08:00:00' })], next1))
        .mockResolvedValueOnce(page([share({ Date: '2026-09-11 08:00:00' })], next2))
        .mockRejectedValueOnce(httpError(404))
    };

    const { rows, pages, truncated } = await fetchShareRows('tok', { http });

    expect(rows).toHaveLength(2);
    expect(pages).toBe(2);
    expect(truncated).toBe(false);
    expect(http.get.mock.calls[1][0]).toBe(`https://api.linkedin.com${next1}`);
  });

  test('never sends the token to a next link off the snapshot endpoint', async () => {
    const http = {
      get: jest.fn().mockResolvedValue(page([share()], 'https://evil.example/rest/steal'))
    };

    await fetchShareRows('tok', { http });

    expect(http.get).toHaveBeenCalledTimes(1);
  });

  test('reports truncation when the page ceiling is hit', async () => {
    let n = 0;
    const http = {
      get: jest.fn(async () => page([share()], `/rest/memberSnapshotData?q=criteria&start=${++n}`))
    };

    const { pages, truncated } = await fetchShareRows('tok', { http, maxPages: 3 });

    expect(pages).toBe(3);
    expect(truncated).toBe(true);
  });

  test('ignores rows from other snapshot domains', async () => {
    const http = {
      get: jest.fn().mockResolvedValue({
        data: { elements: [{ snapshotDomain: 'INBOX', snapshotData: [{ CONTENT: 'private' }] }] }
      })
    };

    const { rows } = await fetchShareRows('tok', { http });

    expect(rows).toEqual([]);
  });

  test('propagates failures other than the terminating 404', async () => {
    const http = { get: jest.fn().mockRejectedValue(httpError(401, 'EXPIRED_ACCESS_TOKEN')) };

    await expect(fetchShareRows('tok', { http })).rejects.toMatchObject({
      response: { status: 401 }
    });
  });
});

describe('daysUntilExpiry', () => {
  const now = Date.UTC(2026, 9, 1);
  const credentials = { clientId: 'id', clientSecret: 'secret', now };

  test('returns whole days left on an active token', async () => {
    const expiresAt = (now + 10.5 * 24 * 60 * 60 * 1000) / 1000;
    const http = {
      post: jest.fn().mockResolvedValue({ data: { active: true, expires_at: expiresAt } })
    };

    expect(await linkedin.daysUntilExpiry('tok', { ...credentials, http })).toBe(10);
  });

  test('returns null without client credentials, without calling LinkedIn', async () => {
    const http = { post: jest.fn() };

    expect(await linkedin.daysUntilExpiry('tok', { http, now })).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
  });

  test('returns null when introspection fails or the token is inactive', async () => {
    const failing = { post: jest.fn().mockRejectedValue(new Error('network')) };
    const inactive = { post: jest.fn().mockResolvedValue({ data: { active: false } }) };

    expect(await linkedin.daysUntilExpiry('tok', { ...credentials, http: failing })).toBeNull();
    expect(await linkedin.daysUntilExpiry('tok', { ...credentials, http: inactive })).toBeNull();
  });
});

describe('describeError', () => {
  test('names the fix for an expired token', () => {
    const message = linkedin.describeError(httpError(401, 'EXPIRED_ACCESS_TOKEN'));

    expect(message).toContain('expired or revoked');
    expect(message).toContain('EXPIRED_ACCESS_TOKEN');
  });

  test('names the missing product or scope on 403', () => {
    expect(linkedin.describeError(httpError(403, 'ACCESS_DENIED'))).toContain(
      'r_dma_portability_self_serve'
    );
  });

  test('never includes the bearer token', () => {
    for (const status of [401, 403, 426, 429, 500]) {
      expect(linkedin.describeError(httpError(status))).not.toContain('secret-token');
    }
  });

  test('describes a failure with no HTTP response', () => {
    const error = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });

    expect(linkedin.describeError(error)).toBe('request failed: ECONNABORTED');
  });
});

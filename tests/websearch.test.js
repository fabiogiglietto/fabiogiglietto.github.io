/**
 * Tests for websearch.js
 *
 * Tests the core utility functions used for web mention filtering,
 * date extraction, and normalization.
 */

const { _testing } = require('../scripts/collectors/websearch');
const {
  normalizeUrl,
  normalizeTitle,
  shouldSkipResult,
  isDatePlausible,
  extractDateFromHTTP,
  extractJsonLdDate,
  parseToYMD
} = _testing;

// Mock axios for extractDateFromHTTP tests
jest.mock('axios', () => ({
  get: jest.fn(),
  head: jest.fn()
}));
const axios = require('axios');

describe('normalizeUrl', () => {
  test('removes tracking parameters', () => {
    const url = 'https://example.com/article?utm_source=twitter&utm_medium=social&id=123';
    const normalized = normalizeUrl(url);
    expect(normalized).not.toContain('utm_source');
    expect(normalized).not.toContain('utm_medium');
    expect(normalized).toContain('id=123');
  });

  test('removes www. prefix', () => {
    const url = 'https://www.example.com/article';
    expect(normalizeUrl(url)).toBe('example.com/article');
  });

  test('removes trailing slash', () => {
    const url = 'https://example.com/article/';
    expect(normalizeUrl(url)).toBe('example.com/article');
  });

  test('lowercases the URL', () => {
    const url = 'https://Example.COM/Article';
    expect(normalizeUrl(url)).toBe('example.com/article');
  });

  test('handles Google News RSS redirect URLs', () => {
    const url = 'https://news.google.com/rss/articles/abc123';
    const normalized = normalizeUrl(url);
    expect(normalized).toBe('news.google.com:abc123');
  });

  test('handles invalid URLs gracefully', () => {
    const url = 'not-a-url';
    expect(normalizeUrl(url)).toBe('not-a-url');
  });

  test('sorts remaining query parameters', () => {
    const url = 'https://example.com/page?z=1&a=2';
    expect(normalizeUrl(url)).toBe('example.com/page?a=2&z=1');
  });
});

describe('normalizeTitle', () => {
  test('removes common site name suffixes', () => {
    expect(normalizeTitle('Article Title - ResearchGate')).toBe('article title');
    expect(normalizeTitle('News Story | EURACTIV.ro')).toBe('news story');
  });

  test('normalizes whitespace', () => {
    expect(normalizeTitle('  Multiple   Spaces  ')).toBe('multiple spaces');
  });

  test('handles empty and null input', () => {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
  });

  test('normalizes dashes', () => {
    const result = normalizeTitle('Article \u2013 with dashes \u2014 here');
    expect(result).toBe('article - with dashes - here');
  });

  test('removes Request PDF suffix', () => {
    expect(normalizeTitle('Paper Title | Request PDF')).toBe('paper title');
  });
});

describe('shouldSkipResult', () => {
  test('skips null/undefined URLs', () => {
    expect(shouldSkipResult(null, 'Title')).toBe(true);
    expect(shouldSkipResult(undefined, 'Title')).toBe(true);
  });

  test('skips Kudos/GrowKudos results', () => {
    expect(shouldSkipResult('https://growkudos.com/publications/123', 'Paper')).toBe(true);
  });

  test('skips own profile pages', () => {
    expect(shouldSkipResult('https://fabiogiglietto.github.io/about', 'About')).toBe(true);
    expect(shouldSkipResult('https://orcid.org/0000-0001-8019-1035', 'ORCID')).toBe(true);
  });

  test('skips ALL ResearchGate publication pages unconditionally', () => {
    // This was the operator precedence bug — previously only skipped if title also matched
    expect(shouldSkipResult(
      'https://www.researchgate.net/publication/12345_Some_Paper',
      'Some Paper by Other Author'
    )).toBe(true);

    expect(shouldSkipResult(
      'https://researchgate.net/publication/67890',
      'Unrelated Title'
    )).toBe(true);
  });

  test('skips ResearchGate profile', () => {
    expect(shouldSkipResult(
      'https://www.researchgate.net/profile/Fabio-Giglietto',
      'Profile'
    )).toBe(true);
  });

  test('skips institutional team/staff/people pages', () => {
    expect(shouldSkipResult('https://mine.uniurb.it/team', 'Team Members')).toBe(true);
    expect(shouldSkipResult('https://university.edu/staff/giglietto', 'Staff')).toBe(true);
    expect(shouldSkipResult('https://dept.edu/people/john', 'People')).toBe(true);
    expect(shouldSkipResult('https://univ.it/faculty/members', 'Faculty')).toBe(true);
    expect(shouldSkipResult('https://uni.it/docenti/list', 'Docenti')).toBe(true);
    expect(shouldSkipResult('https://uni.it/personale/', 'Personale')).toBe(true);
  });

  test('does NOT skip legitimate news articles', () => {
    expect(shouldSkipResult(
      'https://www.wired.it/article/disinformation-study',
      'New Study on Disinformation by Fabio Giglietto'
    )).toBe(false);

    expect(shouldSkipResult(
      'https://www.bbc.com/news/technology-12345',
      'Expert warns about fake news spread'
    )).toBe(false);
  });

  test('skips LinkedIn profile', () => {
    expect(shouldSkipResult(
      'https://www.linkedin.com/in/fabiogiglietto',
      'Fabio Giglietto'
    )).toBe(true);
  });

  test('skips social media profiles', () => {
    expect(shouldSkipResult(
      'https://mastodon.social/@fabiogiglietto',
      'Fabio Giglietto'
    )).toBe(true);
  });
});

describe('isDatePlausible', () => {
  test('accepts today\'s date', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(isDatePlausible(today)).toBe(true);
  });

  test('accepts a date from 6 months ago', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    expect(isDatePlausible(sixMonthsAgo.toISOString().split('T')[0])).toBe(true);
  });

  test('accepts a date from 1 year ago', () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    expect(isDatePlausible(oneYearAgo.toISOString().split('T')[0])).toBe(true);
  });

  test('rejects dates more than 2 years old', () => {
    expect(isDatePlausible('2022-01-01')).toBe(false);
    expect(isDatePlausible('2020-06-15')).toBe(false);
  });

  test('rejects future dates (more than 1 day ahead)', () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);
    expect(isDatePlausible(farFuture.toISOString().split('T')[0])).toBe(false);
  });

  test('allows 1 day in the future (timezone tolerance)', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isDatePlausible(tomorrow.toISOString().split('T')[0])).toBe(true);
  });

  test('rejects null/undefined/empty', () => {
    expect(isDatePlausible(null)).toBe(false);
    expect(isDatePlausible(undefined)).toBe(false);
    expect(isDatePlausible('')).toBe(false);
  });

  test('rejects invalid date strings', () => {
    expect(isDatePlausible('not-a-date')).toBe(false);
    expect(isDatePlausible('2025-13-45')).toBe(false);
  });
});

describe('extractDateFromHTTP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('extracts date from OG meta tag (high confidence)', async () => {
    axios.get.mockResolvedValue({
      data: `<html><head>
        <meta property="article:published_time" content="2025-11-15T10:30:00Z">
      </head><body></body></html>`,
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/article');
    expect(result).toEqual({
      date: '2025-11-15',
      confidence: 'high',
      source: 'og-meta'
    });
  });

  test('extracts date from JSON-LD (high confidence)', async () => {
    axios.get.mockResolvedValue({
      data: `<html><head>
        <script type="application/ld+json">
        {"@type": "NewsArticle", "datePublished": "2025-10-20T14:00:00+02:00"}
        </script>
      </head><body></body></html>`,
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/news');
    expect(result).toEqual({
      date: '2025-10-20',
      confidence: 'high',
      source: 'jsonld'
    });
  });

  test('extracts date from JSON-LD @graph array', async () => {
    axios.get.mockResolvedValue({
      data: `<html><head>
        <script type="application/ld+json">
        {"@graph": [{"@type": "WebPage"}, {"@type": "Article", "datePublished": "2025-09-05"}]}
        </script>
      </head><body></body></html>`,
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/page');
    expect(result).toEqual({
      date: '2025-09-05',
      confidence: 'high',
      source: 'jsonld'
    });
  });

  test('extracts date from Dublin Core meta tag (medium confidence)', async () => {
    axios.get.mockResolvedValue({
      data: `<html><head>
        <meta name="DC.date.issued" content="2025-08-12">
      </head><body></body></html>`,
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/dc');
    expect(result).toEqual({
      date: '2025-08-12',
      confidence: 'medium',
      source: 'meta-tag'
    });
  });

  test('extracts date from time element (medium confidence)', async () => {
    axios.get.mockResolvedValue({
      data: `<html><body>
        <time datetime="2025-07-22T09:00:00Z">July 22, 2025</time>
      </body></html>`,
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/time');
    expect(result).toEqual({
      date: '2025-07-22',
      confidence: 'medium',
      source: 'time-element'
    });
  });

  test('extracts date from Last-Modified header (low confidence)', async () => {
    axios.get.mockResolvedValue({
      data: '<html><body>No metadata</body></html>',
      headers: { 'last-modified': 'Wed, 15 Oct 2025 12:00:00 GMT' }
    });

    const result = await extractDateFromHTTP('https://example.com/header');
    expect(result).toEqual({
      date: '2025-10-15',
      confidence: 'low',
      source: 'http-header'
    });
  });

  test('returns null when no date found', async () => {
    axios.get.mockResolvedValue({
      data: '<html><body>No metadata at all</body></html>',
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/nodate');
    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    axios.get.mockRejectedValue(new Error('Network timeout'));

    const result = await extractDateFromHTTP('https://example.com/error');
    expect(result).toBeNull();
  });

  test('prioritizes OG meta over JSON-LD', async () => {
    axios.get.mockResolvedValue({
      data: `<html><head>
        <meta property="article:published_time" content="2025-11-01">
        <script type="application/ld+json">
        {"datePublished": "2025-10-01"}
        </script>
      </head><body></body></html>`,
      headers: {}
    });

    const result = await extractDateFromHTTP('https://example.com/both');
    expect(result.date).toBe('2025-11-01');
    expect(result.source).toBe('og-meta');
  });
});

describe('extractJsonLdDate', () => {
  test('extracts datePublished from flat object', () => {
    expect(extractJsonLdDate({ datePublished: '2025-06-15' })).toBe('2025-06-15');
  });

  test('extracts from @graph array', () => {
    const jsonLd = {
      '@graph': [
        { '@type': 'WebSite' },
        { '@type': 'Article', datePublished: '2025-05-10' }
      ]
    };
    expect(extractJsonLdDate(jsonLd)).toBe('2025-05-10');
  });

  test('extracts from array of objects', () => {
    const jsonLd = [
      { '@type': 'WebPage' },
      { '@type': 'NewsArticle', datePublished: '2025-04-20' }
    ];
    expect(extractJsonLdDate(jsonLd)).toBe('2025-04-20');
  });

  test('returns null for missing datePublished', () => {
    expect(extractJsonLdDate({ '@type': 'Article', headline: 'Test' })).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(extractJsonLdDate(null)).toBeNull();
    expect(extractJsonLdDate(undefined)).toBeNull();
  });
});

describe('parseToYMD', () => {
  test('parses YYYY-MM-DD format', () => {
    expect(parseToYMD('2025-06-15')).toBe('2025-06-15');
  });

  test('parses ISO 8601 with time', () => {
    expect(parseToYMD('2025-06-15T10:30:00Z')).toBe('2025-06-15');
  });

  test('parses ISO 8601 with timezone offset', () => {
    const result = parseToYMD('2025-06-15T10:30:00+02:00');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('parses RFC 2822 date', () => {
    const result = parseToYMD('Wed, 15 Oct 2025 12:00:00 GMT');
    expect(result).toBe('2025-10-15');
  });

  test('returns null for invalid input', () => {
    expect(parseToYMD(null)).toBeNull();
    expect(parseToYMD('')).toBeNull();
    expect(parseToYMD('not-a-date')).toBeNull();
  });
});

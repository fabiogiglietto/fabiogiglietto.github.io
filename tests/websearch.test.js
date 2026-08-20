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
  extractDateFromUrl,
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

describe('extractDateFromUrl', () => {
  test('extracts /YYYY/MM/DD/ pattern', () => {
    expect(extractDateFromUrl('https://example.com/blog/2025/03/10/article-title')).toBe('2025-03-10');
  });

  test('extracts YYYY-MM-DD in path', () => {
    expect(extractDateFromUrl('https://example.eu/news/researchers-discuss-2025-12-12_en')).toBe('2025-12-12');
  });

  test('extracts YYYY-MM-DD in query string', () => {
    expect(extractDateFromUrl('https://example.com/article?published=2025-06-01&id=123')).toBe('2025-06-01');
  });

  test('extracts compact YYYYMMDD format', () => {
    expect(extractDateFromUrl('https://example.com/news/20250115-headline-here')).toBe('2025-01-15');
  });

  test('returns null for URLs with no date', () => {
    expect(extractDateFromUrl('https://www.uniurb.it/novita-ed-eventi/5977')).toBeNull();
    expect(extractDateFromUrl('https://example.com/about')).toBeNull();
  });

  test('returns null for invalid URLs', () => {
    expect(extractDateFromUrl('not-a-url')).toBeNull();
  });

  test('handles real-world EU URL with date suffix', () => {
    expect(extractDateFromUrl(
      'https://algorithmic-transparency.ec.europa.eu/news/researchers-meet-discuss-dsa-access-publicly-available-platform-data-2025-12-12_en'
    )).toBe('2025-12-12');
  });
});

describe('getValidVerdict (validation-verdict cache)', () => {
  const { getValidVerdict, VALIDATION_PROMPT_VERSION, POSITIVE_VERDICT_TTL_MS } = _testing;
  const NOW = Date.parse('2026-07-08T00:00:00Z');
  const KEY = 'example.com/article';

  const entry = (verdict, { v = VALIDATION_PROMPT_VERSION, ageMs = 0 } = {}) => ({
    [KEY]: {
      v,
      cachedAt: new Date(NOW - ageMs).toISOString(),
      verdict
    }
  });

  const negative = {
    isRelevant: false,
    mentionedByName: false,
    relevanceScore: 0.1,
    reason: 'Different person',
    description: 'x',
    personMatch: 'different_person',
    isRecent: false
  };
  const positive = { ...negative, isRelevant: true, personMatch: 'confirmed', isRecent: true };

  test('unknown URL is a miss', () => {
    expect(getValidVerdict({}, KEY, NOW)).toBeNull();
  });

  test('prompt-version mismatch is a miss', () => {
    const cache = entry(negative, { v: VALIDATION_PROMPT_VERSION - 1 });
    expect(getValidVerdict(cache, KEY, NOW)).toBeNull();
  });

  test('negative verdicts hit permanently (no TTL)', () => {
    const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;
    const cache = entry(negative, { ageMs: tenYears });
    expect(getValidVerdict(cache, KEY, NOW)).toEqual(negative);
  });

  test('fresh positive verdict hits', () => {
    const cache = entry(positive, { ageMs: 24 * 60 * 60 * 1000 });
    expect(getValidVerdict(cache, KEY, NOW)).toEqual(positive);
  });

  test('stale positive verdict (past TTL) is a miss', () => {
    const cache = entry(positive, { ageMs: POSITIVE_VERDICT_TTL_MS + 1 });
    expect(getValidVerdict(cache, KEY, NOW)).toBeNull();
  });

  test('positive verdict with unparseable cachedAt is a miss', () => {
    const cache = { [KEY]: { v: VALIDATION_PROMPT_VERSION, cachedAt: 'garbage', verdict: positive } };
    expect(getValidVerdict(cache, KEY, NOW)).toBeNull();
  });
});

describe('discoveryCacheAgeHours (grounded-discovery TTL)', () => {
  const { discoveryCacheAgeHours } = _testing;
  const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();

  test('returns the age for a fresh cache', () => {
    const age = discoveryCacheAgeHours({ lastRunAt: hoursAgo(10), results: [{ url: 'x' }] });
    expect(age).toBeCloseTo(10, 1);
  });

  test('returns null once the cache is older than the TTL', () => {
    expect(discoveryCacheAgeHours({ lastRunAt: hoursAgo(100), results: [{ url: 'x' }] })).toBeNull();
  });

  test('respects an explicit TTL override', () => {
    const raw = { lastRunAt: hoursAgo(10), results: [{ url: 'x' }] };
    expect(discoveryCacheAgeHours(raw, Date.now(), 6)).toBeNull();
    expect(discoveryCacheAgeHours(raw, Date.now(), 24)).toBeCloseTo(10, 1);
  });

  test('rejects malformed, empty and future-stamped payloads', () => {
    expect(discoveryCacheAgeHours(null)).toBeNull();
    expect(discoveryCacheAgeHours({})).toBeNull();
    expect(discoveryCacheAgeHours({ lastRunAt: hoursAgo(1) })).toBeNull();
    expect(discoveryCacheAgeHours({ results: [] })).toBeNull();
    expect(discoveryCacheAgeHours({ lastRunAt: 'not-a-date', results: [] })).toBeNull();
    expect(discoveryCacheAgeHours({ lastRunAt: hoursAgo(-5), results: [] })).toBeNull();
  });
});

describe('Gemini call token budgets', () => {
  // Thinking tokens bill as output at ~6x the input rate, so every call site
  // must declare both an output cap and a thinking budget. Regressions here
  // are invisible until the monthly bill arrives.
  const cases = [
    ['validation', _testing.VALIDATION_CALL_CONFIG],
    ['date extraction', _testing.DATE_CALL_CONFIG],
    ['grounded discovery', _testing.DISCOVERY_CALL_CONFIG],
  ];

  test.each(cases)('%s config caps output tokens', (_name, cfg) => {
    expect(typeof cfg.maxOutputTokens).toBe('number');
    expect(cfg.maxOutputTokens).toBeGreaterThan(0);
    expect(cfg.maxOutputTokens).toBeLessThanOrEqual(2500);
  });

  test.each(cases)('%s config constrains thinking', (_name, cfg) => {
    expect(cfg.thinkingConfig).toBeDefined();
    const constrained =
      cfg.thinkingConfig.thinkingBudget === 0 || cfg.thinkingConfig.thinkingLevel === 'low';
    expect(constrained).toBe(true);
  });

  test('only the discovery call enables Google Search grounding', () => {
    expect(_testing.VALIDATION_CALL_CONFIG.tools).toBeUndefined();
    expect(_testing.DATE_CALL_CONFIG.tools).toBeUndefined();
    expect(_testing.DISCOVERY_CALL_CONFIG.tools).toEqual([{ googleSearch: {} }]);
  });
});

describe('wrong-person filtering for medical outlets', () => {
  const { shouldSkipResult } = _testing;

  // Google News RSS appends " - <outlet>" to titles and gives opaque
  // news.google.com article URLs, so the outlet name in the title is the only
  // usable signal — the medicalDomains check can never fire on those URLs.
  const RSS_URL = 'https://news.google.com/rss/articles/CBMiX0FVX3lxTE1fVzlRQ1hiYlBkVno1?oc=5';

  test('skips an Oncodaily item that reached the published mentions', () => {
    // This one was live on the site: validated as personMatch "confirmed" with
    // relevanceScore 0.75, despite the title naming a different researcher.
    expect(shouldSkipResult(RSS_URL, 'Katharina Esau Was Awarded an ARC Discovery Early Career Researcher Award 2026 - Oncodaily')).toBe(true);
  });

  test('still skips the other wrong-Fabio medical hits', () => {
    expect(shouldSkipResult('https://example.com/a', 'Trapianto midollo osseo, nuovi risultati')).toBe(true);
    expect(shouldSkipResult('https://www.hsr.it/x', 'Ematologia: San Raffaele')).toBe(true);
  });

  test('does not skip genuine Italian press coverage', () => {
    expect(shouldSkipResult('https://www.ilsole24ore.com/art/x', 'Meno contenuti politici nei feed, la stretta di Meta - Il Sole 24 ORE')).toBe(false);
    expect(shouldSkipResult(RSS_URL, "Indagine urbinate: \"Così l'algoritmo influenza il voto\" - Il Resto del Carlino")).toBe(false);
  });
});

describe('article snippet extraction', () => {
  const { extractSnippetFromHtml, isAggregatorBoilerplate, isSnippetCacheUsable, SNIPPET_RETRY_DAYS } = _testing;

  // Google News RSS supplies no usable summary: its <description> repeats the
  // title and outlet, and its /rss/articles/ URLs serve an interstitial. The
  // validator was therefore judging person-match from a headline alone. Reading
  // the article's own summary fixes that wherever the URL actually resolves.
  test('prefers og:description', () => {
    const html = '<html><head><meta property="og:description" content="A study by the University of Urbino found that Meta reduced the reach of parliamentarians."></head></html>';
    expect(extractSnippetFromHtml(html)).toMatch(/University of Urbino/);
  });

  test('falls back to meta description, then to a substantial paragraph', () => {
    expect(extractSnippetFromHtml('<html><head><meta name="description" content="' + 'a'.repeat(50) + '"></head></html>')).toHaveLength(50);
    const para = 'b'.repeat(120);
    expect(extractSnippetFromHtml(`<html><body><p>too short</p><article><p>${para}</p></article></body></html>`)).toBe(para);
  });

  test('ignores boilerplate too short to be evidence', () => {
    expect(extractSnippetFromHtml('<html><head><meta name="description" content="News"></head><body><p>Accept cookies</p></body></html>')).toBeNull();
  });

  test("rejects an aggregator's description of itself", () => {
    // Verified against the live site: this is exactly what an unresolved Google
    // News URL returns, and storing it would feed the validator a sentence about
    // Google News as though it were about the subject.
    const blurb = 'Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News.';
    expect(isAggregatorBoilerplate(blurb)).toBe(true);
    expect(extractSnippetFromHtml(`<html><head><meta name="description" content="${blurb}"></head></html>`)).toBeNull();
  });

  test('snippet cache keeps hits and retries misses after the backoff', () => {
    const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
    expect(isSnippetCacheUsable({ snippet: 'text' })).toBe(true);
    expect(isSnippetCacheUsable({ snippet: null, fetchedAt: daysAgo(1) })).toBe(true);
    expect(isSnippetCacheUsable({ snippet: null, fetchedAt: daysAgo(SNIPPET_RETRY_DAYS + 1) })).toBe(false);
    expect(isSnippetCacheUsable(null)).toBe(false);
    expect(isSnippetCacheUsable({ snippet: null })).toBe(false);
  });
});

/**
 * Tests for about-generator.js
 *
 * Tests HTML sanitization and content generation utilities.
 */

const sanitizeHtml = require('sanitize-html');

// Test the sanitization configuration used in about-generator
const sanitizeConfig = {
  allowedTags: ['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'br', 'div', 'section'],
  allowedAttributes: {
    'a': ['href', 'target', 'rel']
  },
  allowedSchemes: ['http', 'https', 'mailto']
};

describe('HTML Sanitization', () => {
  describe('allowed tags', () => {
    test('allows paragraph tags', () => {
      const input = '<p>Hello world</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows formatting tags', () => {
      const input = '<p><strong>Bold</strong> and <em>italic</em></p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows links with safe attributes', () => {
      const input = '<a href="https://example.com" target="_blank" rel="noopener">Link</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows lists', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows headings h2-h4', () => {
      const input = '<h2>Title</h2><h3>Subtitle</h3><h4>Section</h4>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });
  });

  describe('blocked content', () => {
    test('removes script tags', () => {
      const input = '<p>Safe</p><script>alert("xss")</script>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Safe</p>');
    });

    test('removes onclick handlers', () => {
      const input = '<p onclick="alert(1)">Text</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Text</p>');
    });

    test('removes javascript: URLs', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<a>Click</a>');
    });

    test('removes data: URLs', () => {
      const input = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<a>Click</a>');
    });

    test('removes style tags', () => {
      const input = '<style>body{display:none}</style><p>Content</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Content</p>');
    });

    test('removes iframe tags', () => {
      const input = '<iframe src="https://evil.com"></iframe><p>Safe</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Safe</p>');
    });

    test('removes img tags', () => {
      const input = '<img src="x" onerror="alert(1)"><p>Text</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Text</p>');
    });

    test('removes h1 tags (not in allowed list)', () => {
      const input = '<h1>Big Title</h1>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('Big Title');
    });
  });

  describe('URL schemes', () => {
    test('allows https URLs', () => {
      const input = '<a href="https://example.com">Link</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toContain('https://example.com');
    });

    test('allows http URLs', () => {
      const input = '<a href="http://example.com">Link</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toContain('http://example.com');
    });

    test('allows mailto URLs', () => {
      const input = '<a href="mailto:test@example.com">Email</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toContain('mailto:test@example.com');
    });

    test('blocks ftp URLs', () => {
      const input = '<a href="ftp://example.com/file">Download</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<a>Download</a>');
    });
  });

  describe('nested content', () => {
    test('handles deeply nested safe content', () => {
      const input = '<div><section><p><strong><em>Nested</em></strong></p></section></div>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('removes dangerous nested content', () => {
      const input = '<div><p>Safe<script>alert(1)</script>Content</p></div>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<div><p>SafeContent</p></div>');
    });
  });
});

describe('formatDataForPrompt — recent web mentions', () => {
  const { _testing } = require('../scripts/generators/about-generator');
  const { formatDataForPrompt } = _testing;

  // websearch.json is a flat array of validated mentions. It was previously read
  // as `data.websearch.mentions`, which is always undefined — the section silently
  // never rendered, and the grounded call was masking the gap.
  const mentions = [
    { title: 'Older piece', url: 'https://example.com/a', date: '2026-01-02', source: 'Il Resto del Carlino', description: 'An older article.' },
    { title: 'Newer piece', url: 'https://example.com/b', date: '2026-08-01', source: 'Wired Italia', description: 'A newer article.' },
  ];

  test('renders mentions from the flat array shape', () => {
    const out = formatDataForPrompt({ websearch: mentions });
    expect(out).toContain('RECENT WEB MENTIONS');
    expect(out).toContain('Newer piece');
    expect(out).toContain('Wired Italia');
    expect(out).toContain('2026-08-01');
  });

  test('orders mentions most recent first', () => {
    const out = formatDataForPrompt({ websearch: mentions });
    expect(out.indexOf('Newer piece')).toBeLessThan(out.indexOf('Older piece'));
  });

  test('omits the section entirely when there are no mentions', () => {
    expect(formatDataForPrompt({ websearch: [] })).not.toContain('RECENT WEB MENTIONS');
    expect(formatDataForPrompt({})).not.toContain('RECENT WEB MENTIONS');
  });

  test('does not resurrect the old {mentions:[...]} shape', () => {
    const out = formatDataForPrompt({ websearch: { mentions } });
    expect(out).not.toContain('RECENT WEB MENTIONS');
  });
});

describe('seedOverlapRatio (anti-copying guard)', () => {
  const { seedOverlapRatio, MAX_SEED_OVERLAP } = require('../scripts/generators/about-generator')._testing;

  // The authoritative biography is polished prose, so the model is tempted to
  // reproduce it rather than write from it. A measured dump scored 88% overlap;
  // a normal generation scored 1.7%.
  const seed = `As of August 2026, Fabio Giglietto is Full Professor of Internet Studies at the
    Università di Urbino Carlo Bo, where his teaching has included Generative AI and Media and
    Digital Social Network Analysis. In 2017 he founded the Mapping Italian News Research Program
    at the University of Urbino, and has coordinated it since. Between 2017 and February 2026 it
    hosted a succession of externally funded sub-projects supported by many bodies.`;

  test('scores a verbatim copy near 1', () => {
    expect(seedOverlapRatio(`<p>${seed}</p>`, seed)).toBeGreaterThan(0.9);
  });

  test('scores independent prose near 0', () => {
    const original = `<p>Giglietto researches how information disorder spreads through social
      platforms. He leads a programme in Urbino studying elections and public opinion, and built
      open-source tooling that other researchers now maintain downstream.</p>`;
    expect(seedOverlapRatio(original, seed)).toBeLessThan(0.1);
  });

  test('separates the two cases across the configured threshold', () => {
    const copied = seedOverlapRatio(`<p>${seed}</p>`, seed);
    expect(copied).toBeGreaterThan(MAX_SEED_OVERLAP);
    expect(MAX_SEED_OVERLAP).toBeGreaterThan(0);
    expect(MAX_SEED_OVERLAP).toBeLessThan(0.5);
  });

  test('tolerates the short phrases any bio shares with its source', () => {
    const natural = `<p>Fabio Giglietto is Full Professor of Internet Studies at the Università di
      Urbino Carlo Bo. His work examines coordinated behaviour online, and he has advised European
      institutions on platform transparency.</p>`;
    expect(seedOverlapRatio(natural, seed)).toBeLessThan(MAX_SEED_OVERLAP);
  });

  test('handles empty and missing input without throwing', () => {
    expect(seedOverlapRatio('', seed)).toBe(0);
    expect(seedOverlapRatio(null, seed)).toBe(0);
    expect(seedOverlapRatio('<p>short</p>', '')).toBe(0);
  });
});

describe('bio-seed status stamp staleness', () => {
  const { _testing } = require('../scripts/helpers/bio-seed');
  const { parseSeedStamp, seedStampAgeMonths, checkSeedStamp, STAMP_WARN_MONTHS, STAMP_STALE_MONTHS } = _testing;

  // The fact sheet stamps status claims with a month so a generator can tell a
  // current role from a concluded one. Nothing refreshes that stamp, so a stale
  // one silently turns "as of" claims into assertions about a year gone by.
  const sheet = (label) => `*Status information in this document is stamped "as of ${label}".*\n\nAs of ${label}, he is Full Professor.`;
  const AUG_2026 = new Date('2026-08-20T00:00:00Z');

  let warn, error;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { warn.mockRestore(); error.mockRestore(); });

  test('parses the stamp', () => {
    expect(parseSeedStamp(sheet('August 2026'))).toMatchObject({ month: 7, year: 2026, label: 'August 2026' });
    expect(parseSeedStamp('no stamp here')).toBeNull();
    expect(parseSeedStamp('as of Smarch 2026')).toBeNull();
  });

  test('measures age in whole months', () => {
    expect(seedStampAgeMonths(sheet('August 2026'), AUG_2026)).toBe(0);
    expect(seedStampAgeMonths(sheet('February 2026'), AUG_2026)).toBe(6);
    expect(seedStampAgeMonths(sheet('August 2025'), AUG_2026)).toBe(12);
    expect(seedStampAgeMonths('unstamped', AUG_2026)).toBeNull();
  });

  test('stays quiet while the stamp is fresh', () => {
    expect(checkSeedStamp(sheet('August 2026'), AUG_2026)).toBe('ok');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  test('warns once the stamp passes the warn threshold', () => {
    const label = 'February 2026'; // exactly STAMP_WARN_MONTHS old
    expect(seedStampAgeMonths(sheet(label), AUG_2026)).toBe(STAMP_WARN_MONTHS);
    expect(checkSeedStamp(sheet(label), AUG_2026)).toBe('warn');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('February 2026'));
  });

  test('escalates to an error once it is a year old', () => {
    const label = 'August 2025';
    expect(seedStampAgeMonths(sheet(label), AUG_2026)).toBe(STAMP_STALE_MONTHS);
    expect(checkSeedStamp(sheet(label), AUG_2026)).toBe('stale');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no longer verified'));
  });

  test('flags an unstamped sheet and a future stamp', () => {
    expect(checkSeedStamp('no stamp at all', AUG_2026)).toBe('missing');
    expect(checkSeedStamp(sheet('January 2027'), AUG_2026)).toBe('future');
  });

  test('the committed fact sheet is currently fresh', () => {
    const fs = require('fs');
    const { BIO_SEED_PATH } = require('../scripts/helpers/bio-seed');
    const text = fs.readFileSync(BIO_SEED_PATH, 'utf8');
    expect(parseSeedStamp(text)).not.toBeNull();
  });
});

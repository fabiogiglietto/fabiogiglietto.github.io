/**
 * Tests for publications-aggregator.js
 *
 * Tests the core utility functions used for publication matching and metrics.
 */

const { _testing } = require('../scripts/collectors/publications-aggregator');
const { isSimilarTitle, calculateHIndex, normalizeDoi, mergeDuplicateDois } = _testing;

/**
 * Build a minimal publication record shaped like the aggregator's internal map
 * entries, for exercising the merge logic.
 */
function makePub(overrides = {}) {
  return {
    title: 'Untitled',
    authors: null,
    venue: null,
    year: null,
    doi: null,
    citations: { scholar: null, wos: null, scopus: null, semanticScholar: null },
    source_urls: { orcid: null, scholar: null, wos: null, scopus: null, semanticScholar: null, ora: null, crossref: null },
    source_ids: { orcid: null, scholar: null, wos: null, scopus: null, semanticScholar: null, ora: null },
    metrics: {},
    ...overrides
  };
}

describe('isSimilarTitle', () => {
  describe('exact matches', () => {
    test('returns true for identical titles', () => {
      const title = 'Social Media and Political Participation';
      expect(isSimilarTitle(title, title)).toBe(true);
    });

    test('returns true for case-insensitive matches', () => {
      expect(isSimilarTitle(
        'Social Media and Political Participation',
        'social media and political participation'
      )).toBe(true);
    });

    test('returns true when punctuation differs', () => {
      expect(isSimilarTitle(
        'Social Media: A Study',
        'Social Media A Study'
      )).toBe(true);
    });
  });

  describe('substring matches', () => {
    test('returns true when one title contains the other', () => {
      expect(isSimilarTitle(
        'Coordinated Link Sharing Behavior',
        'Coordinated Link Sharing Behavior on Facebook'
      )).toBe(true);
    });
  });

  describe('word-based matching', () => {
    test('returns true for titles with most significant words matching', () => {
      expect(isSimilarTitle(
        'Disinformation and Social Media Manipulation',
        'Social Media Manipulation and Disinformation Campaigns'
      )).toBe(true);
    });

    test('returns false for titles with few matching words', () => {
      expect(isSimilarTitle(
        'Machine Learning in Healthcare',
        'Social Media Political Communication'
      )).toBe(false);
    });

    test('returns false for completely different titles', () => {
      expect(isSimilarTitle(
        'Deep Learning Neural Networks',
        'Italian Renaissance Art History'
      )).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles empty strings', () => {
      expect(isSimilarTitle('', '')).toBe(false);
    });

    test('handles titles with only short words', () => {
      expect(isSimilarTitle('The A An', 'Is Of To')).toBe(false);
    });

    test('handles special characters', () => {
      expect(isSimilarTitle(
        'COVID-19 & Social Media',
        'COVID19 and Social Media'
      )).toBe(true);
    });
  });
});

describe('calculateHIndex', () => {
  test('returns 0 for empty array', () => {
    expect(calculateHIndex([])).toBe(0);
  });

  test('returns 0 for all zero citations', () => {
    expect(calculateHIndex([0, 0, 0])).toBe(0);
  });

  test('calculates h-index correctly for simple case', () => {
    // 3 papers with at least 3 citations each
    expect(calculateHIndex([10, 8, 5, 4, 3])).toBe(4);
  });

  test('calculates h-index correctly when all papers have same citations', () => {
    expect(calculateHIndex([5, 5, 5, 5, 5])).toBe(5);
  });

  test('handles single paper', () => {
    expect(calculateHIndex([10])).toBe(1);
  });

  test('handles unsorted input', () => {
    expect(calculateHIndex([3, 10, 5, 8, 4])).toBe(4);
  });

  test('handles papers with 0 citations mixed with cited papers', () => {
    expect(calculateHIndex([100, 50, 0, 0, 0])).toBe(2);
  });

  test('calculates h-index for typical academic profile', () => {
    // Simulates a profile with varied citation counts
    // h-index = 9 means 9 papers have at least 9 citations each
    // Paper 10 has only 8 citations, so h-index is 9, not 10
    const citations = [150, 120, 80, 45, 30, 25, 20, 15, 10, 8, 5, 3, 2, 1, 0];
    expect(calculateHIndex(citations)).toBe(9);
  });
});

describe('normalizeDoi', () => {
  test('lower-cases the DOI', () => {
    expect(normalizeDoi('10.1111/JCOM.12085')).toBe('10.1111/jcom.12085');
  });

  test('strips a trailing version suffix', () => {
    expect(normalizeDoi('10.31235/osf.io/8dqag_v2')).toBe('10.31235/osf.io/8dqag');
    expect(normalizeDoi('10.31235/osf.io/8dqag_v1')).toBe('10.31235/osf.io/8dqag');
  });

  test('leaves a DOI without a version suffix unchanged', () => {
    expect(normalizeDoi('10.1000/abc')).toBe('10.1000/abc');
  });
});

describe('mergeDuplicateDois', () => {
  test('collapses two entries with the same DOI into one', () => {
    const map = new Map([
      ['title:foo', makePub({ title: 'Foo', doi: '10.1/foo', citations: { scholar: 10, wos: null, scopus: null, semanticScholar: null } })],
      ['doi:10.1/foo', makePub({ title: 'Foo', doi: '10.1/foo', citations: { scholar: null, wos: 8, scopus: null, semanticScholar: null } })]
    ]);
    const merged = mergeDuplicateDois(map);
    expect(merged.size).toBe(1);
    const pub = merged.get('doi:10.1/foo');
    // Citations from both sources are preserved (max per source).
    expect(pub.citations.scholar).toBe(10);
    expect(pub.citations.wos).toBe(8);
  });

  test('keeps the highest count when both entries have the same source', () => {
    const map = new Map([
      ['a', makePub({ doi: '10.1/x', citations: { scholar: 5, wos: null, scopus: null, semanticScholar: null } })],
      ['b', makePub({ doi: '10.1/x', citations: { scholar: 42, wos: null, scopus: null, semanticScholar: null } })]
    ]);
    const merged = mergeDuplicateDois(map);
    expect(merged.size).toBe(1);
    expect([...merged.values()][0].citations.scholar).toBe(42);
  });

  test('merges OSF version variants via DOI normalisation', () => {
    const map = new Map([
      ['doi:10.31235/osf.io/8dqag_v2', makePub({ doi: '10.31235/osf.io/8dqag_v2' })],
      ['doi:10.31235/osf.io/8dqag_v1', makePub({ doi: '10.31235/osf.io/8dqag_v1' })]
    ]);
    expect(mergeDuplicateDois(map).size).toBe(1);
  });

  test('unions source urls and ids without overwriting existing values', () => {
    const map = new Map([
      ['a', makePub({ doi: '10.1/y', source_urls: { orcid: 'o', scholar: null, wos: null, scopus: null, semanticScholar: null, ora: null, crossref: null } })],
      ['b', makePub({ doi: '10.1/y', source_urls: { orcid: 'OTHER', scholar: 's', wos: null, scopus: null, semanticScholar: null, ora: null, crossref: null } })]
    ]);
    const pub = [...mergeDuplicateDois(map).values()][0];
    expect(pub.source_urls.orcid).toBe('o'); // first value wins
    expect(pub.source_urls.scholar).toBe('s'); // gap filled from duplicate
  });

  test('fills missing scalar metadata from the duplicate', () => {
    const map = new Map([
      ['a', makePub({ doi: '10.1/z', authors: null, year: 2020 })],
      ['b', makePub({ doi: '10.1/z', authors: 'Doe, J.', year: 1999 })]
    ]);
    const pub = [...mergeDuplicateDois(map).values()][0];
    expect(pub.authors).toBe('Doe, J.'); // gap filled
    expect(pub.year).toBe(2020); // existing non-null kept
  });

  test('leaves DOI-less entries untouched and unmerged', () => {
    const map = new Map([
      ['title:a', makePub({ title: 'A paper', doi: null })],
      ['title:b', makePub({ title: 'Another paper', doi: null })]
    ]);
    expect(mergeDuplicateDois(map).size).toBe(2);
  });

  test('does not merge distinct DOIs', () => {
    const map = new Map([
      ['a', makePub({ doi: '10.1/aaa' })],
      ['b', makePub({ doi: '10.1/bbb' })]
    ]);
    expect(mergeDuplicateDois(map).size).toBe(2);
  });
});

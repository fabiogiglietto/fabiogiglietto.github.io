/**
 * Tests for publications-aggregator.js
 *
 * Tests the core utility functions used for publication matching and metrics.
 */

const { _testing } = require('../scripts/collectors/publications-aggregator');
const { isSimilarTitle, calculateHIndex } = _testing;

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

/**
 * Tests for zettelkasten.js
 *
 * Covers buildNotesIndex — the pure transform that turns fg-zettelkasten's
 * state.json into a `bibtexKey -> note` lookup — and collect()'s graceful
 * failure behaviour (it must never throw).
 */

// Mock `https` so collect() exercises its catch branch without a network call.
jest.mock('https', () => ({
  get: jest.fn(() => ({
    on: (event, cb) => {
      if (event === 'error') {
        cb(new Error('mocked network failure'));
      }
      return { on: () => {} };
    }
  }))
}));

const zettelkasten = require('../scripts/collectors/zettelkasten');
const { buildNotesIndex } = zettelkasten._testing;

const ZK_SITE = 'https://fabiogiglietto.github.io/fg-zettelkasten/';

describe('buildNotesIndex', () => {
  test('maps a bibtex id to its extensionless Quartz note URL', () => {
    const index = buildNotesIndex({
      papers: {
        'bibtex:Rodarte2026-dk': {
          note_path: 'Papers/Rodarte2026-dk.md',
          topics: ['information-disorder'],
          podcast_linked: true
        }
      }
    });

    expect(index['Rodarte2026-dk']).toEqual({
      url: `${ZK_SITE}Papers/Rodarte2026-dk`,
      topics: ['information-disorder'],
      podcastLinked: true
    });
  });

  test('strips only the bibtex: prefix from the key', () => {
    const index = buildNotesIndex({
      papers: { 'bibtex:Adam2026-tz': { note_path: 'Papers/Adam2026-tz.md' } }
    });
    expect(Object.keys(index)).toEqual(['Adam2026-tz']);
  });

  test('skips entries that have no note_path', () => {
    const index = buildNotesIndex({
      papers: {
        'bibtex:HasNote-aa': { note_path: 'Papers/HasNote-aa.md' },
        'bibtex:NoNote-bb': { topics: ['x'], podcast_linked: false }
      }
    });
    expect(index['HasNote-aa']).toBeDefined();
    expect(index['NoNote-bb']).toBeUndefined();
  });

  test('defaults topics to [] and podcastLinked to false when absent', () => {
    const index = buildNotesIndex({
      papers: { 'bibtex:Bare-cc': { note_path: 'Papers/Bare-cc.md' } }
    });
    expect(index['Bare-cc'].topics).toEqual([]);
    expect(index['Bare-cc'].podcastLinked).toBe(false);
  });

  test('returns an empty object for missing or empty state data', () => {
    expect(buildNotesIndex(null)).toEqual({});
    expect(buildNotesIndex({})).toEqual({});
    expect(buildNotesIndex({ papers: {} })).toEqual({});
  });
});

describe('collect (graceful failure)', () => {
  test('resolves to the empty-map shape when the fetch fails', async () => {
    const result = await zettelkasten.collect();

    expect(result.notesByBibtexKey).toEqual({});
    expect(result.totalNotes).toBe(0);
    expect(result.siteUrl).toBe(ZK_SITE);
    expect(result.error).toBeTruthy();
  });
});

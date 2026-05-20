/**
 * Zettelkasten Collector
 *
 * Fetches the fg-zettelkasten tracking file (`data/state.json`) and builds a
 * lookup of synthesized note URLs keyed by `bibtex` id.
 *
 * fg-zettelkasten is the 4th and final stage of the research pipeline
 * (toread -> research-radio -> fabiogiglietto.github.io -> fg-zettelkasten).
 * It turns the `#toread` paper feed into a cross-linked Quartz knowledge base,
 * one synthesized note per paper. Each `#toread` card on this site can
 * therefore link to its note, joined on the shared `bibtex:AuthorYear-xx` id —
 * the same key already used to match research-radio podcast episodes.
 */

const https = require('https');

const STATE_URL =
  'https://raw.githubusercontent.com/fabiogiglietto/fg-zettelkasten/main/data/state.json';
const ZK_SITE = 'https://fabiogiglietto.github.io/fg-zettelkasten/';

/**
 * Build a `bibtexKey -> note` lookup from a parsed state.json object.
 *
 * Entries without a `note_path` are skipped: a paper can be tracked in state
 * before its note has been written. Quartz serves notes at case-preserving,
 * extensionless paths, so the URL is simply the site base + note_path minus
 * its `.md` extension.
 */
function buildNotesIndex(stateData) {
  const papers = (stateData && stateData.papers) || {};
  const notesByBibtexKey = {};

  for (const [id, entry] of Object.entries(papers)) {
    if (!entry || !entry.note_path) {
      continue;
    }
    const bibtexKey = id.replace(/^bibtex:/, '');
    notesByBibtexKey[bibtexKey] = {
      url: ZK_SITE + entry.note_path.replace(/\.md$/, ''),
      topics: Array.isArray(entry.topics) ? entry.topics : [],
      podcastLinked: Boolean(entry.podcast_linked)
    };
  }

  return notesByBibtexKey;
}

class ZettelkastenCollector {
  constructor() {
    this.stateUrl = STATE_URL;
  }

  async fetchFromUrl(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            resolve(data);
          });
        })
        .on('error', (err) => {
          reject(new Error(`HTTPS request failed: ${err.message}`));
        });
    });
  }

  async collect() {
    try {
      console.log('Fetching Zettelkasten notes index...');

      const raw = await this.fetchFromUrl(this.stateUrl);
      const stateData = JSON.parse(raw);
      const notesByBibtexKey = buildNotesIndex(stateData);
      const totalNotes = Object.keys(notesByBibtexKey).length;

      console.log(`Found ${totalNotes} Zettelkasten notes`);

      return {
        notesByBibtexKey,
        totalNotes,
        siteUrl: ZK_SITE,
        lastUpdated: new Date().toISOString(),
        source: 'https://github.com/fabiogiglietto/fg-zettelkasten'
      };
    } catch (error) {
      console.error('Error collecting Zettelkasten data:', error.message);

      return {
        notesByBibtexKey: {},
        totalNotes: 0,
        siteUrl: ZK_SITE,
        error: error.message,
        lastUpdated: new Date().toISOString(),
        source: 'https://github.com/fabiogiglietto/fg-zettelkasten'
      };
    }
  }
}

const collector = new ZettelkastenCollector();

module.exports = {
  collect: () => collector.collect(),
  name: 'zettelkasten',
  _testing: { buildNotesIndex }
};

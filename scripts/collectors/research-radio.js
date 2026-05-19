/**
 * Research Radio Collector
 *
 * Fetches podcast episodes from research-radio's `episodes.json`.
 *
 * episodes.json is used deliberately rather than the RSS `feed.xml`:
 * own-publication episodes are excluded from the public RSS feed (so they
 * never appear on Spotify/Apple), but they ARE recorded in episodes.json —
 * and they must still surface as podcast links in this site's publications
 * section. episodes.json also lists episodes whose audio exists but whose RSS
 * slot has not yet arrived, so a badge appears as soon as the audio is live.
 */

const https = require('https');

class ResearchRadioCollector {
  constructor() {
    this.episodesUrl = 'https://fabiogiglietto.github.io/research-radio/episodes.json';
  }

  async fetchFromUrl(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve(data);
        });
      }).on('error', (err) => {
        reject(new Error(`HTTPS request failed: ${err.message}`));
      });
    });
  }

  /**
   * Format a duration given in seconds as "M:SS" (or "H:MM:SS").
   */
  formatDuration(seconds) {
    if (typeof seconds !== 'number' || Number.isNaN(seconds)) {
      return null;
    }
    const pad = (n) => String(n).padStart(2, '0');
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(secs)}`
      : `${minutes}:${pad(secs)}`;
  }

  /**
   * Normalize one episodes.json record into the collector's episode shape.
   */
  parseEpisode(ep) {
    const id = ep.id || null;
    const bibtexKey = id ? id.replace('bibtex:', '') : null;

    // The DOI is carried in the episode description's reference line.
    const description = ep.description || '';
    const doiMatch = description.match(/https?:\/\/doi\.org\/([^\s<]+)/i);
    const doi = doiMatch ? doiMatch[1] : null;

    const authors = Array.isArray(ep.authors) ? ep.authors : [];

    return {
      id,
      bibtexKey,
      title: ep.title ? ep.title.replace("FG's Research Radio: ", '') : null,
      description,
      audioUrl: ep.audio_url || null,
      pubDate: ep.pub_date || null,
      duration: this.formatDuration(ep.duration),
      author: authors.join(', ') || null,
      doi,
      own: Boolean(ep.own)
    };
  }

  async collect() {
    try {
      console.log('Fetching Research Radio episodes...');

      const raw = await this.fetchFromUrl(this.episodesUrl);
      const data = JSON.parse(raw);
      const episodes = (data.episodes || []).map((ep) => this.parseEpisode(ep));

      console.log(`Found ${episodes.length} podcast episodes`);

      // Lookup maps for matching: by bibtex key (toread papers) and by DOI
      // (publications). Both include own-publication episodes.
      const episodesByBibtexKey = {};
      const episodesByDoi = {};
      episodes.forEach((episode) => {
        if (episode.bibtexKey) {
          episodesByBibtexKey[episode.bibtexKey] = episode;
        }
        if (episode.doi) {
          episodesByDoi[episode.doi.toLowerCase()] = episode;
        }
      });

      const radioData = {
        episodes: episodes,
        episodesByBibtexKey: episodesByBibtexKey,
        episodesByDoi: episodesByDoi,
        totalEpisodes: episodes.length,
        lastUpdated: new Date().toISOString(),
        source: 'https://fabiogiglietto.github.io/research-radio/'
      };

      console.log(`Successfully processed ${episodes.length} Research Radio episodes`);
      return radioData;

    } catch (error) {
      console.error('Error collecting Research Radio data:', error.message);

      return {
        episodes: [],
        episodesByBibtexKey: {},
        episodesByDoi: {},
        totalEpisodes: 0,
        error: error.message,
        lastUpdated: new Date().toISOString(),
        source: 'https://fabiogiglietto.github.io/research-radio/'
      };
    }
  }
}

const collector = new ResearchRadioCollector();

module.exports = {
  collect: () => collector.collect(),
  name: 'research-radio'
};

/**
 * Research Radio Collector
 * Fetches podcast episodes from the research-radio RSS feed
 */

const https = require('https');

class ResearchRadioCollector {
  constructor() {
    this.feedUrl = 'https://fabiogiglietto.github.io/research-radio/feed.xml';
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

  parseRSS(xmlData) {
    const episodes = [];

    // Simple XML parsing for RSS items
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlData)) !== null) {
      const itemContent = match[1];

      // Extract fields
      const title = this.extractTag(itemContent, 'title');
      const description = this.extractTag(itemContent, 'description');
      const guid = this.extractTag(itemContent, 'guid');
      const pubDate = this.extractTag(itemContent, 'pubDate');
      const duration = this.extractTag(itemContent, 'itunes:duration');
      const author = this.extractTag(itemContent, 'itunes:author');

      // Extract enclosure URL
      const enclosureMatch = itemContent.match(/<enclosure[^>]*url="([^"]+)"/);
      const audioUrl = enclosureMatch ? enclosureMatch[1] : null;

      // Extract DOI from description
      const doiMatch = description ? description.match(/https?:\/\/doi\.org\/([^\s<]+)/) : null;
      const doi = doiMatch ? doiMatch[1] : null;

      // Extract bibtex key from guid (format: bibtex:Key2024-xx)
      const bibtexKey = guid ? guid.replace('bibtex:', '') : null;

      episodes.push({
        id: guid,
        bibtexKey: bibtexKey,
        title: title ? title.replace("FG's Research Radio: ", '') : null,
        description: description,
        audioUrl: audioUrl,
        pubDate: pubDate,
        duration: duration,
        author: author,
        doi: doi
      });
    }

    return episodes;
  }

  extractTag(content, tagName) {
    // Handle CDATA sections
    const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
    const cdataMatch = content.match(cdataRegex);
    if (cdataMatch) {
      return cdataMatch[1].trim();
    }

    // Handle regular tags
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = content.match(regex);
    return match ? this.decodeHtmlEntities(match[1].trim()) : null;
  }

  decodeHtmlEntities(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  async collect() {
    try {
      console.log('Fetching Research Radio podcast feed...');

      const xmlData = await this.fetchFromUrl(this.feedUrl);
      const episodes = this.parseRSS(xmlData);

      console.log(`Found ${episodes.length} podcast episodes`);

      // Create a lookup map by bibtex key for easy matching with toread papers
      const episodesByBibtexKey = {};
      episodes.forEach(episode => {
        if (episode.bibtexKey) {
          episodesByBibtexKey[episode.bibtexKey] = episode;
        }
      });

      // Also create a lookup by DOI
      const episodesByDoi = {};
      episodes.forEach(episode => {
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

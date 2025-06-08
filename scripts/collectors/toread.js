/**
 * Toread Papers Collector
 * Fetches papers from the GitHub toread repository feed.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

class ToreadCollector {
  constructor() {
    this.baseDir = path.join(__dirname, '..', '..', 'public', 'data');
    this.feedUrl = 'https://raw.githubusercontent.com/fabiogiglietto/toread/main/output/feed.json';
  }

  async fetchFromUrl(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (parseError) {
            reject(new Error(`Error parsing JSON: ${parseError.message}`));
          }
        });
      }).on('error', (err) => {
        reject(new Error(`HTTPS request failed: ${err.message}`));
      });
    });
  }

  extractYear(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    return isNaN(date.getFullYear()) ? null : date.getFullYear();
  }

  extractDoi(url) {
    if (!url) return null;
    // Extract DOI from URL like https://doi.org/10.1234/example
    const doiMatch = url.match(/doi\.org\/(.+)$/);
    return doiMatch ? doiMatch[1] : null;
  }

  extractVenue(academic) {
    if (!academic) return null;
    
    // Try to extract venue from various academic metadata fields
    if (academic.journal) return academic.journal;
    if (academic.venue) return academic.venue;
    if (academic.publisher) return academic.publisher;
    if (academic.container_title) return academic.container_title;
    
    return null;
  }

  async collect() {
    try {
      console.log('Fetching toread papers from GitHub feed...');
      
      // Fetch the JSON feed from GitHub
      const feedData = await this.fetchFromUrl(this.feedUrl);
      
      if (!feedData || !feedData.items) {
        console.error('Invalid feed data structure');
        return null;
      }

      console.log(`Found ${feedData.items.length} papers in the feed`);

      // Convert feed items to our paper format
      const papers = feedData.items.map(item => {
        const academic = item._academic || {};
        const year = this.extractYear(item.date_published) || this.extractYear(academic.published_date);
        const doi = this.extractDoi(item.url) || academic.doi;
        const venue = this.extractVenue(academic);
        
        return {
          id: item.id,
          title: item.title,
          authors: item.authors ? item.authors.map(author => author.name || author) : [],
          venue: venue,
          year: year,
          url: item.url || item.external_url,
          doi: doi,
          abstract: item.content_text,
          tags: item.tags || [],
          dateAdded: item.date_published,
          status: "to-read", // Default status for all papers
          citationCount: academic.citation_count || 0,
          referenceCount: academic.reference_count || 0,
          publisher: academic.publisher,
          type: academic.type,
          confidenceScore: academic.confidence_score
        };
      });

      // Sort papers by date added (most recent first)
      papers.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

      // Calculate metadata
      const metadata = {
        totalPapers: papers.length,
        toRead: papers.filter(p => p.status === 'to-read').length,
        inProgress: papers.filter(p => p.status === 'in-progress').length,
        completed: papers.filter(p => p.status === 'completed').length,
        feedInfo: {
          title: feedData.title,
          description: feedData.description,
          lastBuildDate: feedData.lastBuildDate
        }
      };

      const toreadData = {
        papers: papers,
        metadata: metadata,
        lastUpdated: new Date().toISOString(),
        source: 'https://github.com/fabiogiglietto/toread'
      };

      console.log(`Successfully processed ${papers.length} papers from toread feed`);
      return toreadData;
      
    } catch (error) {
      console.error('Error collecting toread data:', error.message);
      
      // Return fallback data in case of error
      return {
        papers: [],
        metadata: {
          totalPapers: 0,
          toRead: 0,
          inProgress: 0,
          completed: 0,
          error: error.message
        },
        lastUpdated: new Date().toISOString(),
        source: 'https://github.com/fabiogiglietto/toread'
      };
    }
  }
}

module.exports = new ToreadCollector();
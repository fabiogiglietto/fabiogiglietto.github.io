/**
 * Crossref Collector
 * 
 * Fetches authoritative publication metadata from Crossref API using DOIs.
 * This provides the most complete and reliable author information.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CROSSREF_API_BASE = 'https://api.crossref.org/works';
const OUTPUT_PATH = path.join(__dirname, '../../public/data/crossref.json');

// Rate limiting: Crossref allows 50 requests/second, but we'll be conservative
const RATE_LIMIT_DELAY = 200; // 200ms = 5 requests per second
const BATCH_SIZE = 10; // Process 10 DOIs at a time

async function collect() {
  console.log('Collecting publication data from Crossref...');
  
  try {
    // First, get DOIs from existing aggregated data
    const aggregatedDataPath = path.join(__dirname, '../../public/data/aggregated-publications.json');
    
    if (!fs.existsSync(aggregatedDataPath)) {
      console.log('No aggregated data found. Please run publications aggregator first.');
      return null;
    }
    
    const aggregatedData = JSON.parse(fs.readFileSync(aggregatedDataPath, 'utf8'));
    
    // Extract DOIs from aggregated publications
    const dois = aggregatedData.publications
      .map(pub => pub.doi)
      .filter(doi => doi && doi.trim() !== '')
      .map(doi => doi.trim());
    
    console.log(`Found ${dois.length} DOIs to query from Crossref`);
    
    if (dois.length === 0) {
      console.log('No DOIs found in aggregated data. Cannot query Crossref.');
      return { publications: [], lastUpdated: new Date().toISOString() };
    }
    
    const publications = [];
    
    // Process DOIs in batches
    for (let i = 0; i < dois.length; i += BATCH_SIZE) {
      const batch = dois.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(dois.length / BATCH_SIZE)}: ${batch.length} DOIs`);
      
      // Process each DOI in the batch with rate limiting
      for (const doi of batch) {
        try {
          const publication = await fetchCrossrefMetadata(doi);
          if (publication) {
            publications.push(publication);
            console.log(`✓ Retrieved metadata for: "${publication.title.substring(0, 60)}..."`);
          }
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        } catch (error) {
          console.error(`✗ Error fetching DOI ${doi}:`, error.message);
          // Continue with next DOI
        }
      }
    }
    
    const result = {
      publications,
      lastUpdated: new Date().toISOString(),
      metadata: {
        total_requested: dois.length,
        successful_requests: publications.length,
        failed_requests: dois.length - publications.length
      }
    };
    
    // Save to file
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
    console.log(`✓ Crossref data saved to ${OUTPUT_PATH}`);
    console.log(`Successfully retrieved ${publications.length}/${dois.length} publications from Crossref`);
    
    return result;
  } catch (error) {
    console.error('Error in Crossref collection:', error);
    throw error;
  }
}

/**
 * Fetch metadata for a single DOI from Crossref
 */
async function fetchCrossrefMetadata(doi) {
  const url = `${CROSSREF_API_BASE}/${encodeURIComponent(doi)}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Academic Website Data Collector (mailto:fabio.giglietto@uniurb.it)',
        'Accept': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    const work = response.data.message;
    
    // Extract authors from Crossref data
    const authors = extractAuthors(work.author);
    
    // Extract publication year
    const year = extractYear(work);
    
    // Extract venue/journal
    const venue = extractVenue(work);
    
    return {
      doi: work.DOI,
      title: work.title ? work.title[0] : 'Unknown Title',
      authors: authors,
      venue: venue,
      year: year,
      type: work.type || 'article',
      url: work.URL,
      crossref_type: work.type,
      publisher: work.publisher,
      container_title: work['container-title'] ? work['container-title'][0] : null,
      page: work.page,
      volume: work.volume,
      issue: work.issue,
      issn: work.ISSN ? work.ISSN[0] : null,
      isbn: work.ISBN ? work.ISBN[0] : null,
      subject: work.subject || [],
      abstract: work.abstract || null,
      license: work.license ? work.license.map(l => l.URL) : [],
      funder: work.funder || [],
      crossref_score: work.score || 1.0
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`DOI not found in Crossref: ${doi}`);
      return null;
    }
    throw new Error(`Failed to fetch ${doi}: ${error.message}`);
  }
}

/**
 * Extract and format authors from Crossref author data
 */
function extractAuthors(authorArray) {
  if (!authorArray || !Array.isArray(authorArray) || authorArray.length === 0) {
    return null;
  }
  
  const formattedAuthors = authorArray.map(author => {
    if (!author.family) {
      // Handle case where only given name exists or author is an organization
      return author.name || author.given || 'Unknown Author';
    }
    
    let formatted = author.family;
    
    if (author.given) {
      // Format as "Surname, Given Names" for consistency with academic citation style
      formatted += `, ${author.given}`;
    }
    
    return formatted;
  });
  
  return formattedAuthors.join('; ');
}

/**
 * Extract publication year from Crossref date information
 */
function extractYear(work) {
  // Try different date fields in order of preference
  const dateFields = [
    'published-print',
    'published-online',
    'created',
    'deposited',
    'indexed'
  ];
  
  for (const field of dateFields) {
    if (work[field] && work[field]['date-parts'] && work[field]['date-parts'][0]) {
      const year = work[field]['date-parts'][0][0];
      if (year && typeof year === 'number' && year > 1900 && year <= new Date().getFullYear() + 1) {
        return year;
      }
    }
  }
  
  return null;
}

/**
 * Extract venue/journal information
 */
function extractVenue(work) {
  // Try different venue fields
  if (work['container-title'] && work['container-title'][0]) {
    return work['container-title'][0];
  }
  
  if (work['event'] && work['event']['name']) {
    return work['event']['name'];
  }
  
  if (work['publisher']) {
    return work['publisher'];
  }
  
  return '';
}

/**
 * Sleep function for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { collect };
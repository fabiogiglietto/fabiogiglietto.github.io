/**
 * ORA UNIURB (IRIS) Institutional Repository Collector
 *
 * Fetches publication data from the University of Urbino's institutional repository
 * using the OAI-PMH protocol (Open Archives Initiative Protocol for Metadata Harvesting).
 *
 * API Documentation:
 * - OAI-PMH Base URL: https://ora.uniurb.it/oai/request
 * - Supported verbs: Identify, ListMetadataFormats, ListSets, ListRecords, GetRecord
 * - Metadata format: oai_dc (Dublin Core)
 */

const axios = require('axios');
const xml2js = require('xml2js');
const config = require('../config');

// OAI-PMH endpoint configuration
const OAI_BASE_URL = 'https://ora.uniurb.it/oai/request';
const METADATA_PREFIX = 'oai_dc';

// Author name variations to search for
const AUTHOR_VARIATIONS = [
  'giglietto',
  'Giglietto',
  'GIGLIETTO'
];

/**
 * Parse XML response to JavaScript object
 */
async function parseXML(xmlString) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [xml2js.processors.stripPrefix]
  });
  return parser.parseStringPromise(xmlString);
}

/**
 * Extract Dublin Core fields from a record
 */
function extractDublinCore(record) {
  try {
    const header = record.header || {};
    const metadata = record.metadata || {};
    const dc = metadata.dc || {};

    // Helper to get array or single value as array
    const toArray = (val) => {
      if (!val) return [];
      return Array.isArray(val) ? val : [val];
    };

    // Extract identifier (handle)
    const identifier = header.identifier || '';
    const handleMatch = identifier.match(/oai:ora\.uniurb\.it:(\d+\/\d+)/);
    const handle = handleMatch ? handleMatch[1] : null;

    // Extract DOI if present
    const identifiers = toArray(dc.identifier);
    let doi = null;
    for (const id of identifiers) {
      const idStr = typeof id === 'string' ? id : (id._ || id);
      if (idStr && idStr.includes('doi.org')) {
        doi = idStr.replace(/^https?:\/\/doi\.org\//, '');
      } else if (idStr && idStr.match(/^10\.\d+\//)) {
        doi = idStr;
      }
    }

    // Extract year from date
    const dates = toArray(dc.date);
    let year = null;
    for (const date of dates) {
      const dateStr = typeof date === 'string' ? date : (date._ || date);
      if (dateStr) {
        const yearMatch = dateStr.match(/(\d{4})/);
        if (yearMatch) {
          year = parseInt(yearMatch[1], 10);
          break;
        }
      }
    }

    // Extract type
    const types = toArray(dc.type);
    let publicationType = 'other';
    for (const type of types) {
      const typeStr = typeof type === 'string' ? type : (type._ || type);
      if (typeStr) {
        if (typeStr.includes('article')) publicationType = 'article';
        else if (typeStr.includes('book') && typeStr.includes('Part')) publicationType = 'chapter';
        else if (typeStr.includes('book')) publicationType = 'book';
        else if (typeStr.includes('conference')) publicationType = 'conference';
        else if (typeStr.includes('thesis')) publicationType = 'thesis';
      }
    }

    // Extract title
    const titles = toArray(dc.title);
    const title = titles.length > 0 ?
      (typeof titles[0] === 'string' ? titles[0] : (titles[0]._ || '')) : '';

    // Extract authors
    const creators = toArray(dc.creator);
    const authors = creators.map(c => typeof c === 'string' ? c : (c._ || '')).filter(Boolean);

    // Extract abstract/description
    const descriptions = toArray(dc.description);
    const abstract = descriptions.length > 0 ?
      (typeof descriptions[0] === 'string' ? descriptions[0] : (descriptions[0]._ || '')) : null;

    // Extract publisher
    const publishers = toArray(dc.publisher);
    const publisher = publishers.length > 0 ?
      (typeof publishers[0] === 'string' ? publishers[0] : (publishers[0]._ || '')) : null;

    // Extract relations (journal, pages, etc.)
    const relations = toArray(dc.relation);
    let journal = null;
    let pages = null;
    for (const rel of relations) {
      const relStr = typeof rel === 'string' ? rel : (rel._ || rel);
      if (relStr && relStr.startsWith('journal:')) {
        journal = relStr.replace('journal:', '').trim();
      }
      if (relStr && relStr.match(/^\d+-\d+$/)) {
        pages = relStr;
      }
    }

    // Extract language
    const languages = toArray(dc.language);
    const language = languages.length > 0 ?
      (typeof languages[0] === 'string' ? languages[0] : (languages[0]._ || '')) : null;

    return {
      title: title.trim(),
      authors: authors.join('; '),
      authorsList: authors,
      year,
      doi,
      handle,
      type: publicationType,
      abstract,
      publisher,
      journal,
      pages,
      language,
      oaiIdentifier: identifier,
      datestamp: header.datestamp,
      url: handle ? `https://ora.uniurb.it/handle/${handle}` : null
    };
  } catch (error) {
    console.error('Error extracting Dublin Core:', error.message);
    return null;
  }
}

/**
 * Check if a record belongs to the target author
 */
function isAuthorRecord(record) {
  const authors = record.authorsList || [];
  const authorsLower = authors.map(a => a.toLowerCase());

  return AUTHOR_VARIATIONS.some(variant =>
    authorsLower.some(author => author.includes(variant.toLowerCase()))
  );
}

/**
 * Fetch records from OAI-PMH with resumption token support
 */
async function fetchOAIRecords(params = {}) {
  const allRecords = [];
  let resumptionToken = null;
  let pageCount = 0;
  const maxPages = 50; // Safety limit

  do {
    try {
      let url;
      if (resumptionToken) {
        url = `${OAI_BASE_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
      } else {
        const queryParams = new URLSearchParams({
          verb: 'ListRecords',
          metadataPrefix: METADATA_PREFIX,
          ...params
        });
        url = `${OAI_BASE_URL}?${queryParams.toString()}`;
      }

      console.log(`Fetching OAI-PMH page ${pageCount + 1}...`);

      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/xml'
        },
        timeout: 30000
      });

      const parsed = await parseXML(response.data);
      const oaiResponse = parsed['OAI-PMH'] || parsed;

      // Check for errors
      if (oaiResponse.error) {
        const errorCode = oaiResponse.error.$ ? oaiResponse.error.$.code : 'unknown';
        const errorMsg = oaiResponse.error._ || oaiResponse.error;
        if (errorCode === 'noRecordsMatch') {
          console.log('No records found for the specified criteria');
          break;
        }
        throw new Error(`OAI-PMH error (${errorCode}): ${errorMsg}`);
      }

      const listRecords = oaiResponse.ListRecords;
      if (!listRecords) {
        console.log('No ListRecords element in response');
        break;
      }

      // Extract records
      let records = listRecords.record || [];
      if (!Array.isArray(records)) {
        records = [records];
      }

      // Filter for target author and extract data
      for (const record of records) {
        // Skip deleted records
        if (record.header && record.header.$ && record.header.$.status === 'deleted') {
          continue;
        }

        const extracted = extractDublinCore(record);
        if (extracted && isAuthorRecord(extracted)) {
          allRecords.push(extracted);
        }
      }

      // Check for resumption token
      resumptionToken = listRecords.resumptionToken;
      if (resumptionToken && typeof resumptionToken === 'object') {
        resumptionToken = resumptionToken._ || null;
      }

      pageCount++;

      // Add delay between requests to be respectful
      if (resumptionToken) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      if (error.response && error.response.status === 503) {
        console.log('Server busy, waiting before retry...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      throw error;
    }

  } while (resumptionToken && pageCount < maxPages);

  return allRecords;
}

/**
 * Main collection function
 */
async function collect() {
  console.log('Starting ORA UNIURB (IRIS) data collection...');

  const results = {
    source: 'ORA UNIURB',
    repository: 'https://ora.uniurb.it',
    oaiEndpoint: OAI_BASE_URL,
    collectedAt: new Date().toISOString(),
    author: config.name,
    publications: [],
    stats: {
      total: 0,
      byType: {},
      byYear: {}
    }
  };

  try {
    // Fetch all records (we'll filter by author client-side since OAI-PMH
    // doesn't support author-based queries directly)
    // Fetch records from 1990 onwards to capture full publication history
    const fromDateStr = '1990-01-01';

    console.log(`Fetching records from ${fromDateStr} onwards...`);

    const records = await fetchOAIRecords({
      from: fromDateStr
    });

    console.log(`Found ${records.length} publications by ${config.name}`);

    // Sort by year (descending)
    records.sort((a, b) => (b.year || 0) - (a.year || 0));

    // Calculate stats
    for (const record of records) {
      results.stats.total++;

      // By type
      const type = record.type || 'other';
      results.stats.byType[type] = (results.stats.byType[type] || 0) + 1;

      // By year
      if (record.year) {
        results.stats.byYear[record.year] = (results.stats.byYear[record.year] || 0) + 1;
      }
    }

    results.publications = records;

    console.log('ORA UNIURB collection completed successfully');
    console.log(`Stats: ${results.stats.total} total publications`);
    console.log(`Types: ${JSON.stringify(results.stats.byType)}`);

    return results;

  } catch (error) {
    console.error('Error collecting ORA UNIURB data:', error.message);

    // Return empty result structure on error
    results.error = error.message;
    return results;
  }
}

module.exports = { collect };

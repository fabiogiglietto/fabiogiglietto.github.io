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
const fs = require('fs');
const path = require('path');
const config = require('../config');

// OAI-PMH endpoint configuration
const OAI_BASE_URL = 'https://ora.uniurb.it/oai/request';
const METADATA_PREFIX = 'oai_dc';

// Previous collector output, used as the baseline for incremental harvesting.
// The repository holds 50k+ records across 500+ OAI pages, so a full harvest
// is only done once (or with ORA_FULL_HARVEST=1); daily runs fetch only
// records modified since the last collection and merge them in.
const PREVIOUS_OUTPUT_PATH = path.join(__dirname, '../../public/data/ora.json');

// Overlap window (days) subtracted from the last collection date, so records
// whose datestamp lands close to the previous run are never missed.
const INCREMENTAL_OVERLAP_DAYS = 7;

/**
 * Check whether an author string denotes the target author.
 *
 * ORA records write the name many ways ("Giglietto Fabio", "Giglietto, F.",
 * "F. GIGLIETTO"), and the repository also holds records by other authors
 * with the same surname (e.g. the physicist N. Giglietto). Require the
 * surname plus either the first name or the bare initial "F".
 */
function isTargetAuthor(authorName) {
  const name = authorName.toLowerCase();
  if (!name.includes('giglietto')) return false;
  const rest = name.replace(/giglietto/g, ' ');
  return /\bfabio\b/.test(rest) || /\bf\.?(?=[\s,;]|$)/.test(rest);
}

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

    // Extract DOI and publisher URL if present. Besides the handle, records
    // may carry a second URL identifier pointing at the publisher's page
    // (e.g. an OJS article view) — the only external link for DOI-less items.
    const identifiers = toArray(dc.identifier);
    let doi = null;
    let publisherUrl = null;
    for (const id of identifiers) {
      const idStr = typeof id === 'string' ? id : (id._ || id);
      if (idStr && idStr.includes('doi.org')) {
        doi = idStr.replace(/^https?:\/\/doi\.org\//, '');
      } else if (idStr && idStr.match(/^10\.\d+\//)) {
        doi = idStr;
      } else if (idStr && /^https?:\/\//.test(idStr) && !idStr.includes('hdl.handle.net')) {
        publisherUrl = idStr;
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
      publisherUrl,
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
 * Resolve the direct open-access PDF URL for an ORA record.
 *
 * OAI-PMH `oai_dc` does not expose file URLs, so the handle landing page is
 * fetched once per record: ORA (IRIS) pages carry a Google-Scholar
 * `citation_pdf_url` meta tag pointing at the public full-text bitstream.
 * Returns null when the record has no public file (or the page is unreachable).
 */
async function fetchOaPdfUrl(handleUrl) {
  if (!handleUrl) return null;
  try {
    const response = await axios.get(handleUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      timeout: 30000
    });
    const metaTags = String(response.data).match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
      if (/name=["']citation_pdf_url["']/i.test(tag)) {
        const content = tag.match(/content=["']([^"']+)["']/i);
        if (content) return content[1];
      }
    }
    return null;
  } catch (error) {
    console.warn(`  ORA: could not resolve PDF URL for ${handleUrl}: ${error.message}`);
    return null;
  }
}

/**
 * Check if a record belongs to the target author
 */
function isAuthorRecord(record) {
  const authors = record.authorsList || [];
  return authors.some(isTargetAuthor);
}

/**
 * Fetch records from OAI-PMH with resumption token support
 */
async function fetchOAIRecords(params = {}, maxPages = 100) {
  const allRecords = [];
  const deletedHandles = [];
  let resumptionToken = null;
  let pageCount = 0;
  let truncated = false;

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
        // Track deleted records so incremental merges can drop them
        if (record.header && record.header.$ && record.header.$.status === 'deleted') {
          const delMatch = (record.header.identifier || '').match(/oai:ora\.uniurb\.it:(\d+\/\d+)/);
          if (delMatch) deletedHandles.push(delMatch[1]);
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

  if (resumptionToken) {
    truncated = true;
    console.warn(`WARNING: OAI harvest stopped at the ${maxPages}-page safety limit with records remaining — results are incomplete`);
  }

  return { records: allRecords, deletedHandles, truncated };
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
    // OAI-PMH doesn't support author queries, so records are filtered
    // client-side. The `from` parameter filters on datestamp (last modified):
    // with a previous output available, only records touched since the last
    // run are harvested and merged into it; otherwise (or with
    // ORA_FULL_HARVEST=1) the entire repository is scanned once.
    let previous = null;
    if (!process.env.ORA_FULL_HARVEST && fs.existsSync(PREVIOUS_OUTPUT_PATH)) {
      try {
        previous = JSON.parse(fs.readFileSync(PREVIOUS_OUTPUT_PATH, 'utf8'));
      } catch (e) {
        console.warn(`Could not read previous ORA output (${e.message}), doing a full harvest`);
      }
    }

    let fromDateStr = '1990-01-01';
    let maxPages = 1000; // Full harvest: repository is ~516 pages and growing
    if (previous && previous.collectedAt && Array.isArray(previous.publications)) {
      const fromDate = new Date(previous.collectedAt);
      fromDate.setDate(fromDate.getDate() - INCREMENTAL_OVERLAP_DAYS);
      fromDateStr = fromDate.toISOString().split('T')[0];
      maxPages = 100;
      console.log(`Incremental harvest: records modified since ${fromDateStr} (previous collection had ${previous.publications.length} publications)`);
    } else {
      console.log('Full harvest: scanning the entire repository');
      previous = null;
    }

    const { records: harvested, deletedHandles, truncated } = await fetchOAIRecords({
      from: fromDateStr
    }, maxPages);

    console.log(`Harvested ${harvested.length} publications by ${config.name}${previous ? ' (new or updated)' : ''}`);

    // Merge into the previous collection: upsert harvested records by handle,
    // drop records the repository reports as deleted.
    let records;
    if (previous) {
      const byHandle = new Map(previous.publications.map(p => [p.handle, p]));
      for (const rec of harvested) {
        const existing = byHandle.get(rec.handle);
        if (existing && existing.oaPdfUrl) {
          rec.oaPdfUrl = existing.oaPdfUrl; // Keep the resolved OA link
        }
        byHandle.set(rec.handle, rec);
      }
      for (const handle of deletedHandles) {
        if (byHandle.delete(handle)) {
          console.log(`Removed deleted record: ${handle}`);
        }
      }
      records = Array.from(byHandle.values());
    } else {
      records = harvested;
    }

    if (truncated && !previous) {
      console.warn('Full harvest was truncated — refusing to overwrite previous data with an incomplete set');
      return null;
    }

    // Resolve each record's open-access PDF URL from its landing page. This is
    // the green-OA full text consumed downstream for podcasts and vault notes.
    // Only records without a resolved URL are checked (covers new records and
    // late-deposited OA full texts).
    const unresolved = records.filter(r => !r.oaPdfUrl);
    console.log(`Resolving open-access PDF URLs for ${unresolved.length} records...`);
    let oaPdfCount = 0;
    for (const record of unresolved) {
      record.oaPdfUrl = await fetchOaPdfUrl(record.url);
      if (record.oaPdfUrl) oaPdfCount++;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`Resolved ${oaPdfCount}/${unresolved.length} newly checked open-access PDF URLs`);

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

/**
 * Publications Aggregator
 * 
 * Aggregates publication data from multiple sources (ORCID, Google Scholar, 
 * Web of Science, Scopus, Semantic Scholar) and combines it into a unified format with 
 * comprehensive citation metrics.
 */

const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');
const config = require('../config');

// Note: These collector imports are kept for potential future use
// but data is loaded from files instead of re-collecting
const _orcidCollector = require('./orcid');
const _scholarCollector = require('./scholar');
const _wosCollector = require('./wos');
const _scopusCollector = require('./scopus');
const crossrefCollector = require('./crossref');
const _semanticScholarCollector = require('./semantic-scholar');

// Helper function to load existing data files
async function loadDataFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } else {
      console.log(`Data file not found: ${filePath}`);
      return null;
    }
  } catch (error) {
    console.error(`Error loading data file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Generic processor for merging publications from a data source
 * Reduces code duplication across WoS, Scopus, Semantic Scholar processing
 *
 * @param {Object} sourceData - The source data containing publications array
 * @param {string} sourceName - Name of the source (wos, scopus, semanticScholar)
 * @param {Map} publicationsMap - The map of existing publications
 * @param {Object} fieldMapping - Maps source fields to publication fields
 */
function processPublicationSource(sourceData, sourceName, publicationsMap, fieldMapping) {
  if (!sourceData?.publications) return;

  console.log(`Processing ${sourceData.publications.length} publications from ${fieldMapping.displayName}`);

  sourceData.publications.forEach(pub => {
    let matched = false;

    // Try to match by DOI first
    if (pub.doi) {
      const doiKey = `doi:${pub.doi.toLowerCase()}`;
      if (publicationsMap.has(doiKey)) {
        const publication = publicationsMap.get(doiKey);
        updatePublicationFromSource(publication, pub, sourceName, fieldMapping);
        console.log(`Matched ${fieldMapping.displayName} publication by DOI: "${pub.title}" with ${pub.citations || 0} citations`);
        matched = true;
      }
    }

    // If no DOI match, try by title
    if (!matched) {
      const sourceTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');

      for (const [_key, publication] of publicationsMap.entries()) {
        const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');

        if (isSimilarTitle(pubTitle, sourceTitle)) {
          updatePublicationFromSource(publication, pub, sourceName, fieldMapping);

          // Add DOI if missing
          if (!publication.doi && pub.doi) {
            publication.doi = pub.doi;
          }

          console.log(`Matched ${fieldMapping.displayName} publication by title: "${pub.title}" with ${pub.citations || 0} citations`);
          matched = true;
          break;
        }
      }
    }

    // If still no match, add as new entry
    if (!matched) {
      const key = pub.doi
        ? `doi:${pub.doi.toLowerCase()}`
        : `title:${pub.title.toLowerCase().replace(/[^\w\s]/g, '')}`;

      const newPublication = createNewPublication(pub, sourceName, fieldMapping);
      publicationsMap.set(key, newPublication);
    }
  });
}

/**
 * Updates an existing publication with data from a source
 */
function updatePublicationFromSource(publication, sourcePub, sourceName, fieldMapping) {
  publication.citations[sourceName] = sourcePub.citations || 0;
  publication.source_urls[sourceName] = fieldMapping.buildUrl ? fieldMapping.buildUrl(sourcePub) : sourcePub.url;
  publication.source_ids[sourceName] = sourcePub[fieldMapping.idField];

  // Update authors if available and current is null
  if (!publication.authors && sourcePub.authors) {
    publication.authors = sourcePub.authors;
  }

  // Handle source-specific extra fields
  if (fieldMapping.extraFields) {
    fieldMapping.extraFields(publication, sourcePub);
  }
}

/**
 * Creates a new publication entry from a source
 */
function createNewPublication(sourcePub, sourceName, fieldMapping) {
  const publication = {
    title: sourcePub.title,
    authors: sourcePub.authors,
    venue: sourcePub.venue,
    year: sourcePub.year ? parseInt(sourcePub.year) : null,
    doi: sourcePub.doi,
    citations: {
      scholar: null,
      wos: null,
      scopus: null,
      semanticScholar: null
    },
    source_urls: {
      orcid: null,
      scholar: null,
      wos: null,
      scopus: null,
      semanticScholar: null,
      ora: null
    },
    source_ids: {
      orcid: null,
      scholar: null,
      wos: null,
      scopus: null,
      semanticScholar: null,
      ora: null
    },
    metrics: {}
  };

  // Set source-specific fields
  publication.citations[sourceName] = sourcePub.citations || 0;
  publication.source_urls[sourceName] = fieldMapping.buildUrl ? fieldMapping.buildUrl(sourcePub) : sourcePub.url;
  publication.source_ids[sourceName] = sourcePub[fieldMapping.idField];

  // Handle source-specific extra fields
  if (fieldMapping.extraFields) {
    fieldMapping.extraFields(publication, sourcePub);
  }

  return publication;
}

// Field mappings for each source
const SOURCE_MAPPINGS = {
  wos: {
    displayName: 'Web of Science',
    idField: 'wosId',
    buildUrl: null // Uses pub.url directly
  },
  scopus: {
    displayName: 'Scopus',
    idField: 'scopusId',
    buildUrl: null // Uses pub.url directly
  },
  semanticScholar: {
    displayName: 'Semantic Scholar',
    idField: 'semanticScholarId',
    buildUrl: (pub) => `https://www.semanticscholar.org/paper/${pub.semanticScholarId}`,
    extraFields: (publication, sourcePub) => {
      publication.influentialCitations = sourcePub.influentialCitations;
      publication.isOpenAccess = sourcePub.isOpenAccess;
      publication.openAccessPdf = sourcePub.openAccessPdf;
      publication.fieldsOfStudy = sourcePub.fieldsOfStudy;
    }
  },
  ora: {
    displayName: 'ORA UNIURB',
    idField: 'handle',
    buildUrl: (pub) => pub.url || `https://ora.uniurb.it/handle/${pub.handle}`,
    extraFields: (publication, sourcePub) => {
      publication.oraHandle = sourcePub.handle;
      publication.oraType = sourcePub.type;
      if (sourcePub.abstract) {
        publication.abstract = sourcePub.abstract;
      }
    }
  }
};

async function collect() {
  console.log('Aggregating publication data from multiple sources...');
  
  try {
    const dataDir = path.join(__dirname, '../../public/data');
    
    // Load existing data files instead of re-collecting
    console.log('Loading existing data files...');
    const [orcidData, scholarData, wosData, scopusData, semanticScholarData, oraData] = await Promise.all([
      loadDataFile(path.join(dataDir, 'orcid.json')),
      loadDataFile(path.join(dataDir, 'scholar.json')),
      loadDataFile(path.join(dataDir, 'wos.json')),
      loadDataFile(path.join(dataDir, 'scopus.json')),
      loadDataFile(path.join(dataDir, 'semantic-scholar.json')),
      loadDataFile(path.join(dataDir, 'ora.json'))
    ]);
    
    // Collect crossref data which depends on aggregated data
    const crossrefData = await crossrefCollector.collect().catch(err => {
      console.error('Crossref collection error:', err);
      return null;
    });
    
    // Extract work summaries from ORCID data - this is our base list
    let publicationsMap = new Map();
    
    // Process ORCID works first (as the canonical source)
    if (orcidData && orcidData.works && orcidData.works.length > 0) {
      console.log(`Processing ${orcidData.works.length} works from ORCID`);
      
      // Remove duplicate works (some works have multiple entries in ORCID)
      const uniqueWorks = new Map();
      
      orcidData.works.forEach(workGroup => {
        try {
          // Each work group can contain multiple versions of the same work
          // Make sure the work-summary array exists and has at least one item
          if (!workGroup['work-summary'] || !Array.isArray(workGroup['work-summary']) || workGroup['work-summary'].length === 0) {
            console.log('Skipping work group without valid work-summary array');
            return;
          }
          
          const work = workGroup['work-summary'][0];
          
          // Skip if no title (should not happen, but just in case)
          if (!work?.title?.title?.value) {
            console.log('Skipping work with no title');
            return;
          }
          
          // Create a work identifier based on title for deduplication
          const titleKey = work.title.title.value.toLowerCase().replace(/[^\w\s]/g, '');
          
          // Check if we've already seen this work (prefer works with DOIs)
          let hasDoi = false;
          if (work['external-ids'] && work['external-ids']['external-id']) {
            hasDoi = work['external-ids']['external-id'].some(id => id['external-id-type'] === 'doi');
          }
          
          // Only add this work if we haven't seen it before or if this version has a DOI and the previous one didn't
          if (!uniqueWorks.has(titleKey) || (hasDoi && !uniqueWorks.get(titleKey).hasDoi)) {
            uniqueWorks.set(titleKey, { work, hasDoi });
          }
        } catch (workError) {
          console.error('Error processing work group:', workError);
          console.log('Problematic work group:', JSON.stringify(workGroup).substring(0, 200) + '...');
        }
      });
      
      console.log(`After deduplication: ${uniqueWorks.size} unique works`);
      
      // Process the unique works
      for (const { work } of uniqueWorks.values()) {
        try {
        
        // Get the DOI if available
        let doi = null;
        if (work['external-ids'] && work['external-ids']['external-id']) {
          const doiId = work['external-ids']['external-id'].find(id => id['external-id-type'] === 'doi');
          if (doiId) {
            doi = doiId['external-id-value'];
          }
        }
        
        // Create a map key from DOI or title
        const key = doi ? 
          `doi:${doi.toLowerCase()}` : 
          `title:${work.title.title.value.toLowerCase().replace(/[^\w\s]/g, '')}`;
        
        // Extract journal title if available
        let journalTitle = null;
        if (work['journal-title'] && work['journal-title'].value) {
          journalTitle = work['journal-title'].value;
        }
        
        // Get authors if available (from specific source)
        let authors = null;
        // ORCID doesn't provide authors in the summary view
        
        // Extract full publication date (year, month, day) from ORCID
        let year = null;
        let month = null;
        let day = null;
        let publicationDate = null;

        if (work['publication-date']) {
          if (work['publication-date'].year) {
            year = parseInt(work['publication-date'].year.value);
          }
          if (work['publication-date'].month) {
            month = parseInt(work['publication-date'].month.value);
          }
          if (work['publication-date'].day) {
            day = parseInt(work['publication-date'].day.value);
          }
          // Create ISO date string for sorting (YYYY-MM-DD)
          if (year) {
            publicationDate = `${year}-${String(month || 1).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`;
          }
        }

        publicationsMap.set(key, {
          title: work.title.title.value,
          type: work.type,
          venue: journalTitle,
          authors: authors,
          year: year,
          month: month,
          day: day,
          publicationDate: publicationDate,
          doi: doi,
          citations: {
            scholar: null,
            wos: null,
            scopus: null,
            semanticScholar: null
          },
          source_urls: {
            orcid: work.url ? work.url.value : null,
            scholar: null,
            wos: null,
            scopus: null,
            semanticScholar: null,
            ora: null
          },
          source_ids: {
            orcid: work['put-code'],
            scholar: null,
            wos: null,
            scopus: null,
            semanticScholar: null,
            ora: null
          },
          metrics: {}
        });
        } catch (workProcessError) {
          console.error('Error processing work:', workProcessError);
          console.log('Problematic work:', JSON.stringify(work).substring(0, 200) + '...');
        }
      }
    }
    
    // Process Google Scholar publications
    if (scholarData && scholarData.publications) {
      scholarData.publications.forEach(pub => {
        // Normalize title for matching
        const scholarTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');
        
        // Try to find a match in the map
        let found = false;
        for (const [key, publication] of publicationsMap.entries()) {
          const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');
          
          // Check if titles are similar enough
          if (key.startsWith('title:') && isSimilarTitle(pubTitle, scholarTitle)) {
            // Update with Scholar data
            publication.citations.scholar = pub.citations ? parseInt(pub.citations) : 0;
            publication.source_urls.scholar = config.buildScholarUrl(pub.id);
            publication.source_ids.scholar = pub.id;
            
            // Add year if missing
            if (!publication.year && pub.year) {
              publication.year = parseInt(pub.year);
            }
            
            // Update authors if available and original is null
            if (!publication.authors && pub.authors) {
              publication.authors = pub.authors;
            }
            
            found = true;
            break;
          }
        }
        
        // If not found, add as new entry
        if (!found) {
          const key = `title:${scholarTitle}`;
          publicationsMap.set(key, {
            title: pub.title,
            authors: pub.authors,
            venue: pub.venue,
            year: pub.year ? parseInt(pub.year) : null,
            doi: null,
            citations: {
              scholar: pub.citations ? parseInt(pub.citations) : 0,
              wos: null,
              scopus: null,
              semanticScholar: null
            },
            source_urls: {
              orcid: null,
              scholar: config.buildScholarUrl(pub.id),
              wos: null,
              scopus: null,
              semanticScholar: null,
              ora: null
            },
            source_ids: {
              orcid: null,
              scholar: pub.id,
              wos: null,
              scopus: null,
              semanticScholar: null,
              ora: null
            },
            metrics: {}
          });
        }
      });
    }

    // Process ORA UNIURB publications (institutional repository)
    if (oraData && oraData.publications) {
      console.log(`Processing ${oraData.publications.length} publications from ORA UNIURB`);

      oraData.publications.forEach(pub => {
        let matched = false;

        // Try to match by DOI first
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            publication.source_urls.ora = pub.url;
            publication.source_ids.ora = pub.handle;
            publication.oraHandle = pub.handle;
            if (pub.abstract && !publication.abstract) {
              publication.abstract = pub.abstract;
            }
            console.log(`Matched ORA publication by DOI: "${pub.title}"`);
            matched = true;
          }
        }

        // If no DOI match, try by title
        if (!matched) {
          const oraTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');

          for (const [_key, publication] of publicationsMap.entries()) {
            const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');

            if (isSimilarTitle(pubTitle, oraTitle)) {
              publication.source_urls.ora = pub.url;
              publication.source_ids.ora = pub.handle;
              publication.oraHandle = pub.handle;
              if (pub.abstract && !publication.abstract) {
                publication.abstract = pub.abstract;
              }
              // Add DOI if missing
              if (!publication.doi && pub.doi) {
                publication.doi = pub.doi;
              }
              console.log(`Matched ORA publication by title: "${pub.title}"`);
              matched = true;
              break;
            }
          }
        }

        // If still no match, add as new entry (ORA has full-text access)
        if (!matched) {
          const key = pub.doi
            ? `doi:${pub.doi.toLowerCase()}`
            : `title:${pub.title.toLowerCase().replace(/[^\w\s]/g, '')}`;

          publicationsMap.set(key, {
            title: pub.title,
            authors: pub.authors,
            venue: pub.journal || pub.publisher,
            year: pub.year,
            doi: pub.doi,
            citations: {
              scholar: null,
              wos: null,
              scopus: null,
              semanticScholar: null
            },
            source_urls: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: null,
              semanticScholar: null,
              ora: pub.url
            },
            source_ids: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: null,
              semanticScholar: null,
              ora: pub.handle
            },
            oraHandle: pub.handle,
            oraType: pub.type,
            abstract: pub.abstract,
            metrics: {}
          });
          console.log(`Added new publication from ORA: "${pub.title}"`);
        }
      });
    }

    // Process Web of Science publications using generic processor
    processPublicationSource(wosData, 'wos', publicationsMap, SOURCE_MAPPINGS.wos);
    
    // Process Scopus publications using generic processor
    processPublicationSource(scopusData, 'scopus', publicationsMap, SOURCE_MAPPINGS.scopus);
    
    // Process Crossref publications (AUTHORITATIVE SOURCE for author information)
    if (crossrefData && crossrefData.publications) {
      console.log(`Processing ${crossrefData.publications.length} publications from Crossref (authoritative source)`);
      
      crossrefData.publications.forEach(pub => {
        // Match by DOI (Crossref is DOI-based, so this should always work)
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            
            // PRIORITIZE Crossref authors as the authoritative source
            if (pub.authors) {
              publication.authors = pub.authors;
              console.log(`✓ Updated authoritative authors from Crossref for: "${pub.title.substring(0, 60)}..."`);
            }
            
            // Add other Crossref metadata
            publication.source_urls.crossref = pub.url;
            publication.crossref_type = pub.crossref_type;
            publication.publisher = pub.publisher;
            
            // Update venue if more complete in Crossref
            if (pub.venue && (!publication.venue || publication.venue.length < pub.venue.length)) {
              publication.venue = pub.venue;
            }
            
            // Update year if missing
            if (!publication.year && pub.year) {
              publication.year = pub.year;
            }
          } else {
            // Add new publication from Crossref
            console.log(`Adding new publication from Crossref: "${pub.title.substring(0, 60)}..."`);
            publicationsMap.set(doiKey, {
              title: pub.title,
              authors: pub.authors,
              venue: pub.venue,
              year: pub.year,
              doi: pub.doi,
              citations: {
                scholar: null,
                wos: null,
                scopus: null,
                semanticScholar: null
              },
              source_urls: {
                orcid: null,
                scholar: null,
                wos: null,
                scopus: null,
                crossref: pub.url,
                semanticScholar: null
              },
              source_ids: {
                orcid: null,
                scholar: null,
                wos: null,
                scopus: null,
                semanticScholar: null
              },
              crossref_type: pub.crossref_type,
              publisher: pub.publisher,
              metrics: {}
            });
          }
        }
      });
    }
    
    // Process Semantic Scholar publications using generic processor
    processPublicationSource(semanticScholarData, 'semanticScholar', publicationsMap, SOURCE_MAPPINGS.semanticScholar);
    
    // Convert map to array and calculate aggregate metrics
    const publications = Array.from(publicationsMap.values()).map(pub => {
      // Calculate best citation count
      const citationCounts = [
        pub.citations.scholar, 
        pub.citations.wos, 
        pub.citations.scopus,
        pub.citations.semanticScholar
      ].filter(count => count !== null);
      
      pub.metrics = {
        total_citations: citationCounts.length > 0 ? Math.max(...citationCounts) : 0,
        citation_sources: citationCounts.length
      };
      
      return pub;
    });
    
    // Sort by citation count (highest first)
    publications.sort((a, b) => b.metrics.total_citations - a.metrics.total_citations);
    
    // Calculate metrics across all publications
    const metrics = {
      total_publications: publications.length,
      total_citations: publications.reduce((sum, pub) => sum + (pub.metrics.total_citations || 0), 0),
      h_index: calculateHIndex(publications.map(pub => pub.metrics.total_citations || 0)),
      i10_index: publications.filter(pub => (pub.metrics.total_citations || 0) >= 10).length,
      citation_sources: {
        with_scholar: publications.filter(pub => pub.citations.scholar !== null).length,
        with_wos: publications.filter(pub => pub.citations.wos !== null).length,
        with_scopus: publications.filter(pub => pub.citations.scopus !== null).length,
        with_semanticScholar: publications.filter(pub => pub.citations.semanticScholar !== null).length,
        with_crossref: publications.filter(pub => pub.source_urls && pub.source_urls.crossref).length,
        with_ora: publications.filter(pub => pub.source_urls && pub.source_urls.ora !== null).length
      }
    };
    
    return {
      publications,
      metrics,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error aggregating publication data:', error);
    throw error;
  }
}

/**
 * Calculate h-index from an array of citation counts
 */
function calculateHIndex(citations) {
  // Sort citations in descending order
  const sortedCitations = [...citations].sort((a, b) => b - a);
  
  // Find the largest index i where sortedCitations[i] >= i+1
  let hIndex = 0;
  for (let i = 0; i < sortedCitations.length; i++) {
    if (sortedCitations[i] >= i + 1) {
      hIndex = i + 1;
    } else {
      break;
    }
  }
  
  return hIndex;
}

/**
 * Check if two titles are similar enough to be considered the same paper
 * Uses Dice coefficient via string-similarity library for robust matching
 *
 * @param {string} title1 - First title to compare
 * @param {string} title2 - Second title to compare
 * @param {number} threshold - Similarity threshold (default 0.8)
 * @returns {boolean} - True if titles are similar enough
 */
function isSimilarTitle(title1, title2, threshold = 0.8) {
  // Clean and normalize titles
  const t1 = title1.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const t2 = title2.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

  // Handle edge cases
  if (!t1 || !t2) return false;
  if (t1 === t2) return true;

  // Check if one is a substring of the other (common with subtitles)
  if (t1.includes(t2) || t2.includes(t1)) {
    return true;
  }

  // Use Dice coefficient for string similarity (more robust than Levenshtein for titles)
  const similarity = stringSimilarity.compareTwoStrings(t1, t2);

  // Use higher threshold for short titles to avoid false positives
  const minLength = Math.min(t1.length, t2.length);
  const adjustedThreshold = minLength < 30 ? 0.85 : threshold;

  return similarity >= adjustedThreshold;
}

module.exports = {
  collect,
  // Export utilities for testing
  _testing: {
    isSimilarTitle,
    calculateHIndex,
    loadDataFile,
    processPublicationSource,
    updatePublicationFromSource,
    createNewPublication,
    SOURCE_MAPPINGS
  }
};
/**
 * Publications Aggregator
 * 
 * Aggregates publication data from multiple sources (ORCID, Google Scholar, 
 * Web of Science, Scopus, Semantic Scholar) and combines it into a unified format with 
 * comprehensive citation metrics.
 */

const orcidCollector = require('./orcid');
const scholarCollector = require('./scholar');
const wosCollector = require('./wos');
const scopusCollector = require('./scopus');
const crossrefCollector = require('./crossref');
const semanticScholarCollector = require('./semantic-scholar');

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

async function collect() {
  console.log('Aggregating publication data from multiple sources...');
  
  try {
    const dataDir = path.join(__dirname, '../../public/data');
    
    // Load existing data files instead of re-collecting
    console.log('Loading existing data files...');
    const [orcidData, scholarData, wosData, scopusData, semanticScholarData] = await Promise.all([
      loadDataFile(path.join(dataDir, 'orcid.json')),
      loadDataFile(path.join(dataDir, 'scholar.json')),
      loadDataFile(path.join(dataDir, 'wos.json')),
      loadDataFile(path.join(dataDir, 'scopus.json')),
      loadDataFile(path.join(dataDir, 'semantic-scholar.json'))
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
        
        publicationsMap.set(key, {
          title: work.title.title.value,
          type: work.type,
          venue: journalTitle,
          authors: authors,
          year: work['publication-date'] ? parseInt(work['publication-date'].year.value) : null,
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
            semanticScholar: null
          },
          source_ids: {
            orcid: work['put-code'],
            scholar: null,
            wos: null,
            scopus: null,
            semanticScholar: null
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
            publication.source_urls.scholar = `https://scholar.google.com/citations?user=FmenbcUAAAAJ&citation_for_view=FmenbcUAAAAJ:${pub.id}`;
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
              scholar: `https://scholar.google.com/citations?user=FmenbcUAAAAJ&citation_for_view=FmenbcUAAAAJ:${pub.id}`,
              wos: null,
              scopus: null,
              semanticScholar: null
            },
            source_ids: {
              orcid: null,
              scholar: pub.id,
              wos: null,
              scopus: null,
              semanticScholar: null
            },
            metrics: {}
          });
        }
      });
    }
    
    // Process Web of Science publications
    if (wosData && wosData.publications) {
      console.log(`Processing ${wosData.publications.length} publications from Web of Science`);
      
      wosData.publications.forEach(pub => {
        // Try to match by DOI first
        let matched = false;
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            publication.citations.wos = pub.citations || 0;
            publication.source_urls.wos = pub.url;
            publication.source_ids.wos = pub.wosId;
            
            // Update authors if available from WoS and current is null
            if (!publication.authors && pub.authors) {
              publication.authors = pub.authors;
            }
            
            console.log(`Matched WoS publication by DOI: "${pub.title}" with ${pub.citations || 0} citations`);
            matched = true;
          }
        }
        
        // If no DOI match, try by title
        if (!matched) {
          const wosTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');
          
          for (const [key, publication] of publicationsMap.entries()) {
            const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');
            
            if (isSimilarTitle(pubTitle, wosTitle)) {
              publication.citations.wos = pub.citations || 0;
              publication.source_urls.wos = pub.url;
              publication.source_ids.wos = pub.wosId;
              
              // Add DOI if missing
              if (!publication.doi && pub.doi) {
                publication.doi = pub.doi;
              }
              
              // Update authors if available from WoS and current is null
              if (!publication.authors && pub.authors) {
                publication.authors = pub.authors;
              }
              
              console.log(`Matched WoS publication by title: "${pub.title}" with ${pub.citations || 0} citations`);
              matched = true;
              break;
            }
          }
        }
        
        // If still no match, add as new entry
        if (!matched) {
          const key = pub.doi ? 
            `doi:${pub.doi.toLowerCase()}` : 
            `title:${pub.title.toLowerCase().replace(/[^\w\s]/g, '')}`;
            
          publicationsMap.set(key, {
            title: pub.title,
            authors: pub.authors,
            venue: pub.venue,
            year: pub.year ? parseInt(pub.year) : null,
            doi: pub.doi,
            citations: {
              scholar: null,
              wos: pub.citations,
              scopus: null,
              semanticScholar: null
            },
            source_urls: {
              orcid: null,
              scholar: null,
              wos: pub.url,
              scopus: null,
              semanticScholar: null
            },
            source_ids: {
              orcid: null,
              scholar: null,
              wos: pub.wosId,
              scopus: null,
              semanticScholar: null
            },
            metrics: {}
          });
        }
      });
    }
    
    // Process Scopus publications
    if (scopusData && scopusData.publications) {
      console.log(`Processing ${scopusData.publications.length} publications from Scopus`);
      
      scopusData.publications.forEach(pub => {
        // Try to match by DOI first
        let matched = false;
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            publication.citations.scopus = pub.citations || 0;
            publication.source_urls.scopus = pub.url;
            publication.source_ids.scopus = pub.scopusId;
            
            // Update authors if available from Scopus and current is null
            if (!publication.authors && pub.authors) {
              publication.authors = pub.authors;
            }
            console.log(`Matched Scopus publication by DOI: "${pub.title}" with ${pub.citations || 0} citations`);
            matched = true;
          }
        }
        
        // If no DOI match, try by title
        if (!matched) {
          const scopusTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');
          
          for (const [key, publication] of publicationsMap.entries()) {
            const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');
            
            if (isSimilarTitle(pubTitle, scopusTitle)) {
              publication.citations.scopus = pub.citations || 0;
              publication.source_urls.scopus = pub.url;
              publication.source_ids.scopus = pub.scopusId;
              
              // Add DOI if missing
              if (!publication.doi && pub.doi) {
                publication.doi = pub.doi;
              }
              
              // Update authors if available from Scopus and current is null
              if (!publication.authors && pub.authors) {
                publication.authors = pub.authors;
              }
              
              console.log(`Matched Scopus publication by title: "${pub.title}" with ${pub.citations || 0} citations`);
              matched = true;
              break;
            }
          }
        }
        
        // If still no match, add as new entry
        if (!matched) {
          const key = pub.doi ? 
            `doi:${pub.doi.toLowerCase()}` : 
            `title:${pub.title.toLowerCase().replace(/[^\w\s]/g, '')}`;
            
          publicationsMap.set(key, {
            title: pub.title,
            authors: pub.authors,
            venue: pub.venue,
            year: pub.year ? parseInt(pub.year) : null,
            doi: pub.doi,
            citations: {
              scholar: null,
              wos: null,
              scopus: pub.citations,
              semanticScholar: null
            },
            source_urls: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: pub.url,
              semanticScholar: null
            },
            source_ids: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: pub.scopusId,
              semanticScholar: null
            },
            metrics: {}
          });
        }
      });
    }
    
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
    
    // Process Semantic Scholar publications
    if (semanticScholarData && semanticScholarData.publications) {
      console.log(`Processing ${semanticScholarData.publications.length} publications from Semantic Scholar`);
      
      semanticScholarData.publications.forEach(pub => {
        // Try to match by DOI first
        let matched = false;
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            publication.citations.semanticScholar = pub.citations || 0;
            publication.source_urls.semanticScholar = `https://www.semanticscholar.org/paper/${pub.semanticScholarId}`;
            publication.source_ids.semanticScholar = pub.semanticScholarId;
            
            // Add additional Semantic Scholar specific data
            publication.influentialCitations = pub.influentialCitations;
            publication.isOpenAccess = pub.isOpenAccess;
            publication.openAccessPdf = pub.openAccessPdf;
            publication.fieldsOfStudy = pub.fieldsOfStudy;
            
            // Update authors if available from Semantic Scholar and current is null
            if (!publication.authors && pub.authors) {
              publication.authors = pub.authors;
            }
            
            console.log(`Matched Semantic Scholar publication by DOI: "${pub.title}" with ${pub.citations || 0} citations`);
            matched = true;
          }
        }
        
        // If no DOI match, try by title
        if (!matched) {
          const s2Title = pub.title.toLowerCase().replace(/[^\w\s]/g, '');
          
          for (const [key, publication] of publicationsMap.entries()) {
            const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');
            
            if (isSimilarTitle(pubTitle, s2Title)) {
              publication.citations.semanticScholar = pub.citations || 0;
              publication.source_urls.semanticScholar = `https://www.semanticscholar.org/paper/${pub.semanticScholarId}`;
              publication.source_ids.semanticScholar = pub.semanticScholarId;
              
              // Add additional Semantic Scholar specific data
              publication.influentialCitations = pub.influentialCitations;
              publication.isOpenAccess = pub.isOpenAccess;
              publication.openAccessPdf = pub.openAccessPdf;
              publication.fieldsOfStudy = pub.fieldsOfStudy;
              
              // Add DOI if missing
              if (!publication.doi && pub.doi) {
                publication.doi = pub.doi;
              }
              
              // Update authors if available from Semantic Scholar and current is null
              if (!publication.authors && pub.authors) {
                publication.authors = pub.authors;
              }
              
              console.log(`Matched Semantic Scholar publication by title: "${pub.title}" with ${pub.citations || 0} citations`);
              matched = true;
              break;
            }
          }
        }
        
        // If still no match, add as new entry
        if (!matched) {
          const key = pub.doi ? 
            `doi:${pub.doi.toLowerCase()}` : 
            `title:${pub.title.toLowerCase().replace(/[^\w\s]/g, '')}`;
            
          publicationsMap.set(key, {
            title: pub.title,
            authors: pub.authors,
            venue: pub.venue,
            year: pub.year || null,
            doi: pub.doi,
            citations: {
              scholar: null,
              wos: null,
              scopus: null,
              semanticScholar: pub.citations
            },
            source_urls: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: null,
              semanticScholar: `https://www.semanticscholar.org/paper/${pub.semanticScholarId}`
            },
            source_ids: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: null,
              semanticScholar: pub.semanticScholarId
            },
            influentialCitations: pub.influentialCitations,
            isOpenAccess: pub.isOpenAccess,
            openAccessPdf: pub.openAccessPdf,
            fieldsOfStudy: pub.fieldsOfStudy,
            metrics: {}
          });
        }
      });
    }
    
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
        with_crossref: publications.filter(pub => pub.source_urls && pub.source_urls.crossref).length
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
 */
function isSimilarTitle(title1, title2) {
  // Simple check: see if one title contains most of the other
  // A more robust implementation would use string similarity algorithms
  
  // Clean and normalize titles
  const t1 = title1.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const t2 = title2.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  
  // Calculate overlap threshold based on title length (higher for short titles)
  const minLength = Math.min(t1.length, t2.length);
  const maxLength = Math.max(t1.length, t2.length);
  const ratioThreshold = minLength < 30 ? 0.9 : 0.75;
  
  // Calculate similarity ratio
  if (maxLength === 0) return false;
  if (t1 === t2) return true;
  
  // Check if one is a substring of the other
  if (t1.includes(t2) || t2.includes(t1)) {
    return true;
  }
  
  // Check if significant words match
  const words1 = t1.split(' ').filter(w => w.length > 3);
  const words2 = t2.split(' ').filter(w => w.length > 3);
  
  // If either has no significant words, we can't compare
  if (words1.length === 0 || words2.length === 0) {
    return false;
  }
  
  // Count matching words
  const matchingWords = words1.filter(w => words2.includes(w));
  const matchRatio = matchingWords.length / Math.min(words1.length, words2.length);
  
  return matchRatio >= ratioThreshold;
}

module.exports = { collect };
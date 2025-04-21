/**
 * Publications Aggregator
 * 
 * Aggregates publication data from multiple sources (ORCID, Google Scholar, 
 * Web of Science, Scopus) and combines it into a unified format with 
 * comprehensive citation metrics.
 */

const orcidCollector = require('./orcid');
const scholarCollector = require('./scholar');
const wosCollector = require('./wos');
const scopusCollector = require('./scopus');

async function collect() {
  console.log('Aggregating publication data from multiple sources...');
  
  try {
    // Collect data from all sources in parallel
    const [orcidData, scholarData, wosData, scopusData] = await Promise.all([
      orcidCollector.collect().catch(err => {
        console.error('ORCID collection error:', err);
        return null;
      }),
      scholarCollector.collect().catch(err => {
        console.error('Scholar collection error:', err);
        return null;
      }),
      wosCollector.collect().catch(err => {
        console.error('Web of Science collection error:', err);
        return null;
      }),
      scopusCollector.collect().catch(err => {
        console.error('Scopus collection error:', err);
        return null;
      })
    ]);
    
    // Extract work summaries from ORCID data - this is our base list
    let publicationsMap = new Map();
    
    // Process ORCID works first (as the canonical source)
    if (orcidData && orcidData.works) {
      orcidData.works.forEach(workGroup => {
        const work = workGroup['work-summary'][0];
        
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
        
        publicationsMap.set(key, {
          title: work.title.title.value,
          type: work.type,
          year: work['publication-date'] ? parseInt(work['publication-date'].year.value) : null,
          doi: doi,
          citations: {
            scholar: null,
            wos: null,
            scopus: null
          },
          source_urls: {
            orcid: work.url ? work.url.value : null,
            scholar: null,
            wos: null,
            scopus: null
          },
          source_ids: {
            orcid: work['put-code'],
            scholar: null,
            wos: null,
            scopus: null
          },
          metrics: {}
        });
      });
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
              scopus: null
            },
            source_urls: {
              orcid: null,
              scholar: `https://scholar.google.com/citations?user=FmenbcUAAAAJ&citation_for_view=FmenbcUAAAAJ:${pub.id}`,
              wos: null,
              scopus: null
            },
            source_ids: {
              orcid: null,
              scholar: pub.id,
              wos: null,
              scopus: null
            },
            metrics: {}
          });
        }
      });
    }
    
    // Process Web of Science publications
    if (wosData && wosData.publications) {
      wosData.publications.forEach(pub => {
        // Try to match by DOI first
        let matched = false;
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            publication.citations.wos = pub.citations;
            publication.source_urls.wos = pub.url;
            publication.source_ids.wos = pub.wosId;
            matched = true;
          }
        }
        
        // If no DOI match, try by title
        if (!matched) {
          const wosTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');
          
          for (const [key, publication] of publicationsMap.entries()) {
            const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');
            
            if (isSimilarTitle(pubTitle, wosTitle)) {
              publication.citations.wos = pub.citations;
              publication.source_urls.wos = pub.url;
              publication.source_ids.wos = pub.wosId;
              
              // Add DOI if missing
              if (!publication.doi && pub.doi) {
                publication.doi = pub.doi;
              }
              
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
              scopus: null
            },
            source_urls: {
              orcid: null,
              scholar: null,
              wos: pub.url,
              scopus: null
            },
            source_ids: {
              orcid: null,
              scholar: null,
              wos: pub.wosId,
              scopus: null
            },
            metrics: {}
          });
        }
      });
    }
    
    // Process Scopus publications
    if (scopusData && scopusData.publications) {
      scopusData.publications.forEach(pub => {
        // Try to match by DOI first
        let matched = false;
        if (pub.doi) {
          const doiKey = `doi:${pub.doi.toLowerCase()}`;
          if (publicationsMap.has(doiKey)) {
            const publication = publicationsMap.get(doiKey);
            publication.citations.scopus = pub.citations;
            publication.source_urls.scopus = pub.url;
            publication.source_ids.scopus = pub.scopusId;
            matched = true;
          }
        }
        
        // If no DOI match, try by title
        if (!matched) {
          const scopusTitle = pub.title.toLowerCase().replace(/[^\w\s]/g, '');
          
          for (const [key, publication] of publicationsMap.entries()) {
            const pubTitle = publication.title.toLowerCase().replace(/[^\w\s]/g, '');
            
            if (isSimilarTitle(pubTitle, scopusTitle)) {
              publication.citations.scopus = pub.citations;
              publication.source_urls.scopus = pub.url;
              publication.source_ids.scopus = pub.scopusId;
              
              // Add DOI if missing
              if (!publication.doi && pub.doi) {
                publication.doi = pub.doi;
              }
              
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
              scopus: pub.citations
            },
            source_urls: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: pub.url
            },
            source_ids: {
              orcid: null,
              scholar: null,
              wos: null,
              scopus: pub.scopusId
            },
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
        pub.citations.scopus
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
        with_scopus: publications.filter(pub => pub.citations.scopus !== null).length
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
/**
 * ORCID data collector
 * 
 * Fetches publication and profile data from ORCID API
 * Includes pagination to get all works
 */

const axios = require('axios');

async function collect() {
  console.log('Collecting ORCID data...');
  
  // ORCID ID for Fabio Giglietto
  const orcidId = '0000-0001-8019-1035';
  
  try {
    // Get profile information
    const profileResponse = await axios.get(`https://pub.orcid.org/v3.0/${orcidId}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const profile = profileResponse.data.person;
    
    // Fetch works with pagination to get all publications
    const allWorks = await fetchAllWorks(orcidId);
    
    console.log(`Collected ${allWorks.length} works from ORCID`);
    
    // Process and return the data
    return {
      profile: profile,
      works: allWorks,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching ORCID data:', error.message);
    throw error;
  }
}

/**
 * Fetches all works from ORCID with pagination
 * @param {string} orcidId The ORCID identifier
 * @returns {Array} All work groups
 */
async function fetchAllWorks(orcidId) {
  const allWorks = [];
  const pageSize = 100; // ORCID API allows up to 1000, but 100 is more reliable
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    try {
      console.log(`Fetching ORCID works page: offset=${offset}, limit=${pageSize}`);
      
      const response = await axios.get(
        `https://pub.orcid.org/v3.0/${orcidId}/works`, {
          headers: { 'Accept': 'application/json' },
          params: { offset: offset, limit: pageSize }
        }
      );
      
      const worksPage = response.data.group || [];
      allWorks.push(...worksPage);
      
      // Check if we need to fetch more pages
      if (worksPage.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
      
      console.log(`Retrieved ${worksPage.length} works in this page`);
    } catch (error) {
      console.error(`Error fetching ORCID works at offset ${offset}:`, error.message);
      hasMore = false; // Stop on error
    }
  }
  
  return allWorks;
}

module.exports = { collect };
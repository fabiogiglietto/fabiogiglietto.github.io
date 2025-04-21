/**
 * ORCID data collector
 * 
 * Fetches publication and profile data from ORCID API
 */

const axios = require('axios');

async function collect() {
  console.log('Collecting ORCID data...');
  
  // ORCID ID for Fabio Giglietto
  const orcidId = '0000-0001-8019-1035';
  
  try {
    const response = await axios.get(`https://pub.orcid.org/v3.0/${orcidId}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Process and return the data
    return {
      profile: response.data.person,
      works: response.data.activities?.['works']?.group || [],
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching ORCID data:', error.message);
    throw error;
  }
}

module.exports = { collect };
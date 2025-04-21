/**
 * ORCID data collector
 * 
 * Fetches publication and profile data from ORCID API
 */

const axios = require('axios');

async function collect() {
  console.log('Collecting ORCID data...');
  
  // Example ORCID ID - replace with actual ID
  const orcidId = '0000-0000-0000-0000';
  
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
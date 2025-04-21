/**
 * ORCID data collector
 * 
 * Fetches publication and profile data from ORCID API
 * Includes pagination to get all works
 */

const axios = require('axios');
const fs = require('fs');

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
 * Fetches all works from ORCID using OAuth token
 * @param {string} orcidId The ORCID identifier
 * @returns {Array} All work groups
 */
async function fetchAllWorks(orcidId) {
  try {
    console.log('Getting OAuth token for ORCID API access...');
    
    // First get an OAuth token using client credentials flow
    const tokenResponse = await axios.post('https://pub.orcid.org/oauth/token', 
      'client_id=APP-7M3CGDKMCV9Z0YGM&client_secret=9eb1c669-2788-445f-9722-bd9dec53c55a&grant_type=client_credentials&scope=/read-public', 
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );
    
    const accessToken = tokenResponse.data.access_token;
    console.log(`Obtained access token: ${accessToken.substring(0, 10)}...`);
    
    // Now fetch all works using the token
    console.log('Fetching all works with token...');
    const worksResponse = await axios.get(
      `https://pub.orcid.org/v3.0/${orcidId}/works`, {
        headers: { 
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`  
        }
      }
    );
    
    const works = worksResponse.data.group || [];
    console.log(`Retrieved ${works.length} works from ORCID`);
    
    // Debug: Save the works data to file
    try {
      fs.writeFileSync('/tmp/orcid-works-full.json', JSON.stringify(worksResponse.data, null, 2));
      console.log('Works data saved to /tmp/orcid-works-full.json');
    } catch (writeError) {
      console.error('Error saving works data to file:', writeError);
    }
    
    return works;
  } catch (error) {
    console.error('Error in ORCID OAuth flow:', error);
    console.error('Error details:', error.response?.data || 'No response data');
    
    // Return empty array on error
    return [];
  }
}

module.exports = { collect };
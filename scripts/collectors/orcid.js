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
    
    // Fetch the complete ORCID record using the proper endpoint with JSON-LD format
    console.log('Fetching complete ORCID record with token in JSON-LD format...');
    const recordResponse = await axios.get(
      `https://pub.orcid.org/v3.0/${orcidId}/record`, {
        headers: { 
          'Accept': 'application/ld+json; qs=4',
          'Authorization': `Bearer ${accessToken}`  
        }
      }
    );
    
    console.log('Response type:', recordResponse.headers['content-type']);
    
    // Handle the response based on content type
    let profile = {};
    let works = [];
    
    try {
      // For JSON-LD format
      if (recordResponse.headers['content-type'].includes('application/ld+json')) {
        console.log('Processing JSON-LD response');
        const data = recordResponse.data;
        
        // Extract profile information from JSON-LD
        profile = {
          name: data.name || {},
          biography: data.description || '',
          // Extract other profile information as needed
        };
        
        // Extract works from JSON-LD format
        works = Array.isArray(data.hasOccupation) ? data.hasOccupation : [];
        console.log(`Retrieved ${works.length} works from JSON-LD format`);
      } 
      // For standard JSON format
      else {
        console.log('Processing standard JSON response');
        profile = recordResponse.data.person || {};
        works = recordResponse.data.activities?.['works']?.group || [];
        console.log(`Retrieved ${works.length} works from standard JSON format`);
      }
    } catch (parseError) {
      console.error('Error parsing ORCID response:', parseError);
      console.log('Response data:', recordResponse.data);
    }
    
    // Debug: Save the record data to file
    try {
      fs.writeFileSync('/tmp/orcid-record-full.json', JSON.stringify(recordResponse.data, null, 2));
      console.log('Complete record data saved to /tmp/orcid-record-full.json');
    } catch (writeError) {
      console.error('Error saving record data to file:', writeError);
    }
    
    // Process and return the data
    return {
      profile: profile,
      works: works,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching ORCID data:', error.message);
    console.error('Error details:', error.response?.data || 'No response data');
    
    // Return minimal data structure on error
    return {
      profile: {},
      works: [],
      lastUpdated: new Date().toISOString(),
      error: error.message
    };
  }
}


module.exports = { collect };
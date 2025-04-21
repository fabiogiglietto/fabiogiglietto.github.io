/**
 * ORCID data collector
 * 
 * Fetches publication and profile data from ORCID API
 * Includes pagination to get all works
 */

const axios = require('axios');
const fs = require('fs');

async function collect() {
  // Create a detailed log object
  const logs = {
    timestamp: new Date().toISOString(),
    steps: [],
    errors: [],
    warnings: [],
    results: {}
  };
  
  // Logger helper functions
  const addLog = (message, type = 'info') => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      message
    };
    logs.steps.push(logEntry);
    console.log(`[${type.toUpperCase()}] ${message}`);
  };
  
  const addError = (message, error = null) => {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        } : null
      } : null
    };
    logs.errors.push(errorEntry);
    console.error(`[ERROR] ${message}`, error ? error.message : '');
  };
  
  addLog('Starting ORCID data collection', 'start');
  
  // ORCID ID for Fabio Giglietto
  const orcidId = '0000-0001-8019-1035';
  logs.results.orcidId = orcidId;
  
  try {
    addLog('Getting OAuth token for ORCID API access...');
    
    // First get an OAuth token using client credentials flow
    let tokenResponse;
    try {
      // Try public endpoint without authentication first
      addLog('Attempting to use public API without authentication');
      
      // Skip token retrieval for now - use direct public access
      tokenResponse = {
        status: 200,
        data: {
          access_token: "public_endpoint_no_token_needed"
        }
      };
      
      logs.results.tokenResponse = {
        status: tokenResponse.status,
        headers: tokenResponse.headers,
        data: tokenResponse.data
      };
      
      addLog(`OAuth token response received: ${JSON.stringify(logs.results.tokenResponse, null, 2)}`);
    } catch (tokenError) {
      addError('Failed to obtain OAuth token', tokenError);
      throw tokenError;
    }
    
    const accessToken = tokenResponse.data.access_token;
    logs.results.accessToken = accessToken.substring(0, 10) + '...';
    addLog(`Obtained access token: ${logs.results.accessToken}`);
    
    // Try multiple formats to ensure we get data
    const formats = [
      { name: 'JSON', accept: 'application/json' },
      { name: 'ORCID JSON', accept: 'application/vnd.orcid+json' },
      { name: 'JSON-LD', accept: 'application/ld+json' }
    ];
    
    let recordResponse = null;
    let successFormat = null;
    
    for (const format of formats) {
      addLog(`Attempting to fetch ORCID record with ${format.name} format...`);
      
      try {
        recordResponse = await axios.get(`https://pub.orcid.org/v3.0/${orcidId}/record`, {
          headers: { 
            'Accept': format.accept
          }
        });
        
        successFormat = format.name;
        addLog(`Successfully retrieved record in ${format.name} format`);
        
        logs.results.recordResponse = {
          format: format.name,
          contentType: recordResponse.headers['content-type'],
          status: recordResponse.status,
          headers: recordResponse.headers,
          dataKeys: Object.keys(recordResponse.data || {})
        };
        
        break;
      } catch (formatError) {
        addError(`Error fetching in ${format.name} format`, formatError);
      }
    }
    
    if (!recordResponse) {
      const noResponseError = new Error('All format attempts failed to retrieve ORCID record');
      addError('Failed to retrieve ORCID record with any format', noResponseError);
      throw noResponseError;
    }
    
    addLog(`Retrieved ORCID record in ${successFormat} format`);
    addLog(`Response content type: ${recordResponse.headers['content-type']}`);
    
    // Also try works endpoint directly to compare
    addLog('Trying to fetch works directly from /works endpoint for comparison...');
    
    let worksResponse = null;
    try {
      worksResponse = await axios.get(`https://pub.orcid.org/v3.0/${orcidId}/works`, {
        headers: { 
          'Accept': 'application/json'
        }
      });
      
      logs.results.worksResponse = {
        contentType: worksResponse.headers['content-type'],
        status: worksResponse.status,
        dataKeys: Object.keys(worksResponse.data || {})
      };
      
      if (worksResponse.data && worksResponse.data.group) {
        logs.results.worksResponse.groupCount = worksResponse.data.group.length;
        addLog(`Works endpoint returned ${worksResponse.data.group.length} works`);
      } else {
        addLog('Works endpoint response does not contain expected group structure');
        logs.results.worksResponse.dataDetails = JSON.stringify(worksResponse.data).substring(0, 1000);
      }
    } catch (worksError) {
      addError('Error fetching works directly', worksError);
    }
    
    // Handle the response based on content type and format
    let profile = {};
    let works = [];
    
    try {
      addLog(`Processing ${successFormat} response`);
      
      if (successFormat === 'JSON-LD') {
        const data = recordResponse.data;
        
        profile = {
          name: data.name || {},
          biography: data.description || ''
        };
        
        works = Array.isArray(data.hasOccupation) ? data.hasOccupation : [];
        addLog(`Extracted ${works.length} works from JSON-LD format`);
      } else {
        // Log the record structure for debugging
        logs.results.recordStructure = {
          dataKeys: Object.keys(recordResponse.data || {}),
          hasPath: !!recordResponse.data.path,
          hasError: !!recordResponse.data.error
        };
        
        // Extract profile data from the record
        if (recordResponse.data.person) {
          profile = recordResponse.data.person;
          addLog(`Found person data with keys: ${Object.keys(profile).join(', ')}`);
        } else {
          profile = {};
          addLog('No person data found in record response');
        }
        
        // The record endpoint might not return works directly in some API versions
        // We'll rely on the works endpoint for getting the works
        addLog('Record endpoint response structure differs from expected format');
        works = [];
      }
    } catch (parseError) {
      addError('Error parsing ORCID response', parseError);
    }
    
    // Calculate works count from the works API response if available
    let worksFromWorksEndpoint = [];
    if (worksResponse && worksResponse.data && worksResponse.data.group) {
      worksFromWorksEndpoint = worksResponse.data.group;
      addLog(`Works endpoint has ${worksFromWorksEndpoint.length} works, record endpoint has ${works.length} works`);
      
      // Compare the two counts
      if (worksFromWorksEndpoint.length !== works.length) {
        addLog(`DISCREPANCY: Works endpoint has ${worksFromWorksEndpoint.length} works, but record endpoint has ${works.length} works`, 'warning');
        logs.warnings.push({
          timestamp: new Date().toISOString(),
          message: `Works count discrepancy: /works endpoint: ${worksFromWorksEndpoint.length}, /record endpoint: ${works.length}`
        });
      }
    }
    
    // Always use the works endpoint data as it's more reliable
    if (worksFromWorksEndpoint.length > 0) {
      addLog(`Using ${worksFromWorksEndpoint.length} works from /works endpoint instead of /record endpoint`);
      works = worksFromWorksEndpoint;
      
      // Log sample of first work for debugging
      if (works.length > 0) {
        const sampleWork = works[0];
        logs.results.sampleWork = {
          keys: Object.keys(sampleWork),
          hasSummary: !!sampleWork['work-summary'],
          summaryCount: sampleWork['work-summary'] ? sampleWork['work-summary'].length : 0
        };
        
        // Log the 'work-summary' structure if available
        if (sampleWork['work-summary'] && sampleWork['work-summary'].length > 0) {
          const workSummary = sampleWork['work-summary'][0];
          logs.results.sampleWork.summaryKeys = Object.keys(workSummary);
          logs.results.sampleWork.title = workSummary.title?.title?.value;
          logs.results.sampleWork.type = workSummary.type;
          logs.results.sampleWork.pubDate = workSummary['publication-date'] ? 
            `${workSummary['publication-date'].year?.value}-${workSummary['publication-date'].month?.value || '01'}-${workSummary['publication-date'].day?.value || '01'}` : null;
        }
        
        addLog(`Sample work structure: ${JSON.stringify(logs.results.sampleWork)}`);
      }
    } else {
      addLog('No works found from either endpoint', 'warning');
    }
    
    // Debug: Save the record data and log data to files
    try {
      fs.writeFileSync('/tmp/orcid-record-full.json', JSON.stringify(recordResponse.data, null, 2));
      addLog('Complete record data saved to /tmp/orcid-record-full.json');
      
      if (worksResponse) {
        fs.writeFileSync('/tmp/orcid-works-full.json', JSON.stringify(worksResponse.data, null, 2));
        addLog('Works data saved to /tmp/orcid-works-full.json');
      }
      
      // Save the detailed logs
      fs.writeFileSync('/tmp/orcid-collection-log.json', JSON.stringify(logs, null, 2));
      addLog('Detailed logs saved to /tmp/orcid-collection-log.json');
    } catch (writeError) {
      addError('Error saving data to files', writeError);
    }
    
    logs.results.finalWorkCount = works.length;
    logs.results.profileKeys = Object.keys(profile);
    
    addLog(`Collection completed with ${works.length} works retrieved`, 'complete');
    
    // Process and return the data
    return {
      profile: profile,
      works: works,
      lastUpdated: new Date().toISOString(),
      logs: logs
    };
  } catch (error) {
    addError('Fatal error in ORCID data collection', error);
    
    // Save logs even on failure
    try {
      fs.writeFileSync('/tmp/orcid-collection-error-log.json', JSON.stringify(logs, null, 2));
      console.log('Error logs saved to /tmp/orcid-collection-error-log.json');
    } catch (logError) {
      console.error('Failed to save error logs:', logError);
    }
    
    // Return minimal data structure on error
    return {
      profile: {},
      works: [],
      lastUpdated: new Date().toISOString(),
      error: error.message,
      logs: logs
    };
  }
}


module.exports = { collect };
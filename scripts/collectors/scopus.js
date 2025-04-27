/**
 * Scopus API data collector
 * 
 * Fetches publication data and citation metrics from Scopus API
 */

const axios = require('axios');

/**
 * Makes an API request with retries
 * @param {Function} requestFn - The function that makes the request
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Delay between retries in ms
 * @returns {Promise} - The response from the API
 */
async function withRetry(requestFn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      // Don't retry on 401 (authentication errors)
      if (error.response && error.response.status === 401) {
        throw error;
      }
      console.log(`Attempt ${attempt} failed. ${attempt < maxRetries ? `Retrying in ${delay/1000}s...` : 'No more retries.'}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        // Exponential backoff
        delay *= 2;
      }
    }
  }
  
  throw lastError;
}

async function collect() {
  console.log('Collecting Scopus data...');
  
  // Get API key from environment variable
  const apiKey = process.env.SCOPUS_API_KEY;
  
  // Author ID for Fabio Giglietto in Scopus
  const authorId = '55570380700';
  
  // Check if this is running on GitHub Actions
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  
  if (!apiKey) {
    // Only show warning in GitHub Actions environment
    if (isGitHubActions) {
      console.warn('Scopus API key not found. Add SCOPUS_API_KEY to repository secrets for live data.');
    } else {
      console.warn('Scopus API key not found in .env file. Using mock data.');
    }
    return getMockData();
  }
  
  // Log a message about using the API key
  console.log(`Using Scopus API key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log(`Fetching publications for author ID: ${authorId}`);
  
  try {
    // Try multiple authentication methods to improve chances of success
    console.log('Attempting Scopus API call with multiple authentication methods...');
    
    const baseUrl = 'https://api.elsevier.com/content/search/scopus';
    const queryParams = {
      query: `AU-ID(${authorId})`,
      view: 'COMPLETE',
      sort: 'citedby-count desc',
      count: 100  // Retrieve up to 100 publications
    };
    
    // Method 1: API key in header + API key in params (recommended by Scopus for some implementations)
    console.log('Trying authentication method 1: API key in header + params...');
    let response;
    
    try {
      response = await withRetry(async () => {
        // Include API key in both URL params and headers (this sometimes works better)
        const params = new URLSearchParams({
          ...queryParams,
          apiKey: apiKey
        }).toString();
        
        return await axios.get(`${baseUrl}?${params}`, {
          headers: {
            'Accept': 'application/json',
            'X-ELS-APIKey': apiKey,
            'X-ELS-Insttoken': process.env.SCOPUS_INSTTOKEN || '',
            'User-Agent': 'FabioGigliettoAcademicWebsite/1.0'
          }
        });
      });
    } catch (error) {
      // If first method fails, try the second method
      console.log('First authentication method failed, trying alternative method...');
      
      if (error.response) {
        console.log(`First method failed with status code: ${error.response.status}`);
        // Log only brief error data for security
        console.log(`Error type: ${error.response.data?.['service-error']?.status?.statusCode || 'Unknown'}`);
      } else if (error.request) {
        console.log('Network error in first method attempt');
      } else {
        console.log(`Error in first method: ${error.message}`);
      }
      
      // Method 2: Only use header authentication without apiKey in URL
      const params = new URLSearchParams(queryParams).toString();
      
      try {
        response = await withRetry(async () => {
          return await axios.get(`${baseUrl}?${params}`, {
            headers: {
              'Accept': 'application/json',
              'X-ELS-APIKey': apiKey,
              'X-ELS-Insttoken': process.env.SCOPUS_INSTTOKEN || '',
              'User-Agent': 'FabioGigliettoAcademicWebsite/1.0'
            }
          });
        });
      } catch (secondError) {
        console.log('Both authentication methods failed');
        
        // Try one last approach - direct author lookup API
        console.log('Trying alternative Scopus API endpoint...');
        const authorApiUrl = `https://api.elsevier.com/content/author/author_id/${authorId}`;
        const authorParams = new URLSearchParams({
          view: 'ENHANCED'
        }).toString();
        
        try {
          const authorResponse = await axios.get(`${authorApiUrl}?${authorParams}`, {
            headers: {
              'Accept': 'application/json',
              'X-ELS-APIKey': apiKey
            }
          });
          
          console.log('Author lookup successful, but publications API failed');
          console.log(`Author h-index from profile: ${authorResponse.data?.['author-retrieval-response']?.[0]?.['h-index'] || 'Not available'}`);
          
          // Still throw the original error to trigger fallback
          throw secondError;
        } catch (finalError) {
          // All methods failed, throw the original error
          throw error;
        }
      }
    }
    
    console.log(`Retrieved ${response.data['search-results']?.entry?.length || 0} publications from Scopus`);
    
    // Process the API response
    if (response.data['search-results'] && 
        response.data['search-results'].entry && 
        Array.isArray(response.data['search-results'].entry)) {
        
      const entries = response.data['search-results'].entry;
      console.log('Sample entry data:', JSON.stringify(entries[0], null, 2).substring(0, 500) + '...');
        
      const publications = entries.map(entry => {
        // Extract author list in better format if available
        let authorText = '';
        if (entry['author'] && Array.isArray(entry['author'])) {
          authorText = entry['author'].map(author => 
            `${author['surname'] || ''}, ${author['given-name'] || ''}`.trim()
          ).join('; ');
        } else {
          authorText = entry['dc:creator'] || '';
        }
        
        // Find link to Scopus record
        const scopusLink = entry.link && Array.isArray(entry.link) ? 
          entry.link.find(link => link['@ref'] === 'scopus')?.['@href'] : null;
        
        return {
          title: entry['dc:title'] || "",
          authors: authorText,
          venue: entry['prism:publicationName'] || "",
          year: entry['prism:coverDate'] ? entry['prism:coverDate'].substring(0, 4) : null,
          doi: entry['prism:doi'] || null,
          citations: parseInt(entry['citedby-count'] || "0"),
          scopusId: entry['dc:identifier'] ? entry['dc:identifier'].split(':')[1] : "",
          url: scopusLink
        };
      });
      
      // Validate the parsed publications
      console.log('Found publications by year:');
      const yearCounts = {};
      publications.forEach(pub => {
        if (pub.year) {
          yearCounts[pub.year] = (yearCounts[pub.year] || 0) + 1;
        }
      });
      Object.keys(yearCounts).sort().forEach(year => {
        console.log(`  ${year}: ${yearCounts[year]} publications`);
      });
      
      // Calculate h-index properly
      const calculateHIndex = (publications) => {
        const citationCounts = publications.map(pub => pub.citations || 0).sort((a, b) => b - a);
        let hIndex = 0;
        for (let i = 0; i < citationCounts.length; i++) {
          if (citationCounts[i] >= i + 1) {
            hIndex = i + 1;
          } else {
            break;
          }
        }
        return hIndex;
      };
      
      // Return the structured data
      return {
        publications,
        metrics: {
          hIndex: calculateHIndex(publications),
          documentCount: publications.length,
          citationCount: publications.reduce((sum, pub) => sum + (pub.citations || 0), 0)
        },
        lastUpdated: new Date().toISOString()
      };
    } else {
      console.warn('Scopus API returned unexpected data structure, falling back to mock data');
      return getMockData();
    }
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      console.error(`Scopus API error - Status code: ${status}`);
      
      // Handle specific HTTP status codes
      if (status === 401) {
        console.error('Authentication error: Invalid API key or insufficient access rights');
        console.log('Please make sure:');
        console.log('1. The API key is correctly entered in your .env file or GitHub secrets');
        console.log('2. The API key has permission to access the Scopus Search API');
        console.log('3. Your Scopus subscription includes API access');
      } else if (status === 429) {
        console.error('Rate limit exceeded: Too many requests to the Scopus API');
        console.log('Try again later or reduce the frequency of API calls');
      } else if (status >= 500) {
        console.error('Scopus server error. Try again later.');
      }
      
      // Log response data if available
      if (error.response.data) {
        const errorData = typeof error.response.data === 'object' 
          ? JSON.stringify(error.response.data, null, 2)
          : error.response.data;
        console.error(`Response data: ${errorData}`);
      }
    } else if (error.request) {
      console.error('Network error: No response received from Scopus API');
      console.log('Please check your internet connection');
    } else {
      console.error('Error fetching Scopus data:', error.message);
    }
    
    console.log('Falling back to mock data...');
    // Fall back to mock data on error
    return getMockData();
  }
}

/**
 * Provides mock Scopus data when API key is not available
 */
function getMockData() {
  const mockPublications = [
    {
      title: "Second Screen and Participation: A Content Analysis on a Full Season Dataset of Tweets",
      authors: "Giglietto F., Selva D.",
      venue: "Journal of Communication",
      year: "2014",
      doi: "10.1111/jcom.12085",
      citations: 402,
      scopusId: "84897640661",
      url: "https://www.scopus.com/record/display.uri?eid=2-s2.0-84897640661"
    },
    {
      title: "'Fake news' is the invention of a liar: How false information circulates within the hybrid news system",
      authors: "Giglietto F., Iannelli L., Valeriani A., Rossi L.",
      venue: "Current Sociology",
      year: "2019",
      doi: "10.1177/0011392119837536",
      citations: 163,
      scopusId: "85064248987",
      url: "https://www.scopus.com/record/display.uri?eid=2-s2.0-85064248987"
    },
    {
      title: "The open laboratory: Limits and possibilities of using Facebook, Twitter, and YouTube as a research data source",
      authors: "Giglietto F., Rossi L., Bennato D.",
      venue: "Journal of Technology in Human Services",
      year: "2012",
      doi: "10.1080/15228835.2012.743797",
      citations: 280,
      scopusId: "84871345071",
      url: "https://www.scopus.com/record/display.uri?eid=2-s2.0-84871345071"
    }
  ];
  
  // Calculate citation count
  const citationCount = mockPublications.reduce((sum, pub) => sum + pub.citations, 0);
  
  // Calculate h-index (for mock data we'll assume h-index is 3 since all 3 publications have >3 citations)
  const hIndex = 3;
  
  return {
    publications: mockPublications,
    metrics: {
      hIndex: hIndex,
      documentCount: mockPublications.length,
      citationCount: citationCount
    },
    lastUpdated: new Date().toISOString()
  };
}

module.exports = { collect };
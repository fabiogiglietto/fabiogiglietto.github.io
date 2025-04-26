/**
 * Scopus API data collector
 * 
 * Fetches publication data and citation metrics from Scopus API
 */

const axios = require('axios');

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
    console.log('Attempting API call with direct URL (simplest method)...');
    // Try using a simple method with API key directly in URL
    const baseUrl = 'https://api.elsevier.com/content/search/scopus';
    const params = new URLSearchParams({
      query: `AU-ID(${authorId})`,
      view: 'COMPLETE',
      sort: 'citedby-count desc',
      count: 100,  // Retrieve up to 100 publications
      apiKey: apiKey
    }).toString();
    
    const response = await axios.get(`${baseUrl}?${params}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
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
      
      // Return the structured data
      return {
        publications,
        metrics: {
          hIndex: parseInt(response.data['search-results']['opensearch:totalResults'] || "0"),
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
    if (error.response && error.response.status === 401) {
      console.error('Scopus API authentication error: Invalid API key or insufficient access rights');
      console.log('Please make sure:');
      console.log('1. The API key is correctly entered in your .env file or GitHub secrets');
      console.log('2. The API key has permission to access the Scopus Search API');
      console.log('3. Your Scopus subscription includes API access');
    } else {
      console.error('Error fetching Scopus data:', error.message);
      if (error.response) {
        console.error(`Status code: ${error.response.status}`);
        console.error(`Response data:`, error.response.data);
      }
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
  return {
    publications: [
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
    ],
    metrics: {
      hIndex: 14,
      documentCount: 42,
      citationCount: 1584
    },
    lastUpdated: new Date().toISOString()
  };
}

module.exports = { collect };
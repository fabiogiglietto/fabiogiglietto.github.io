/**
 * Semantic Scholar API data collector
 * 
 * Fetches publication data and citation metrics from Semantic Scholar API
 */

const axios = require('axios');

/**
 * Makes an API request with retries and rate limiting
 * @param {Function} requestFn - The function that makes the request
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Delay between retries in ms
 * @returns {Promise} - The response from the API
 */
async function withRetry(requestFn, maxRetries = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Rate limiting: wait 1 second between requests as per S2 API limits
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
  console.log('Collecting Semantic Scholar data...');
  
  // Get API key from environment variable
  const apiKey = process.env.S2_API_KEY;
  
  // Author ID for Fabio Giglietto in Semantic Scholar
  const authorId = '2045956';
  
  // Check if this is running on GitHub Actions
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  
  if (!apiKey) {
    // Only show warning in GitHub Actions environment
    if (isGitHubActions) {
      console.warn('Semantic Scholar API key not found. Add S2_API_KEY to repository secrets for live data.');
    } else {
      console.warn('Semantic Scholar API key not found in .env file. Using mock data.');
    }
    return getMockData();
  }
  
  // API key is available and validated
  console.log('Using Semantic Scholar API key (configured)');
  console.log(`Fetching publications for author ID: ${authorId}`);
  
  try {
    console.log('Attempting Semantic Scholar API call...');
    
    const baseUrl = 'https://api.semanticscholar.org/graph/v1';
    
    // First, get author information
    console.log('Fetching author profile...');
    const authorResponse = await withRetry(async () => {
      return await axios.get(`${baseUrl}/author/${authorId}`, {
        headers: {
          'x-api-key': apiKey,
          'User-Agent': 'FabioGigliettoAcademicWebsite/1.0'
        },
        params: {
          fields: 'name,affiliations,homepage,paperCount,citationCount,hIndex'
        }
      });
    });
    
    console.log(`Author profile retrieved: ${authorResponse.data.name}`);
    
    // Get author's papers with detailed information
    console.log('Fetching author papers...');
    const papersResponse = await withRetry(async () => {
      return await axios.get(`${baseUrl}/author/${authorId}/papers`, {
        headers: {
          'x-api-key': apiKey,
          'User-Agent': 'FabioGigliettoAcademicWebsite/1.0'
        },
        params: {
          fields: 'paperId,title,abstract,venue,year,referenceCount,citationCount,influentialCitationCount,isOpenAccess,openAccessPdf,fieldsOfStudy,authors,externalIds',
          limit: 1000  // Get up to 1000 papers
        }
      });
    });
    
    console.log(`Retrieved ${papersResponse.data.data.length} papers from Semantic Scholar`);
    
    // Process the papers
    const publications = papersResponse.data.data.map(paper => {
      // Extract author list
      const authorText = paper.authors ? 
        paper.authors.map(author => author.name).join(', ') : 
        '';
      
      // Extract DOI if available
      const doi = paper.externalIds?.DOI || null;
      
      // Extract ArXiv ID if available
      const arxivId = paper.externalIds?.ArXiv || null;
      
      return {
        title: paper.title || "",
        authors: authorText,
        venue: paper.venue || "",
        year: paper.year || null,
        doi: doi,
        arxivId: arxivId,
        citations: paper.citationCount || 0,
        influentialCitations: paper.influentialCitationCount || 0,
        references: paper.referenceCount || 0,
        semanticScholarId: paper.paperId,
        isOpenAccess: paper.isOpenAccess || false,
        openAccessPdf: paper.openAccessPdf?.url || null,
        abstract: paper.abstract || null,
        fieldsOfStudy: paper.fieldsOfStudy || []
      };
    });
    
    // Sort by citation count (descending)
    publications.sort((a, b) => (b.citations || 0) - (a.citations || 0));
    
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
      profile: {
        name: authorResponse.data.name,
        affiliations: authorResponse.data.affiliations || [],
        homepage: authorResponse.data.homepage || null
      },
      publications,
      metrics: {
        hIndex: authorResponse.data.hIndex || 0,
        documentCount: authorResponse.data.paperCount || publications.length,
        citationCount: authorResponse.data.citationCount || publications.reduce((sum, pub) => sum + (pub.citations || 0), 0),
        influentialCitationCount: publications.reduce((sum, pub) => sum + (pub.influentialCitations || 0), 0)
      },
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      console.error(`Semantic Scholar API error - Status code: ${status}`);
      
      // Handle specific HTTP status codes
      if (status === 401) {
        console.error('Authentication error: Invalid API key');
        console.log('Please make sure the S2_API_KEY is correctly entered in your .env file or GitHub secrets');
      } else if (status === 429) {
        console.error('Rate limit exceeded: Too many requests to the Semantic Scholar API');
        console.log('Semantic Scholar allows 1 request per second. Try again later.');
      } else if (status >= 500) {
        console.error('Semantic Scholar server error. Try again later.');
      }
      
      // Log response data if available
      if (error.response.data) {
        const errorData = typeof error.response.data === 'object' 
          ? JSON.stringify(error.response.data, null, 2)
          : error.response.data;
        console.error(`Response data: ${errorData}`);
      }
    } else if (error.request) {
      console.error('Network error: No response received from Semantic Scholar API');
      console.log('Please check your internet connection');
    } else {
      console.error('Error fetching Semantic Scholar data:', error.message);
    }
    
    console.log('Falling back to mock data...');
    // Fall back to mock data on error
    return getMockData();
  }
}

/**
 * Provides mock Semantic Scholar data when API key is not available
 */
function getMockData() {
  const mockPublications = [
    {
      title: "Second Screen and Participation: A Content Analysis on a Full Season Dataset of Tweets",
      authors: "Fabio Giglietto, Donatella Selva",
      venue: "Journal of Communication",
      year: 2014,
      doi: "10.1111/jcom.12085",
      citations: 145,
      influentialCitations: 12,
      references: 45,
      semanticScholarId: "mock-s2-id-1",
      isOpenAccess: false,
      openAccessPdf: null,
      abstract: "This study examines second screen participation during television programming...",
      fieldsOfStudy: ["Computer Science", "Sociology"]
    },
    {
      title: "'Fake news' is the invention of a liar: How false information circulates within the hybrid news system",
      authors: "Fabio Giglietto, Laura Iannelli, Augusto Valeriani, Luca Rossi",
      venue: "Current Sociology",
      year: 2019,
      doi: "10.1177/0011392119837536",
      citations: 89,
      influentialCitations: 8,
      references: 67,
      semanticScholarId: "mock-s2-id-2",
      isOpenAccess: true,
      openAccessPdf: "https://example.com/paper.pdf",
      abstract: "This paper analyzes how false information circulates in contemporary media ecosystems...",
      fieldsOfStudy: ["Sociology", "Political Science"]
    },
    {
      title: "The open laboratory: Limits and possibilities of using Facebook, Twitter, and YouTube as a research data source",
      authors: "Fabio Giglietto, Luca Rossi, Davide Bennato",
      venue: "Journal of Technology in Human Services",
      year: 2012,
      doi: "10.1080/15228835.2012.743797",
      citations: 178,
      influentialCitations: 15,
      references: 52,
      semanticScholarId: "mock-s2-id-3",
      isOpenAccess: false,
      openAccessPdf: null,
      abstract: "This article explores the opportunities and challenges of using social media platforms as research data sources...",
      fieldsOfStudy: ["Computer Science", "Sociology"]
    }
  ];
  
  return {
    profile: {
      name: "Fabio Giglietto",
      affiliations: ["Università di Urbino Carlo Bo"],
      homepage: null
    },
    publications: mockPublications,
    metrics: {
      hIndex: 12,
      documentCount: mockPublications.length,
      citationCount: mockPublications.reduce((sum, pub) => sum + pub.citations, 0),
      influentialCitationCount: mockPublications.reduce((sum, pub) => sum + pub.influentialCitations, 0)
    },
    lastUpdated: new Date().toISOString()
  };
}

module.exports = {
  collect,
  name: 'semantic-scholar'
};
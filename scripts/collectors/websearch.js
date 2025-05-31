// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const OpenAI = require('openai');

// Check for API key in environment
const hasValidApiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-');

// Check if running in GitHub Actions
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

/**
 * Collector for fetching web search results about Fabio Giglietto
 * using OpenAI Web Search API - ONLY REAL RESULTS
 */
async function collectWebSearchResults() {
  console.log('Starting web search collection...');
  
  try {
    // Early check for API key
    if (!hasValidApiKey) {
      if (isGitHubActions) {
        console.error('OPENAI_API_KEY environment variable is missing or invalid in GitHub Actions!');
        console.error('Please add the OPENAI_API_KEY secret to the repository settings.');
      } else {
        console.log('OPENAI_API_KEY environment variable is not set or OpenAI client failed to initialize');
        console.log('Clearing web mentions data - section will be hidden without valid API key');
      }
      
      // Save empty results when no API key is available - DO NOT use mock data
      return await saveEmptyResults();
    }
    
    console.log('API key found, configuring OpenAI client...');
    
    // Configure OpenAI API
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Search queries - only for real web search
    const queries = [
      "Fabio Giglietto recent publications",
      "Fabio Giglietto news OR notizie media coverage",
      "Fabio Giglietto interviews OR intervista",
      "Fabio Giglietto conference presentations 2024"
    ];

    let allResults = [];

    // Run searches for each query using the Responses API
    for (const query of queries) {
      console.log(`Searching for: ${query}`);
      
      try {
        let response;
        let searchResults = [];
        
        try {
          // Create search prompt for real web search
          const searchPrompt = `Search the web for real, recent mentions of Fabio Giglietto from verifiable sources. Look for actual news articles, academic publications, conference presentations, and media coverage from the past year. Only return real, verifiable results with actual URLs.`;
          
          response = await openai.responses.create({
            model: "gpt-4o",
            input: searchPrompt,
            tools: [
              {
                type: "web_search"
              }
            ]
          });
          
          // Extract ONLY real search results from the response
          if (response && response.tool_outputs && response.tool_outputs.length > 0) {
            for (const toolOutput of response.tool_outputs) {
              if (toolOutput.type === 'web_search' && toolOutput.results) {
                // Filter out any results that look fake or fabricated
                const realResults = toolOutput.results.filter(result => 
                  result.url && 
                  result.url.startsWith('http') &&
                  !result.url.includes('example.com') &&
                  result.title &&
                  result.snippet
                );
                searchResults = [...searchResults, ...realResults];
              }
            }
            console.log(`Found ${searchResults.length} REAL results from web search`);
          }
        } catch (responsesError) {
          console.log(`Web search API not available for ${query}:`, responsesError.message);
          // Do not fall back to mock data - continue to next query
        }
        
        // Add only real results
        allResults = [...allResults, ...searchResults];
        console.log(`Total REAL results so far: ${allResults.length}`);
        
      } catch (queryError) {
        console.error(`Error searching for "${query}":`, queryError.message);
        // Continue with other queries even if one fails
      }
    }

    // If we didn't get any REAL results, save empty results (hide section)
    if (allResults.length === 0) {
      console.log('No real search results found. Saving empty results to hide section.');
      return await saveEmptyResults();
    }

    // Remove duplicates by URL
    const uniqueResults = allResults.filter((result, index, self) =>
      index === self.findIndex(r => r.url === result.url)
    );

    // Format results - only real ones
    const formattedResults = uniqueResults.map(result => ({
      title: result.title,
      snippet: result.snippet,
      url: result.url,
      date: result.published_date || result.date || new Date().toISOString().split('T')[0],
      source: result.source || extractDomainFromUrl(result.url)
    }));

    // Sort by date (newest first)
    formattedResults.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Limit to most recent 10 results
    const recentResults = formattedResults.slice(0, 10);

    // Write to JSON file
    const outputPath = path.join(__dirname, '../../public/data/websearch.json');
    await writeFileAsync(outputPath, JSON.stringify(recentResults, null, 2));

    console.log(`Successfully collected ${recentResults.length} REAL web search results and saved to ${outputPath}`);
    return recentResults;
  } catch (error) {
    console.error('Error collecting web search results:', error);
    // Return empty results if there's an error - DO NOT use mock data
    return await saveEmptyResults();
  }
}

/**
 * Save empty results to hide the web mentions section
 */
async function saveEmptyResults() {
  const emptyData = [];
  const outputPath = path.join(__dirname, '../../public/data/websearch.json');
  await writeFileAsync(outputPath, JSON.stringify(emptyData, null, 2));
  console.log(`Saved empty results to ${outputPath} - web mentions section will be hidden`);
  return emptyData;
}

/**
 * Extract domain from URL for source attribution
 */
function extractDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch (error) {
    return 'Web';
  }
}

module.exports = collectWebSearchResults;
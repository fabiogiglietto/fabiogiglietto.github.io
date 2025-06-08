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
      "Fabio Giglietto recent web mentions",
      "Fabio Giglietto recent news OR media coverage",
      "Fabio Giglietto recent interviews",
      "Fabio Giglietto recent or upcoming conference presentations"
    ];

    let allResults = [];

    // Run searches for each query using the Responses API
    for (const query of queries) {
      console.log(`Searching for: ${query}`);
      
      try {
        let response;
        let searchResults = [];
        
        try {
          // Create search prompt using the specific query - try different strategies per query type
          let searchPrompt;
          if (query.includes('web mentions')) {
            searchPrompt = `Find recent web mentions of "Fabio Giglietto" from the past 3 months. Look for citations, references, or discussions of his research by others in academic papers, news articles, conference proceedings, or professional blogs. Exclude content authored by Fabio Giglietto himself. Focus on third-party mentions of his work.`;
          } else if (query.includes('news OR media coverage')) {
            searchPrompt = `Search for recent news articles and media coverage mentioning "Fabio Giglietto" from the past 3 months. Look for journalism, press releases, or media reports that reference his research or quote him. Exclude self-authored content.`;
          } else if (query.includes('interviews')) {
            searchPrompt = `Find recent interviews, podcasts, or Q&A sessions featuring "Fabio Giglietto" from the past 3 months. Look for external interviews where he is featured as a guest or expert source.`;
          } else {
            searchPrompt = `Search for recent and upcoming conference presentations, talks, speeches, or academic events featuring "Fabio Giglietto" from the past 3 months and next 6 months. Look for conference programs, event announcements, presentation abstracts, keynote speeches, or future speaking engagements.`;
          }
          
          console.log(`Attempting web search with prompt: "${searchPrompt}"`);
          
          response = await openai.responses.create({
            model: "gpt-4o",
            input: searchPrompt,
            tools: [
              {
                type: "web_search_preview",
                search_context_size: "high"
              }
            ],
            tool_choice: { type: "web_search_preview" }
          });
          
          console.log(`API response received for query "${query}"`);
          
          // Extract search results from the new API structure
          if (response && response.output && response.output.length > 0) {
            for (const output of response.output) {
              if (output.type === 'message' && output.content && output.content.length > 0) {
                for (const content of output.content) {
                  if (content.type === 'output_text' && content.annotations) {
                    console.log(`Found ${content.annotations.length} URL citations`);
                    
                    // Extract unique URLs with titles
                    const urlMap = new Map();
                    for (const annotation of content.annotations) {
                      if (annotation.type === 'url_citation' && annotation.url && annotation.title) {
                        // Skip Kudos/GrowKudos results
                        if (annotation.url.includes('kudos.com') || annotation.url.includes('growkudos.com')) {
                          console.log(`Skipping Kudos result: ${annotation.url}`);
                          continue;
                        }
                        
                        // Skip self-authored Medium articles
                        if (annotation.url.includes('medium.com/%40fabiogiglietto')) {
                          console.log(`Skipping self-authored Medium article: ${annotation.url}`);
                          continue;
                        }
                        
                        // Skip SSRN author pages (self-referential)
                        if (annotation.url.includes('papers.ssrn.com') && annotation.title.includes('Author Page for Fabio Giglietto')) {
                          console.log(`Skipping SSRN author page: ${annotation.url}`);
                          continue;
                        }
                        
                        // Skip direct links to Fabio Giglietto authored papers (not discussions about them)
                        if (isDirectPaperLink(annotation.title, annotation.url)) {
                          console.log(`Skipping direct paper link: ${annotation.url}`);
                          continue;
                        }
                        
                        if (!urlMap.has(annotation.url)) {
                          // Clean up snippet to remove markdown-style URL references
                          let snippet = content.text.substring(annotation.start_index, annotation.end_index);
                          // Remove markdown links like ([domain.com](url))
                          snippet = snippet.replace(/\(\[.*?\]\(.*?\)\)/g, '').trim();
                          
                          urlMap.set(annotation.url, {
                            title: annotation.title,
                            url: annotation.url,
                            snippet: snippet,
                            date: new Date().toISOString().split('T')[0], // Today's date as fallback
                            source: extractDomainFromUrl(annotation.url)
                          });
                        }
                      }
                    }
                    
                    const uniqueResults = Array.from(urlMap.values());
                    console.log(`Extracted ${uniqueResults.length} unique results`);
                    searchResults = [...searchResults, ...uniqueResults];
                  }
                }
              }
            }
            console.log(`Found ${searchResults.length} results from web search`);
          } else {
            console.log(`No output in response or empty response`);
          }
        } catch (responsesError) {
          console.log(`Web search API error for ${query}:`, responsesError.message);
          console.log(`Error details:`, JSON.stringify({
            name: responsesError.name,
            message: responsesError.message,
            status: responsesError.status,
            code: responsesError.code
          }, null, 2));
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
 * Check if this is a direct link to a Fabio Giglietto authored paper
 * vs. a discussion/mention of his work
 */
function isDirectPaperLink(title, url) {
  // Check for direct paper patterns - titles that are just paper titles with Fabio as author
  const directPaperPatterns = [
    // Journal paper patterns
    /^[^:]+:\s*.*Fabio Giglietto.*,.*\d{4}$/,  // "Journal: Title - Fabio Giglietto, Author2, 2023"
    /^.*\s-\s.*Fabio Giglietto.*,.*\d{4}$/,    // "Title - Fabio Giglietto, Author2, 2023"
    
    // Repository/database patterns for papers authored by Fabio
    /Rivisteweb:.*Fabio Giglietto.*\d{4}$/,    // Rivisteweb direct paper links
  ];
  
  // URLs that are typically direct paper links (not discussions)
  const directPaperUrls = [
    'journals.sagepub.com/doi/',           // Direct SAGE journal articles
    'rivisteweb.it/doi/',                  // Direct Rivisteweb articles
    'link.springer.com/article/',         // Direct Springer articles
    'www.tandfonline.com/doi/',           // Direct Taylor & Francis articles
    'onlinelibrary.wiley.com/doi/',       // Direct Wiley articles
    'www.sciencedirect.com/science/article/', // Direct ScienceDirect articles
    'ieeexplore.ieee.org/document/',      // Direct IEEE articles
  ];
  
  // Check if title matches direct paper patterns
  const titleIsDirectPaper = directPaperPatterns.some(pattern => pattern.test(title));
  
  // Check if URL is a direct paper link
  const urlIsDirectPaper = directPaperUrls.some(pattern => url.includes(pattern));
  
  // If both title and URL suggest this is a direct paper link, skip it
  if (titleIsDirectPaper && urlIsDirectPaper) {
    return true;
  }
  
  // Special case: Rivisteweb entries that are just paper titles
  if (url.includes('rivisteweb.it/doi/') && title.includes('Rivisteweb:') && 
      title.includes('Fabio Giglietto') && !title.includes('discusses') && 
      !title.includes('references') && !title.includes('cites')) {
    return true;
  }
  
  return false;
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
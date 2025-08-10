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
            searchPrompt = `Find recent web mentions of "Fabio Giglietto" from the past 3 months. IMPORTANT: Only include results about Fabio Giglietto who is a Professor of Internet Studies at University of Urbino Carlo Bo, specializing in social media research, disinformation, computational social science, and media communication. Look for citations, references, or discussions of his media/communication research by others in academic papers, news articles, conference proceedings, or professional blogs. Exclude content authored by Fabio Giglietto himself. Focus on third-party mentions of his work in internet studies, social media analysis, or communication research.`;
          } else if (query.includes('news OR media coverage')) {
            searchPrompt = `Search for recent news articles and media coverage mentioning "Fabio Giglietto" from the past 3 months. IMPORTANT: Only include results about Fabio Giglietto who is a Professor of Internet Studies at University of Urbino Carlo Bo. Look for journalism, press releases, or media reports that reference his research in social media, disinformation, computational social science, or communication studies. Exclude self-authored content.`;
          } else if (query.includes('interviews')) {
            searchPrompt = `Find recent interviews, podcasts, or Q&A sessions featuring "Fabio Giglietto" from the past 3 months. IMPORTANT: Only include results about Fabio Giglietto who is a Professor of Internet Studies at University of Urbino Carlo Bo specializing in social media and communication research. Look for external interviews where he is featured as a guest or expert source discussing internet studies, social media research, or media analysis.`;
          } else {
            searchPrompt = `Search for recent and upcoming conference presentations, talks, speeches, or academic events featuring "Fabio Giglietto" from the past 3 months and next 6 months. IMPORTANT: Only include results about Fabio Giglietto who is a Professor of Internet Studies at University of Urbino Carlo Bo. Look for conference programs, event announcements, presentation abstracts, keynote speeches, or future speaking engagements related to internet studies, social media research, communication science, or computational social science.`;
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
                        
                        // Skip medical/hematology results about Fabio Giglio (wrong person)
                        if (isMedicalResult(annotation.title, annotation.url)) {
                          console.log(`Skipping medical result (wrong Fabio): ${annotation.url}`);
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

    // Add validation layer - verify each result with OpenAI 4o
    console.log(`\n=== Starting validation of ${uniqueResults.length} results ===`);
    const validatedResults = [];
    
    for (let i = 0; i < uniqueResults.length; i++) {
      const result = uniqueResults[i];
      console.log(`\nValidating result ${i + 1}/${uniqueResults.length}: ${result.title}`);
      
      try {
        const validation = await validateWebMention(openai, result);
        if (validation.isRelevant) {
          console.log(`✓ Validated: ${result.title}`);
          console.log(`  - Mentioned by name: ${validation.mentionedByName}`);
          console.log(`  - Person match: ${validation.personMatch}`);
          console.log(`  - Is recent: ${validation.isRecent}`);
          console.log(`  - Relevance score: ${validation.relevanceScore}`);
          validatedResults.push({
            title: result.title,
            snippet: result.snippet,
            url: result.url,
            date: result.published_date || result.date || new Date().toISOString().split('T')[0],
            source: result.source || extractDomainFromUrl(result.url),
            description: validation.description,
            relevanceScore: validation.relevanceScore,
            mentionedByName: validation.mentionedByName,
            personMatch: validation.personMatch,
            isRecent: validation.isRecent
          });
        } else {
          console.log(`✗ Filtered out: ${result.title}`);
          console.log(`  - Reason: ${validation.reason}`);
          console.log(`  - Mentioned by name: ${validation.mentionedByName}`);
          console.log(`  - Person match: ${validation.personMatch}`);
          console.log(`  - Is recent: ${validation.isRecent}`);
        }
      } catch (validationError) {
        console.error(`Error validating result "${result.title}":`, validationError.message);
        // Include result without validation if validation fails
        validatedResults.push({
          title: result.title,
          snippet: result.snippet,
          url: result.url,
          date: result.published_date || result.date || new Date().toISOString().split('T')[0],
          source: result.source || extractDomainFromUrl(result.url),
          description: "Description unavailable due to validation error",
          relevanceScore: 0.5
        });
      }
    }

    console.log(`\nValidation complete: ${validatedResults.length}/${uniqueResults.length} results passed validation`);

    // Sort by relevance score (highest first), then by date
    validatedResults.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return new Date(b.date) - new Date(a.date);
    });

    // Limit to most recent/relevant 10 results
    const recentResults = validatedResults.slice(0, 10);

    // Write current results to JSON file
    const outputPath = path.join(__dirname, '../../public/data/websearch.json');
    await writeFileAsync(outputPath, JSON.stringify(recentResults, null, 2));

    // Maintain historical log of all validated web mentions
    await updateHistoricalLog(recentResults);

    console.log(`Successfully collected ${recentResults.length} REAL web search results and saved to ${outputPath}`);
    return recentResults;
  } catch (error) {
    console.error('Error collecting web search results:', error);
    // Return empty results if there's an error - DO NOT use mock data
    return await saveEmptyResults();
  }
}

/**
 * Update historical log of validated web mentions
 */
async function updateHistoricalLog(newResults) {
  try {
    const logPath = path.join(__dirname, '../../public/data/websearch-history.json');
    
    // Load existing historical log
    let historicalLog = [];
    try {
      if (fs.existsSync(logPath)) {
        const existingData = fs.readFileSync(logPath, 'utf8');
        historicalLog = JSON.parse(existingData);
      }
    } catch (readError) {
      console.log('Could not read existing historical log, starting fresh:', readError.message);
      historicalLog = [];
    }

    // Add metadata to new results
    const timestamp = new Date().toISOString();
    const resultsWithMetadata = newResults.map(result => ({
      ...result,
      collectedAt: timestamp,
      collectionRun: timestamp.split('T')[0] // Date part for grouping
    }));

    // Check for duplicates by URL and only add new ones
    const existingUrls = new Set(historicalLog.map(item => item.url));
    const newEntries = resultsWithMetadata.filter(result => !existingUrls.has(result.url));
    
    if (newEntries.length > 0) {
      // Add new entries to the historical log
      historicalLog = [...historicalLog, ...newEntries];
      
      // Sort by collection date (newest first)
      historicalLog.sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
      
      // Optionally limit historical log size (keep last 500 entries)
      if (historicalLog.length > 500) {
        historicalLog = historicalLog.slice(0, 500);
      }

      // Save updated historical log
      await writeFileAsync(logPath, JSON.stringify(historicalLog, null, 2));
      console.log(`Historical log updated: added ${newEntries.length} new entries, total: ${historicalLog.length}`);
    } else {
      console.log('Historical log: no new entries to add (all URLs already exist)');
    }

    // Create a summary log for easy analysis
    await createHistoricalSummary(historicalLog);

  } catch (error) {
    console.error('Error updating historical log:', error.message);
    // Don't fail the main process if logging fails
  }
}

/**
 * Create a summary of historical web mentions for analysis
 */
async function createHistoricalSummary(historicalLog) {
  try {
    const summaryPath = path.join(__dirname, '../../public/data/websearch-summary.json');
    
    // Group by collection date
    const byDate = {};
    const bySource = {};
    const byRelevanceScore = { high: 0, medium: 0, low: 0 };
    
    historicalLog.forEach(entry => {
      const date = entry.collectionRun || entry.collectedAt?.split('T')[0] || 'unknown';
      const source = entry.source || 'unknown';
      const score = entry.relevanceScore || 0;
      
      // Group by date
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(entry);
      
      // Group by source
      if (!bySource[source]) bySource[source] = 0;
      bySource[source]++;
      
      // Group by relevance score
      if (score >= 0.8) byRelevanceScore.high++;
      else if (score >= 0.5) byRelevanceScore.medium++;
      else byRelevanceScore.low++;
    });

    const summary = {
      totalEntries: historicalLog.length,
      lastUpdated: new Date().toISOString(),
      dateRange: {
        earliest: historicalLog.length > 0 ? historicalLog[historicalLog.length - 1].collectedAt : null,
        latest: historicalLog.length > 0 ? historicalLog[0].collectedAt : null
      },
      byDate: Object.keys(byDate).sort().reverse().slice(0, 10).reduce((obj, key) => {
        obj[key] = byDate[key].length;
        return obj;
      }, {}),
      bySource: Object.entries(bySource)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .reduce((obj, [key, value]) => {
          obj[key] = value;
          return obj;
        }, {}),
      byRelevanceScore,
      recentHighQuality: historicalLog
        .filter(entry => (entry.relevanceScore || 0) >= 0.8)
        .slice(0, 5)
        .map(entry => ({
          title: entry.title,
          url: entry.url,
          source: entry.source,
          relevanceScore: entry.relevanceScore,
          collectedAt: entry.collectedAt
        }))
    };

    await writeFileAsync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`Historical summary created: ${summary.totalEntries} total entries`);

  } catch (error) {
    console.error('Error creating historical summary:', error.message);
  }
}

/**
 * Validate a web mention using OpenAI 4o to verify relevance and generate description
 */
async function validateWebMention(openai, result) {
  try {
    const prompt = `You are analyzing a web mention to determine if it's about the correct person, if it actually mentions them, and if the content is recent.

TARGET PERSON: Fabio Giglietto
- Professor of Internet Studies at University of Urbino Carlo Bo, Italy
- Specializes in: social media research, disinformation studies, computational social science, media communication
- Expert in: internet studies, social media analysis, digital communication, misinformation detection

WEB MENTION TO ANALYZE:
Title: "${result.title}"
URL: ${result.url}
Source: ${result.source}
Context: ${result.snippet || 'No snippet available'}

CRITICAL VALIDATION STEPS:
1. MENTION VERIFICATION: Does this content actually mention "Fabio Giglietto" by name? Look carefully in the title, URL, and any available context.
2. PERSON IDENTIFICATION: If Fabio Giglietto is mentioned, is it the Professor of Internet Studies at University of Urbino Carlo Bo (not a medical researcher or someone else)?
3. RECENCY CHECK: Is this content recent (within the last 6 months) or does it discuss recent work/events?
4. RELEVANCE ASSESSMENT: Does it relate to his academic work in social media, disinformation, or communication research?

RESPONSE FORMAT (JSON):
{
  "isRelevant": boolean,
  "mentionedByName": boolean,
  "relevanceScore": number (0.0-1.0, where 1.0 = highly relevant),
  "reason": "brief explanation if not relevant",
  "description": "1-2 sentence professional description of the content",
  "personMatch": "confirmed" | "uncertain" | "different_person" | "not_mentioned",
  "isRecent": boolean
}

STRICT EVALUATION CRITERIA:
- isRelevant = true ONLY if ALL of these are true:
  * mentionedByName = true (Fabio Giglietto is explicitly mentioned)
  * personMatch = "confirmed" (it's the correct academic researcher)
  * isRecent = true (content is from the last 6 months or discusses recent work)
  * Content relates to his research areas (social media, disinformation, communication)
  * Not a direct link to his own authored papers (we want third-party mentions)

- mentionedByName = true only if "Fabio Giglietto" appears in the title, URL, or context
- isRecent = true only if the content appears to be from 2024-2025 or discusses recent events/research
- relevanceScore should be high (0.8-1.0) only for high-quality third-party mentions that clearly discuss his work

Be very strict - if you cannot confirm Fabio Giglietto is mentioned by name, set isRelevant to false.

Please analyze and respond with valid JSON only.`;

    const response = await openai.responses.create({
      model: "gpt-5",
      input: prompt,
      reasoning: {
        effort: "minimal"  // Fast analysis for web search validation
      },
      text: {
        verbosity: "low"  // Concise JSON response
      }
    });

    const content = response.output_text.trim();
    
    // Try to parse JSON response
    let validation;
    try {
      validation = JSON.parse(content);
    } catch (parseError) {
      console.log('Failed to parse validation JSON, attempting extraction...');
      // Try to extract JSON from response if it's wrapped in markdown or other text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        validation = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not extract valid JSON from validation response');
      }
    }

    // Validate the response structure
    if (typeof validation.isRelevant !== 'boolean') {
      throw new Error('Invalid validation response: missing or invalid isRelevant field');
    }

    // Ensure all required fields exist with defaults
    return {
      isRelevant: validation.isRelevant,
      mentionedByName: validation.mentionedByName || false,
      relevanceScore: validation.relevanceScore || (validation.isRelevant ? 0.7 : 0.1),
      reason: validation.reason || (validation.isRelevant ? 'Validated as relevant' : 'Not relevant'),
      description: validation.description || result.title,
      personMatch: validation.personMatch || 'uncertain',
      isRecent: validation.isRecent || false
    };

  } catch (error) {
    console.error('Error in validation API call:', error.message);
    // Return a fallback validation that includes the item
    return {
      isRelevant: true,
      relevanceScore: 0.5,
      reason: 'Validation failed, included by default',
      description: result.title,
      personMatch: 'uncertain'
    };
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
 * Check if this is a medical/hematology result about Fabio Giglio (wrong person)
 * vs. communication/internet studies about Fabio Giglietto
 */
function isMedicalResult(title, url) {
  // Medical terms that indicate this is about Fabio Giglio the medical researcher
  const medicalKeywords = [
    'ematologia', 'hematology', 'haematology',
    'trapianto midollo osseo', 'bone marrow transplant', 'BMT',
    'san raffaele', 'scientific institute',
    'oncologia', 'oncology',
    'leucemia', 'leukemia', 'leukaemia',
    'chemioterapia', 'chemotherapy',
    'medicina', 'medical', 'medico',
    'ospedale', 'hospital',
    'clinica', 'clinic', 'clinical',
    'paziente', 'patient',
    'terapia', 'therapy', 'treatment'
  ];
  
  // Check if title contains medical keywords
  const titleLower = title.toLowerCase();
  const hasMedicalKeywords = medicalKeywords.some(keyword => titleLower.includes(keyword));
  
  // Check URL for medical domains/paths
  const urlLower = url.toLowerCase();
  const medicalDomains = [
    'sanraffaele',
    'hsr.it',
    'medicine',
    'medical',
    'hospital',
    'clinic'
  ];
  const hasMedicalDomain = medicalDomains.some(domain => urlLower.includes(domain));
  
  // Check for specific patterns indicating medical research
  const medicalPatterns = [
    /specialit[àa]\s+in\s+ematologia/i,
    /bone\s+marrow\s+transplant/i,
    /hematology\s+department/i,
    /milano.*ematologia/i,
    /milan.*hematology/i
  ];
  const hasMedialPattern = medicalPatterns.some(pattern => pattern.test(title) || pattern.test(url));
  
  return hasMedicalKeywords || hasMedicalDomain || hasMedialPattern;
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
// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const axios = require('axios');

// Check for API keys in environment
const hasGeminiApiKey = !!process.env.GEMINI_API_KEY;
const hasOpenAIApiKey = !!process.env.OPENAI_API_KEY;
const hasValidApiKey = hasGeminiApiKey || hasOpenAIApiKey;

// Check if running in GitHub Actions
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

/**
 * Collector for fetching web search results about Fabio Giglietto
 * using Gemini API with Google Search grounding - ONLY REAL RESULTS
 */
async function collectWebSearchResults() {
  console.log('Starting web search collection...');

  try {
    // Early check for API keys
    if (!hasValidApiKey) {
      if (isGitHubActions) {
        console.error('No API keys found in GitHub Actions!');
        console.error('Please add GEMINI_API_KEY and/or OPENAI_API_KEY secrets.');
      } else {
        console.log('No API keys found (GEMINI_API_KEY or OPENAI_API_KEY)');
        console.log('Clearing web mentions data - section will be hidden without valid API key');
      }

      // Save empty results when no API key is available - DO NOT use mock data
      return await saveEmptyResults();
    }

    console.log(`API keys found: Gemini=${hasGeminiApiKey}, OpenAI=${hasOpenAIApiKey}`);

    let allResults = [];

    // Run Gemini search if API key is available
    if (hasGeminiApiKey) {
      console.log('\n=== Starting Gemini Web Search ===');

      // Configure Gemini API with Google Search grounding
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        tools: [{ googleSearch: {} }],
      });

      // Search queries - focused on NEWS coverage, not academic papers
      const queries = [
      "\"Fabio Giglietto\" news article -site:researchgate.net -site:academia.edu",
      "\"Fabio Giglietto\" interview OR quoted OR commented -site:researchgate.net",
      "\"Fabio Giglietto\" disinformation OR misinformation news coverage",
      "\"Fabio Giglietto\" expert OR researcher mentioned in news"
      ];

      // Run searches for each query using Gemini with Google Search
    for (const query of queries) {
      console.log(`Searching for: ${query}`);

      try {
        let searchResults = [];

        // Create search prompt - all focused on NEWS coverage
        const searchPrompt = `Search for recent NEWS ARTICLES and MEDIA COVERAGE that mention "Fabio Giglietto" from the past 6 months.

IMPORTANT CONTEXT:
- Fabio Giglietto is a Professor of Internet Studies at University of Urbino Carlo Bo, Italy
- He specializes in: disinformation research, social media analysis, computational social science
- He is often quoted as an expert on misinformation, fake news, and coordinated online behavior

WHAT TO FIND (prioritize these):
1. News articles from newspapers, magazines, or news websites that quote or mention him
2. Media interviews, podcasts, or TV/radio appearances
3. Press coverage about his research findings
4. Articles where journalists cite him as an expert source
5. Conference or event announcements where he is a speaker

WHAT TO EXCLUDE (do NOT include):
- His own profile pages (ORCID, Google Scholar, ResearchGate profile, LinkedIn, personal website)
- Direct links to his academic papers or publications
- Academic repository pages (IRIS, arXiv, SSRN)
- Pages that just list his publications without news context
- ResearchGate "Request PDF" pages

For each NEWS result found, provide:
1. The exact title of the news article/page
2. The full URL (must be a real URL, not a Google redirect)
3. A brief description of how he is mentioned in the news
4. The source domain (e.g., "bbc.com", "wired.it", "ansa.it")

Format your response as a JSON array of objects with keys: title, url, description, source

Only include results with REAL, direct URLs to news sources.`;

        console.log(`Attempting web search with Gemini...`);

        const result = await model.generateContent(searchPrompt);
        const response = result.response;
        const text = response.text();

        console.log(`API response received for query "${query}"`);

        // Extract JSON from response
        try {
          // Try to find JSON array in the response
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
              // Filter and process results
              for (const item of parsed) {
                if (item.url && item.title) {
                  // Resolve redirect URLs first
                  let resolvedUrl = item.url;
                  if (item.url.includes('vertexaisearch.cloud.google.com') ||
                      item.url.includes('grounding-api-redirect')) {
                    resolvedUrl = await resolveRedirectUrl(item.url);
                  }

                  // Skip unwanted results
                  if (shouldSkipResult(resolvedUrl, item.title)) {
                    console.log(`Skipping filtered result: ${resolvedUrl || item.url}`);
                    continue;
                  }

                  searchResults.push({
                    title: item.title,
                    url: resolvedUrl,
                    snippet: item.description || '',
                    date: new Date().toISOString().split('T')[0],
                    source: item.source || extractDomainFromUrl(resolvedUrl),
                    searchEngine: 'gemini'
                  });
                }
              }
              console.log(`Extracted ${searchResults.length} results from Gemini response`);
            }
          } else {
            console.log('No JSON array found in response');
          }
        } catch (parseError) {
          console.log(`Failed to parse JSON from response: ${parseError.message}`);
        }

        // Also extract grounding metadata if available
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        if (groundingMetadata?.groundingChunks) {
          console.log(`Found ${groundingMetadata.groundingChunks.length} grounding chunks`);
          for (const chunk of groundingMetadata.groundingChunks) {
            if (chunk.web?.uri && chunk.web?.title) {
              let url = chunk.web.uri;
              const title = chunk.web.title;

              // Resolve redirect URLs
              if (url.includes('vertexaisearch.cloud.google.com') ||
                  url.includes('grounding-api-redirect')) {
                url = await resolveRedirectUrl(url);
              }

              // Skip if already added or should be filtered
              if (!url || searchResults.some(r => r.url === url)) continue;
              if (shouldSkipResult(url, title)) {
                console.log(`Skipping filtered grounding result: ${url}`);
                continue;
              }

              searchResults.push({
                title: title,
                url: url,
                snippet: '',
                date: new Date().toISOString().split('T')[0],
                source: extractDomainFromUrl(url),
                searchEngine: 'gemini'
              });
            }
          }
        }

        // Add results to collection
        allResults = [...allResults, ...searchResults];
        console.log(`Total Gemini results so far: ${allResults.length}`);

      } catch (queryError) {
        console.error(`Error searching for "${query}":`, queryError.message);
        // Continue with other queries even if one fails
      }
    }
    } // End of Gemini search block

    // Also search with OpenAI if available
    const openaiResults = await searchWithOpenAI();
    if (openaiResults.length > 0) {
      console.log(`Adding ${openaiResults.length} results from OpenAI search`);
      allResults = [...allResults, ...openaiResults];
    }

    // Fetch Google News RSS feed
    const googleNewsResults = await fetchGoogleNewsRSS();
    if (googleNewsResults.length > 0) {
      console.log(`Adding ${googleNewsResults.length} results from Google News RSS`);
      allResults = [...allResults, ...googleNewsResults];
    }

    console.log(`\nTotal combined results: ${allResults.length} (Gemini + OpenAI + Google News)`);

    // If we didn't get any REAL results, save empty results (hide section)
    if (allResults.length === 0) {
      console.log('No real search results found. Saving empty results to hide section.');
      return await saveEmptyResults();
    }

    // Remove duplicates by URL
    const uniqueResults = allResults.filter((result, index, self) =>
      index === self.findIndex(r => r.url === result.url)
    );

    // Add validation layer - verify each result with Gemini (if available)
    console.log(`\n=== Starting validation of ${uniqueResults.length} results ===`);
    const validatedResults = [];

    // Create a model without search for validation (only if Gemini is available)
    let validationModel = null;
    if (hasGeminiApiKey) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      validationModel = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
      });
    }

    for (let i = 0; i < uniqueResults.length; i++) {
      const result = uniqueResults[i];
      console.log(`\nValidating result ${i + 1}/${uniqueResults.length}: ${result.title}`);

      try {
        // Trust Google News RSS results - they come from a name-specific search
        if (result.searchEngine === 'google-news-rss') {
          console.log(`  Trusting Google News RSS result (name-specific search)`);
          validatedResults.push({
            title: result.title,
            snippet: result.snippet,
            url: result.url,
            date: result.date || new Date().toISOString().split('T')[0],
            source: result.source || extractDomainFromUrl(result.url),
            description: result.snippet || `News article from ${result.source}`,
            relevanceScore: 0.75,
            mentionedByName: true,
            personMatch: 'confirmed',
            isRecent: true,
            searchEngine: result.searchEngine
          });
          continue;
        }

        // Skip validation if no Gemini API key, include result with default score
        if (!validationModel) {
          console.log(`  Skipping validation (no Gemini API key), including by default`);
          validatedResults.push({
            title: result.title,
            snippet: result.snippet,
            url: result.url,
            date: result.date || new Date().toISOString().split('T')[0],
            source: result.source || extractDomainFromUrl(result.url),
            description: result.snippet || result.title,
            relevanceScore: 0.6,
            searchEngine: result.searchEngine
          });
          continue;
        }

        const validation = await validateWebMention(validationModel, result);
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
            isRecent: validation.isRecent,
            searchEngine: result.searchEngine
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
          relevanceScore: 0.5,
          searchEngine: result.searchEngine
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
 * Resolve Google redirect URL to get the real destination URL
 */
async function resolveRedirectUrl(url) {
  if (!url.includes('vertexaisearch.cloud.google.com') &&
      !url.includes('grounding-api-redirect')) {
    return url; // Not a redirect, return as-is
  }

  try {
    console.log(`Resolving redirect URL...`);
    const response = await axios.head(url, {
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
      timeout: 5000
    });

    // Check for redirect location header
    if (response.headers.location) {
      console.log(`Resolved to: ${response.headers.location}`);
      return response.headers.location;
    }

    return url;
  } catch (error) {
    // If redirect, the location will be in the error response
    if (error.response && error.response.headers && error.response.headers.location) {
      console.log(`Resolved redirect to: ${error.response.headers.location}`);
      return error.response.headers.location;
    }
    console.log(`Could not resolve redirect: ${error.message}`);
    return null; // Return null to indicate we should skip this
  }
}

/**
 * Check if a result should be skipped based on URL or title
 */
function shouldSkipResult(url, title) {
  // Handle null/undefined URLs (failed redirect resolution)
  if (!url) return true;

  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  // Skip Kudos/GrowKudos results
  if (urlLower.includes('kudos.com') || urlLower.includes('growkudos.com')) {
    return true;
  }

  // Skip self-authored Medium articles
  if (urlLower.includes('medium.com/@fabiogiglietto') || urlLower.includes('medium.com/%40fabiogiglietto')) {
    return true;
  }

  // Skip own profile pages and bio pages
  if (urlLower.includes('fabiogiglietto.github.io') ||
      urlLower.includes('orcid.org/0000-0001-8019-1035') ||
      urlLower.includes('scholar.google.com/citations?user=FmenbcUAAAAJ') ||
      urlLower.includes('ora.uniurb.it/cris/rp/rp03290')) {
    return true;
  }

  // Skip ResearchGate profile and own paper pages
  if (urlLower.includes('researchgate.net/profile/fabio-giglietto') ||
      urlLower.includes('researchgate.net/publication') && titleLower.includes('fabio giglietto')) {
    return true;
  }

  // Skip academic repository pages that are just paper listings
  if (urlLower.includes('iris.') || urlLower.includes('/handle/11576/')) {
    return true;
  }

  // Skip LinkedIn profile
  if (urlLower.includes('linkedin.com/in/fabiogiglietto')) {
    return true;
  }

  // Skip social media profiles (Mastodon, Twitter/X, BlueSky, etc.)
  if (urlLower.includes('/@fabiogiglietto') ||
      urlLower.includes('/fabiogiglietto') && (
        urlLower.includes('twitter.com') ||
        urlLower.includes('x.com') ||
        urlLower.includes('bsky.social') ||
        urlLower.includes('mastodon') ||
        urlLower.includes('aoir.social') ||
        urlLower.includes('threads.net')
      )) {
    return true;
  }

  // Skip SSRN author pages (self-referential)
  if (urlLower.includes('papers.ssrn.com') && titleLower.includes('author page')) {
    return true;
  }

  // Skip generic profile page titles
  if (titleLower === 'fabio giglietto' ||
      titleLower.includes('professor of internet studies') ||
      titleLower.startsWith('home |')) {
    return true;
  }

  // Skip direct paper links
  if (isDirectPaperLink(title, url)) {
    return true;
  }

  // Skip medical/hematology results about Fabio Giglio (wrong person)
  if (isMedicalResult(title, url)) {
    return true;
  }

  return false;
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
 * Validate a web mention using Gemini to verify relevance and generate description
 */
async function validateWebMention(model, result) {
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

RESPONSE FORMAT (JSON only, no other text):
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

Respond with valid JSON only.`;

    const response = await model.generateContent(prompt);
    const content = response.response.text().trim();

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

/**
 * Search using OpenAI Responses API with web search tool
 */
async function searchWithOpenAI() {
  if (!hasOpenAIApiKey) {
    console.log('OpenAI API key not configured, skipping OpenAI search');
    return [];
  }

  console.log('\n=== Starting OpenAI Web Search ===');

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const searchPrompt = `Search for recent NEWS ARTICLES and MEDIA COVERAGE that mention "Fabio Giglietto" from the past 6 months.

IMPORTANT CONTEXT:
- Fabio Giglietto is a Professor of Internet Studies at University of Urbino Carlo Bo, Italy
- He specializes in: disinformation research, social media analysis, computational social science
- He is often quoted as an expert on misinformation, fake news, and coordinated online behavior

WHAT TO FIND (prioritize these):
1. News articles from newspapers, magazines, or news websites that quote or mention him
2. Media interviews, podcasts, or TV/radio appearances
3. Press coverage about his research findings
4. Articles where journalists cite him as an expert source
5. Conference or event announcements where he is a speaker

WHAT TO EXCLUDE (do NOT include):
- His own profile pages (ORCID, Google Scholar, ResearchGate, LinkedIn, personal website)
- Direct links to his academic papers or publications
- Academic repository pages (IRIS, arXiv, SSRN)
- ResearchGate "Request PDF" pages
- Social media profile pages

For each NEWS result found, provide a JSON array with objects containing:
- title: The exact title of the news article
- url: The full URL (must be a real, direct URL)
- description: A brief description of how he is mentioned
- source: The source domain (e.g., "bbc.com", "wired.it")

Respond with ONLY a valid JSON array, no other text.`;

    const response = await openai.responses.create({
      model: 'gpt-4o',
      tools: [{ type: 'web_search' }],
      input: searchPrompt
    });

    console.log('OpenAI response received');

    const results = [];

    // Extract text from the response
    let responseText = '';
    if (response.output) {
      for (const item of response.output) {
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'output_text') {
              responseText += content.text;
            }
          }
        }
      }
    }

    // Try to parse JSON from response
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.url && item.title) {
              // Skip unwanted results
              if (shouldSkipResult(item.url, item.title)) {
                console.log(`OpenAI: Skipping filtered result: ${item.url}`);
                continue;
              }

              results.push({
                title: item.title,
                url: item.url,
                snippet: item.description || '',
                date: new Date().toISOString().split('T')[0],
                source: item.source || extractDomainFromUrl(item.url),
                searchEngine: 'openai'
              });
            }
          }
        }
      }
    } catch (parseError) {
      console.log(`OpenAI: Failed to parse JSON: ${parseError.message}`);
    }

    console.log(`OpenAI search found ${results.length} results`);
    return results;

  } catch (error) {
    console.error('OpenAI search error:', error.message);
    return [];
  }
}

/**
 * Fetch Google News RSS feed for Fabio Giglietto mentions
 */
async function fetchGoogleNewsRSS() {
  console.log('\n=== Fetching Google News RSS Feed ===');

  // Use search-based RSS feed which has more results than topic feed
  const feedUrl = 'https://news.google.com/rss/search?q=Fabio%20Giglietto&hl=it&gl=IT&ceid=IT:it';

  try {
    const response = await axios.get(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const xmlData = response.data;
    const results = [];

    // Parse RSS items using regex (simple XML parsing)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlData)) !== null) {
      const itemContent = match[1];

      // Extract fields
      const title = extractXmlTag(itemContent, 'title');
      const link = extractXmlTag(itemContent, 'link');
      const pubDate = extractXmlTag(itemContent, 'pubDate');
      const source = extractXmlTag(itemContent, 'source');

      if (title && link) {
        // Resolve Google News redirect URL to get actual article URL
        let resolvedUrl = link;
        if (link.includes('news.google.com/rss/articles/')) {
          resolvedUrl = await resolveGoogleNewsUrl(link);
        }

        // Skip if URL resolution failed or should be filtered
        if (!resolvedUrl) {
          console.log(`Google News: Could not resolve URL for: ${title}`);
          continue;
        }

        if (shouldSkipResult(resolvedUrl, title)) {
          console.log(`Google News: Skipping filtered result: ${resolvedUrl}`);
          continue;
        }

        // Parse publication date
        let dateStr = new Date().toISOString().split('T')[0];
        if (pubDate) {
          try {
            dateStr = new Date(pubDate).toISOString().split('T')[0];
          } catch (e) {
            // Keep default date
          }
        }

        // Only include recent results (last 2 years)
        const pubDateObj = new Date(pubDate);
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        if (pubDateObj < twoYearsAgo) {
          console.log(`Google News: Skipping old result (${dateStr}): ${title}`);
          continue;
        }

        results.push({
          title: decodeHtmlEntities(title),
          url: resolvedUrl,
          snippet: '',
          date: dateStr,
          source: source ? decodeHtmlEntities(source) : extractDomainFromUrl(resolvedUrl),
          searchEngine: 'google-news-rss'
        });
      }
    }

    console.log(`Google News RSS: Found ${results.length} recent items`);
    return results;

  } catch (error) {
    console.error('Google News RSS fetch error:', error.message);
    return [];
  }
}

/**
 * Resolve Google News article URL to get actual destination
 */
async function resolveGoogleNewsUrl(googleNewsUrl) {
  try {
    // Follow the redirect to get the actual article URL
    const response = await axios.get(googleNewsUrl, {
      maxRedirects: 5,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // The final URL after redirects is the actual article
    if (response.request && response.request.res && response.request.res.responseUrl) {
      return response.request.res.responseUrl;
    }

    // Fallback: try to extract from response URL
    if (response.config && response.config.url) {
      return response.config.url;
    }

    return googleNewsUrl;
  } catch (error) {
    // If redirect fails, try HEAD request
    try {
      const headResponse = await axios.head(googleNewsUrl, {
        maxRedirects: 0,
        validateStatus: status => status >= 200 && status < 400,
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (headResponse.headers.location) {
        return headResponse.headers.location;
      }
    } catch (headError) {
      if (headError.response && headError.response.headers && headError.response.headers.location) {
        return headError.response.headers.location;
      }
    }

    console.log(`Could not resolve Google News URL: ${error.message}`);
    return null;
  }
}

/**
 * Extract content from XML tag
 */
function extractXmlTag(content, tagName) {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  const cdataMatch = content.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  // Handle regular tags
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

module.exports = {
  collect: collectWebSearchResults,
  name: 'websearch'
};

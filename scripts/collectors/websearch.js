// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

// Check for API keys in environment
const hasGeminiApiKey = !!process.env.GEMINI_API_KEY;
const hasOpenAIApiKey = !!process.env.OPENAI_API_KEY;
const hasValidApiKey = hasGeminiApiKey || hasOpenAIApiKey;

// Check if running in GitHub Actions
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

/**
 * Normalize a URL for deduplication purposes
 * Removes tracking parameters, normalizes domain, handles redirects
 */
function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);

    // List of tracking/noise parameters to remove
    const paramsToRemove = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'ucbcb', 'oc', 'hl', 'gl', 'ceid', // Google News params
      'ref', 'source', 'fbclid', 'gclid', // Social/ad tracking
      '_ga', '_gid', 'mc_cid', 'mc_eid' // Analytics
    ];

    // Remove tracking parameters
    paramsToRemove.forEach(param => url.searchParams.delete(param));

    // Normalize hostname (remove www.)
    let hostname = url.hostname.replace(/^www\./, '');

    // Special handling for Google News RSS redirect URLs - extract the base identifier
    if (hostname === 'news.google.com' && url.pathname.includes('/rss/articles/')) {
      // For Google News, the article ID in the path is the unique identifier
      const articleId = url.pathname.split('/').pop();
      return `news.google.com:${articleId}`;
    }

    // Special handling for Vertex AI search redirects - they're often duplicates
    if (hostname === 'vertexaisearch.cloud.google.com') {
      // These URLs have unique redirect paths, but often point to same content
      // We'll rely on title matching for these
      return urlString; // Keep original for now, title matching will handle duplicates
    }

    // Remove trailing slash
    let pathname = url.pathname.replace(/\/$/, '');

    // Sort remaining query parameters for consistency
    const sortedParams = [...url.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const queryString = sortedParams.length > 0
      ? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&')
      : '';

    return `${hostname}${pathname}${queryString}`.toLowerCase();
  } catch (e) {
    // If URL parsing fails, return original lowercase
    return urlString.toLowerCase();
  }
}

/**
 * Normalize a title for deduplication purposes
 * Removes common suffixes, normalizes whitespace
 */
function normalizeTitle(title) {
  if (!title) return '';

  return title
    // Remove common site name suffixes
    .replace(/\s*[-–—|]\s*(EURACTIV\.ro|ResearchGate|il Ducato|lapiazzarimini\.it|Radio Radicale|vera\.ai.*|Sociologica|Mastodon|Uniurb|arXiv)$/i, '')
    // Remove "| Request PDF" and similar
    .replace(/\s*\|\s*Request PDF$/i, '')
    // Normalize quotes and special characters
    .replace(/[„""'']/g, '"')
    .replace(/[–—]/g, '-')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Check if two mentions are duplicates based on normalized URL and title
 */
function areDuplicateMentions(mention1, mention2) {
  // Check normalized URL match
  const normalizedUrl1 = normalizeUrl(mention1.url);
  const normalizedUrl2 = normalizeUrl(mention2.url);

  if (normalizedUrl1 === normalizedUrl2) {
    return true;
  }

  // Check title match (for cases where URLs differ but content is same)
  const normalizedTitle1 = normalizeTitle(mention1.title);
  const normalizedTitle2 = normalizeTitle(mention2.title);

  // Exact title match
  if (normalizedTitle1 && normalizedTitle2 && normalizedTitle1 === normalizedTitle2) {
    return true;
  }

  // Check if one title is a significant subset of another (for truncated titles)
  if (normalizedTitle1.length > 20 && normalizedTitle2.length > 20) {
    if (normalizedTitle1.startsWith(normalizedTitle2.substring(0, 30)) ||
        normalizedTitle2.startsWith(normalizedTitle1.substring(0, 30))) {
      // Also check if same source domain
      const source1 = (mention1.source || '').toLowerCase();
      const source2 = (mention2.source || '').toLowerCase();
      if (source1 === source2 ||
          normalizeUrl(mention1.url).split('/')[0] === normalizeUrl(mention2.url).split('/')[0]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Deduplicate an array of mentions using normalized URL and title matching
 */
function deduplicateMentions(mentions) {
  const uniqueMentions = [];

  for (const mention of mentions) {
    const isDuplicate = uniqueMentions.some(existing => areDuplicateMentions(existing, mention));
    if (!isDuplicate) {
      uniqueMentions.push(mention);
    }
  }

  return uniqueMentions;
}

/**
 * Collector for fetching web search results about the configured person
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
      `"${config.name}" news article -site:researchgate.net -site:academia.edu`,
      `"${config.name}" interview OR quoted OR commented -site:researchgate.net`,
      `"${config.name}" ${config.expertise.slice(0, 2).join(' OR ')} news coverage`,
      `"${config.name}" expert OR researcher mentioned in news`
      ];

      // Run searches for each query using Gemini with Google Search
    for (const query of queries) {
      console.log(`Searching for: ${query}`);

      try {
        let searchResults = [];

        // Create search prompt - all focused on NEWS coverage
        const searchPrompt = `Search for recent NEWS ARTICLES and MEDIA COVERAGE that mention "${config.name}" from the past 6 months.

IMPORTANT CONTEXT:
- ${config.name} is a ${config.title} at ${config.institution}
- Specializes in: ${config.expertise.join(', ')}

WHAT TO FIND (prioritize these):
1. News articles from newspapers, magazines, or news websites that quote or mention this person
2. Media interviews, podcasts, or TV/radio appearances
3. Press coverage about research findings
4. Articles where journalists cite this person as an expert source
5. Conference or event announcements where this person is a speaker

WHAT TO EXCLUDE (do NOT include):
- Profile pages (ORCID, Google Scholar, ResearchGate profile, LinkedIn, personal website)
- Direct links to academic papers or publications
- Academic repository pages (IRIS, arXiv, SSRN)
- Pages that just list publications without news context
- ResearchGate "Request PDF" pages

For each NEWS result found, provide:
1. The exact title of the news article/page
2. The full URL (must be a real URL, not a Google redirect)
3. A brief description of how the person is mentioned in the news
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
                    date: null,
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
                date: null,
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

    // Fetch Crossref Event Data (DOI-based mention tracking)
    const crossrefResults = await fetchCrossrefEventData();
    if (crossrefResults.length > 0) {
      console.log(`Adding ${crossrefResults.length} results from Crossref Event Data`);
      allResults = [...allResults, ...crossrefResults];
    }

    console.log(`\nTotal combined results: ${allResults.length} (Gemini + OpenAI + Google News + Crossref)`);

    // If we didn't get any REAL results, save empty results (hide section)
    if (allResults.length === 0) {
      console.log('No real search results found. Saving empty results to hide section.');
      return await saveEmptyResults();
    }

    // Remove duplicates using enhanced URL normalization and title matching
    const uniqueResults = deduplicateMentions(allResults);
    console.log(`After deduplication: ${uniqueResults.length} unique results (removed ${allResults.length - uniqueResults.length} duplicates)`);

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
            date: result.date || null,
            source: result.source || extractDomainFromUrl(result.url),
            description: result.snippet || `News article from ${result.source}`,
            relevanceScore: 0.75,
            mentionedByName: true,
            personMatch: 'confirmed',
            isRecent: true,
            searchEngine: result.searchEngine,
            dateConfidence: result.dateConfidence || null,
            dateSource: result.dateSource || null
          });
          continue;
        }

        // Trust Crossref event data results
        if (result.searchEngine === 'crossref-events') {
          console.log(`  Trusting Crossref event data result`);
          validatedResults.push({
            title: result.title,
            snippet: result.snippet,
            url: result.url,
            date: result.date || null,
            source: result.source || extractDomainFromUrl(result.url),
            description: result.snippet || `Crossref event from ${result.source}`,
            relevanceScore: 0.7,
            mentionedByName: true,
            personMatch: 'confirmed',
            isRecent: true,
            searchEngine: result.searchEngine,
            dateConfidence: result.dateConfidence || null,
            dateSource: result.dateSource || null
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
            date: result.date || null,
            source: result.source || extractDomainFromUrl(result.url),
            description: result.snippet || result.title,
            relevanceScore: 0.6,
            searchEngine: result.searchEngine,
            dateConfidence: result.dateConfidence || null,
            dateSource: result.dateSource || null
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
            date: result.published_date || result.date || null,
            source: result.source || extractDomainFromUrl(result.url),
            description: validation.description,
            relevanceScore: validation.relevanceScore,
            mentionedByName: validation.mentionedByName,
            personMatch: validation.personMatch,
            isRecent: validation.isRecent,
            searchEngine: result.searchEngine,
            dateConfidence: result.dateConfidence || null,
            dateSource: result.dateSource || null
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
          date: result.published_date || result.date || null,
          source: result.source || extractDomainFromUrl(result.url),
          description: "Description unavailable due to validation error",
          relevanceScore: 0.5,
          searchEngine: result.searchEngine,
          dateConfidence: result.dateConfidence || null,
          dateSource: result.dateSource || null
        });
      }
    }

    console.log(`\nValidation complete: ${validatedResults.length}/${uniqueResults.length} results passed validation`);

    // Multi-signal date extraction pipeline
    console.log('\n=== Extracting publication dates (multi-signal pipeline) ===');
    let dateGeminiModel = null;
    if (hasGeminiApiKey) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      dateGeminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    }

    // Load persistent date cache to avoid re-requesting dates for known URLs
    const dateCache = loadDateCache();
    let dateCacheUpdated = false;

    for (const result of validatedResults) {
      const label = result.title.substring(0, 50);

      // Google News RSS results already have reliable dates from pubDate
      if (result.searchEngine === 'google-news-rss' && result.date) {
        result.dateConfidence = 'high';
        result.dateSource = 'rss-pubdate';
        console.log(`  ${label}... - RSS date: ${result.date}`);
        continue;
      }

      // Crossref event data results already have reliable dates
      if (result.searchEngine === 'crossref-events' && result.date) {
        result.dateConfidence = result.dateConfidence || 'high';
        result.dateSource = result.dateSource || 'crossref-api';
        console.log(`  ${label}... - Crossref date: ${result.date}`);
        continue;
      }

      // Skip if already has a plausible date (e.g. from source-specific extraction)
      if (result.date && isDatePlausible(result.date)) {
        result.dateConfidence = result.dateConfidence || 'medium';
        result.dateSource = result.dateSource || 'existing';
        console.log(`  ${label}... - keeping existing date: ${result.date}`);
        continue;
      }

      // Check persistent date cache before any extraction
      const cached = dateCache[result.url];
      if (cached && isDatePlausible(cached.date)) {
        result.date = cached.date;
        result.dateConfidence = cached.confidence || 'medium';
        result.dateSource = 'cache (' + (cached.source || 'unknown') + ')';
        console.log(`  ${label}... - cached date: ${cached.date}`);
        continue;
      }

      // Signal 0: Try extracting date from the URL path (instant, no network)
      const urlDate = extractDateFromUrl(result.url);
      if (urlDate && isDatePlausible(urlDate)) {
        result.date = urlDate;
        result.dateConfidence = 'medium';
        result.dateSource = 'url-path';
        dateCache[result.url] = { date: urlDate, confidence: 'medium', source: 'url-path' };
        dateCacheUpdated = true;
        console.log(`  ${label}... - URL path date: ${urlDate}`);
        continue;
      }

      // Signal 1: Try HTTP metadata extraction (fast, deterministic, no API cost)
      try {
        const httpDate = await extractDateFromHTTP(result.url);
        if (httpDate && isDatePlausible(httpDate.date)) {
          if (httpDate.confidence === 'high' || httpDate.confidence === 'medium') {
            result.date = httpDate.date;
            result.dateConfidence = httpDate.confidence;
            result.dateSource = httpDate.source;
            dateCache[result.url] = { date: httpDate.date, confidence: httpDate.confidence, source: httpDate.source };
            dateCacheUpdated = true;
            console.log(`  ${label}... - HTTP ${httpDate.confidence}-confidence date: ${httpDate.date} (${httpDate.source})`);
            continue;
          }
          // Low confidence — store but try Gemini too
          result.date = httpDate.date;
          result.dateConfidence = 'low';
          result.dateSource = httpDate.source;
        }
      } catch (e) {
        // HTTP extraction failed, continue to next signal
      }

      // Signal 2: Fall back to Gemini page-reading estimation (if no date yet or low confidence)
      if (dateGeminiModel && (!result.date || result.dateConfidence === 'low')) {
        try {
          const geminiDate = await extractPublicationDate(dateGeminiModel, result);
          if (geminiDate && isDatePlausible(geminiDate)) {
            result.date = geminiDate;
            result.dateConfidence = 'medium';
            result.dateSource = 'gemini-page-estimate';
            dateCache[result.url] = { date: geminiDate, confidence: 'medium', source: 'gemini-page-estimate' };
            dateCacheUpdated = true;
            console.log(`  ${label}... - Gemini page estimate: ${geminiDate}`);
          }
        } catch (error) {
          console.log(`  Failed Gemini date extraction for: ${label}...`);
        }
      }

      // Final plausibility check
      if (result.date && !isDatePlausible(result.date)) {
        console.log(`  ${label}... - date ${result.date} failed plausibility check, clearing`);
        result.date = null;
        result.dateConfidence = null;
        result.dateSource = null;
      }

      if (!result.date) {
        console.log(`  ${label}... - no date found`);
      }
    }

    // Save date cache if updated
    if (dateCacheUpdated) {
      saveDateCache(dateCache);
    }

    // Filter out results with no plausible date
    const datedResults = validatedResults.filter(r => {
      if (!r.date || !isDatePlausible(r.date)) {
        console.log(`Excluding result with no plausible date: ${r.title}`);
        return false;
      }
      return true;
    });

    console.log(`After date filtering: ${datedResults.length}/${validatedResults.length} results have plausible dates`);

    // Sort by date (newest first)
    datedResults.sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });

    // Limit to most recent/relevant 10 results
    const recentResults = datedResults.slice(0, 10);

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

  // Build skip patterns from config
  const githubUsername = config.social.github.username;
  const linkedinUsername = config.social.linkedin.username;
  const mastodonUsername = config.social.mastodon.username;
  const mastodonInstance = config.social.mastodon.instance;
  const orcidId = config.orcidId;
  const scholarId = config.scholarId;
  const oraProfileId = config.ora.researcherProfileId;

  // Skip self-authored Medium articles
  if (urlLower.includes(`medium.com/@${githubUsername}`) || urlLower.includes(`medium.com/%40${githubUsername}`)) {
    return true;
  }

  // Skip own profile pages and bio pages
  if (urlLower.includes(`${githubUsername}.github.io`) ||
      urlLower.includes(`orcid.org/${orcidId}`) ||
      urlLower.includes(`scholar.google.com/citations?user=${scholarId}`) ||
      urlLower.includes(`ora.uniurb.it/cris/rp/${oraProfileId}`)) {
    return true;
  }

  // Skip ResearchGate profile and all publication pages (they are paper pages, not news mentions)
  if (urlLower.includes(`researchgate.net/profile/${config.name.replace(' ', '-').toLowerCase()}`) ||
      urlLower.includes('researchgate.net/publication')) {
    return true;
  }

  // Skip academic repository pages that are just paper listings
  if (urlLower.includes('iris.') || urlLower.includes('/handle/11576/')) {
    return true;
  }

  // Skip LinkedIn profile
  if (urlLower.includes(`linkedin.com/in/${linkedinUsername}`)) {
    return true;
  }

  // Skip social media profiles (Mastodon, Twitter/X, BlueSky, etc.)
  if (urlLower.includes(`/@${mastodonUsername}`) ||
      urlLower.includes(`/${githubUsername}`) && (
        urlLower.includes('twitter.com') ||
        urlLower.includes('x.com') ||
        urlLower.includes('bsky.social') ||
        urlLower.includes('mastodon') ||
        urlLower.includes(mastodonInstance) ||
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

  // Skip institutional team/staff/people pages (not news mentions)
  const staffPagePattern = /\/(team|staff|people|faculty|docenti|personale)(\/|$|\?|#)/i;
  if (staffPagePattern.test(urlLower)) {
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

    // Check for duplicates using enhanced matching (URL normalization + title matching)
    const newEntries = resultsWithMetadata.filter(result =>
      !historicalLog.some(existing => areDuplicateMentions(existing, result))
    );

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
 * Check if a date is plausible for a web mention (not too far in the future or past)
 */
function isDatePlausible(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;

  const now = new Date();
  // Allow 1 day in the future (timezone tolerance)
  const maxFuture = new Date(now);
  maxFuture.setDate(maxFuture.getDate() + 1);
  // Reject dates more than 2 years in the past
  const maxPast = new Date(now);
  maxPast.setFullYear(maxPast.getFullYear() - 2);

  return date <= maxFuture && date >= maxPast;
}

/**
 * Extract a publication date from a URL path.
 * Many news/blog URLs encode dates like /2025/03/10/headline or /2025-12-12_en
 * Returns 'YYYY-MM-DD' or null.
 */
function extractDateFromUrl(urlString) {
  try {
    const urlPath = new URL(urlString).pathname;

    // Pattern 1: /YYYY/MM/DD/ in path (most common blog/news pattern)
    const slashDate = urlPath.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (slashDate) {
      const [, y, m, d] = slashDate;
      const candidate = `${y}-${m}-${d}`;
      if (!isNaN(new Date(candidate).getTime())) return candidate;
    }

    // Pattern 2: YYYY-MM-DD anywhere in path or query (e.g. /news/title-2025-12-12_en)
    const dashDate = urlString.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dashDate) {
      const [, y, m, d] = dashDate;
      const candidate = `${y}-${m}-${d}`;
      if (!isNaN(new Date(candidate).getTime())) return candidate;
    }

    // Pattern 3: /YYYYMMDD in path (compact format, e.g. /20250115-headline)
    const compactDate = urlPath.match(/\/(\d{4})(\d{2})(\d{2})[^\/\d]/);
    if (compactDate) {
      const [, y, m, d] = compactDate;
      const month = parseInt(m, 10);
      const day = parseInt(d, 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const candidate = `${y}-${m}-${d}`;
        if (!isNaN(new Date(candidate).getTime())) return candidate;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract publication date from a web page's HTML metadata
 * Returns { date: 'YYYY-MM-DD', confidence: 'high'|'medium'|'low', source: string } or null
 */
async function extractDateFromHTTP(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 5,
      // Limit response size to avoid downloading huge pages
      maxContentLength: 1024 * 1024
    });

    const $ = cheerio.load(response.data);

    // 1. Open Graph article:published_time (most reliable)
    const ogDate = $('meta[property="article:published_time"]').attr('content');
    if (ogDate) {
      const parsed = parseToYMD(ogDate);
      if (parsed) return { date: parsed, confidence: 'high', source: 'og-meta' };
    }

    // 2. JSON-LD datePublished
    const jsonLdScripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < jsonLdScripts.length; i++) {
      try {
        const jsonLd = JSON.parse($(jsonLdScripts[i]).html());
        const datePublished = extractJsonLdDate(jsonLd);
        if (datePublished) {
          const parsed = parseToYMD(datePublished);
          if (parsed) return { date: parsed, confidence: 'high', source: 'jsonld' };
        }
      } catch (e) {
        // Skip malformed JSON-LD
      }
    }

    // 3. Dublin Core and other meta tags
    const dcDate = $('meta[name="DC.date.issued"]').attr('content') ||
                   $('meta[name="dc.date.issued"]').attr('content') ||
                   $('meta[name="date"]').attr('content') ||
                   $('meta[name="pubdate"]').attr('content') ||
                   $('meta[name="publish-date"]').attr('content') ||
                   $('meta[property="article:modified_time"]').attr('content');
    if (dcDate) {
      const parsed = parseToYMD(dcDate);
      if (parsed) return { date: parsed, confidence: 'medium', source: 'meta-tag' };
    }

    // 4. <time datetime="..."> element
    const timeEl = $('time[datetime]').first().attr('datetime');
    if (timeEl) {
      const parsed = parseToYMD(timeEl);
      if (parsed) return { date: parsed, confidence: 'medium', source: 'time-element' };
    }

    // 5. HTTP Last-Modified header (least reliable)
    const lastModified = response.headers['last-modified'];
    if (lastModified) {
      const parsed = parseToYMD(lastModified);
      if (parsed) return { date: parsed, confidence: 'low', source: 'http-header' };
    }

    return null;
  } catch (error) {
    console.log(`  HTTP date extraction failed for ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Extract datePublished from a JSON-LD object (handles nested and array structures)
 */
function extractJsonLdDate(jsonLd) {
  if (!jsonLd) return null;
  if (Array.isArray(jsonLd)) {
    for (const item of jsonLd) {
      const date = extractJsonLdDate(item);
      if (date) return date;
    }
    return null;
  }
  if (jsonLd.datePublished) return jsonLd.datePublished;
  if (jsonLd['@graph']) return extractJsonLdDate(jsonLd['@graph']);
  return null;
}

/**
 * Parse various date formats to YYYY-MM-DD
 */
function parseToYMD(dateStr) {
  if (!dateStr) return null;
  try {
    // Handle YYYY-MM-DD directly
    const ymdMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    if (ymdMatch) {
      const d = new Date(ymdMatch[1]);
      if (!isNaN(d.getTime())) return ymdMatch[1];
    }
    // Try general parsing
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Load persistent date cache from disk.
 * Maps URL → { date, confidence, source }
 */
function loadDateCache() {
  const cachePath = path.join(__dirname, '../../public/data/websearch-date-cache.json');
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (e) {
    console.log('Could not load date cache, starting fresh');
  }
  return {};
}

/**
 * Save persistent date cache to disk.
 */
function saveDateCache(cache) {
  const cachePath = path.join(__dirname, '../../public/data/websearch-date-cache.json');
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    console.log(`Date cache saved (${Object.keys(cache).length} entries)`);
  } catch (e) {
    console.log(`Failed to save date cache: ${e.message}`);
  }
}

/**
 * Estimate publication date by asking Gemini to read the actual page content.
 * This is the last-resort signal — used only when URL, HTTP metadata, and
 * existing dates all failed.
 */
async function extractPublicationDate(model, result) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const prompt = `Visit and read this page, then estimate when it was published:

URL: ${result.url}
Title: "${result.title}"

Look at the page content for any clues about the publication date:
- A visible date near the title or byline
- Event dates mentioned in the content
- Copyright years or "last updated" notices
- Contextual clues (e.g., "this week", "in January 2025", conference dates)

RULES:
- Return ONLY the estimated date in YYYY-MM-DD format, nothing else.
- If the page mentions a specific date, use that.
- If only a month and year are mentioned, use the 1st of that month.
- If you truly cannot estimate any date, return "unknown".
- Do NOT return today's date (${todayStr}) as a default. Only return it if the page explicitly says it was published today.

Examples of valid responses:
2025-06-15
2024-11-01
unknown`;

    const response = await model.generateContent(prompt);
    const text = response.response.text().trim();

    // Validate date format
    const dateMatch = text.match(/^\d{4}-\d{2}-\d{2}$/);
    if (dateMatch) {
      const parsed = new Date(dateMatch[0]);
      if (isNaN(parsed.getTime())) {
        return null;
      }

      // Reject dates that are today or within the last 2 days — Gemini often
      // hallucinates the current date when it cannot find the real one.
      // Legitimate same-day articles will already have dates from HTTP metadata.
      const candidateDate = new Date(dateMatch[0]);
      const now = new Date();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      if (candidateDate >= twoDaysAgo) {
        console.log(`  Gemini returned near-today date ${dateMatch[0]}, likely hallucinated — rejecting`);
        return null;
      }

      return dateMatch[0];
    }

    return null;
  } catch (error) {
    console.log(`  Date extraction error: ${error.message}`);
    return null;
  }
}

/**
 * Validate a web mention using Gemini to verify relevance and generate description
 */
async function validateWebMention(model, result) {
  try {
    const prompt = `You are analyzing a web mention to determine if it's about the correct person, if it actually mentions them, and if the content is recent.

TARGET PERSON: ${config.name}
- ${config.title} at ${config.institution}
- Specializes in: ${config.expertise.join(', ')}

WEB MENTION TO ANALYZE:
Title: "${result.title}"
URL: ${result.url}
Source: ${result.source}
Context: ${result.snippet || 'No snippet available'}

CRITICAL VALIDATION STEPS:
1. MENTION VERIFICATION: Does this content actually mention "${config.name}" by name? Look carefully in the title, URL, and any available context.
2. PERSON IDENTIFICATION: If ${config.name} is mentioned, is it the ${config.title} at ${config.institution} (not a medical researcher or someone else)?
3. RECENCY CHECK: Is this content recent (within the last 6 months) or does it discuss recent work/events?
4. RELEVANCE ASSESSMENT: Does it relate to academic work in ${config.researchInterests.join(', ')}?

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
  * mentionedByName = true (${config.name} is explicitly mentioned)
  * personMatch = "confirmed" (it's the correct academic researcher)
  * isRecent = true (content is from the last 6 months or discusses recent work)
  * Content relates to research areas (${config.researchInterests.join(', ')})
  * Not a direct link to authored papers (we want third-party mentions)

- mentionedByName = true only if "${config.name}" appears in the title, URL, or context
- isRecent = true only if the content appears to be from the last 6 months or discusses recent events/research
- relevanceScore should be high (0.8-1.0) only for high-quality third-party mentions that clearly discuss the work

Be very strict - if you cannot confirm ${config.name} is mentioned by name, set isRelevant to false.

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
 * Fetch Crossref Event Data to find DOI-based mentions of publications
 */
async function fetchCrossrefEventData() {
  console.log('\n=== Fetching Crossref Event Data ===');

  const pubsPath = path.join(__dirname, '../../public/data/aggregated-publications.json');
  if (!fs.existsSync(pubsPath)) {
    console.log('No aggregated-publications.json found, skipping Crossref Event Data');
    return [];
  }

  let publications;
  try {
    const parsed = JSON.parse(fs.readFileSync(pubsPath, 'utf8'));
    publications = Array.isArray(parsed) ? parsed : parsed.publications || [];
  } catch (e) {
    console.log(`Failed to read aggregated publications: ${e.message}`);
    return [];
  }

  // Extract DOIs from top 20 publications (by citation count or recency)
  const dois = publications
    .filter(p => p.doi)
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
    .slice(0, 20)
    .map(p => p.doi);

  if (dois.length === 0) {
    console.log('No DOIs found in publications, skipping Crossref Event Data');
    return [];
  }

  console.log(`Querying Crossref Event Data for ${dois.length} DOIs`);

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromDate = sixMonthsAgo.toISOString().split('T')[0];
  const results = [];

  for (const doi of dois) {
    try {
      const apiUrl = `https://api.eventdata.crossref.org/v1/events?obj-id=${encodeURIComponent(doi)}&from-occurred-date=${fromDate}&rows=10&mailto=${config.email}`;

      const response = await axios.get(apiUrl, { timeout: 10000 });
      const events = response.data?.message?.events || [];

      for (const event of events) {
        // Only include web, newsfeed, and wikipedia sources
        const source = event['source_id'] || '';
        if (!['newsfeed', 'wikipedia', 'web'].includes(source)) continue;

        const subjectUrl = event['subj_id'] || '';
        const title = event['subj']?.['title'] || `Mention of DOI ${doi}`;

        if (!subjectUrl || shouldSkipResult(subjectUrl, title)) continue;

        const eventDate = event['occurred_at'] || event['timestamp'];
        const dateStr = eventDate ? parseToYMD(eventDate) : null;

        results.push({
          title: title,
          url: subjectUrl,
          snippet: `Mentions research paper (DOI: ${doi})`,
          date: dateStr,
          source: extractDomainFromUrl(subjectUrl),
          searchEngine: 'crossref-events',
          dateConfidence: 'high',
          dateSource: 'crossref-api'
        });
      }

      // Rate limiting: 500ms delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.log(`Crossref Event Data error for DOI ${doi}: ${error.message}`);
    }
  }

  console.log(`Crossref Event Data: Found ${results.length} events`);
  return results;
}

/**
 * Check if this is a medical/hematology result about a different person
 * vs. communication/internet studies about the configured person
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
 * Check if this is a direct link to an authored paper
 * vs. a discussion/mention of the work
 */
function isDirectPaperLink(title, url) {
  const namePattern = config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Check for direct paper patterns - titles that are just paper titles with the author
  const directPaperPatterns = [
    // Journal paper patterns
    new RegExp(`^[^:]+:\\s*.*${namePattern}.*,.*\\d{4}$`),  // "Journal: Title - Name, Author2, 2023"
    new RegExp(`^.*\\s-\\s.*${namePattern}.*,.*\\d{4}$`),    // "Title - Name, Author2, 2023"

    // Repository/database patterns
    new RegExp(`Rivisteweb:.*${namePattern}.*\\d{4}$`),    // Rivisteweb direct paper links
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
      title.includes(config.name) && !title.includes('discusses') &&
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

    const searchPrompt = `Search for recent NEWS ARTICLES and MEDIA COVERAGE that mention "${config.name}" from the past 6 months.

IMPORTANT CONTEXT:
- ${config.name} is a ${config.title} at ${config.institution}
- Specializes in: ${config.expertise.join(', ')}

WHAT TO FIND (prioritize these):
1. News articles from newspapers, magazines, or news websites that quote or mention this person
2. Media interviews, podcasts, or TV/radio appearances
3. Press coverage about research findings
4. Articles where journalists cite this person as an expert source
5. Conference or event announcements where this person is a speaker

WHAT TO EXCLUDE (do NOT include):
- Profile pages (ORCID, Google Scholar, ResearchGate, LinkedIn, personal website)
- Direct links to academic papers or publications
- Academic repository pages (IRIS, arXiv, SSRN)
- ResearchGate "Request PDF" pages
- Social media profile pages

For each NEWS result found, provide a JSON array with objects containing:
- title: The exact title of the news article
- url: The full URL (must be a real, direct URL)
- description: A brief description of the mention
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
                date: null,
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
 * Fetch Google News RSS feed for mentions
 * Uses exact-match query and fetches both Italian and English locale feeds
 */
async function fetchGoogleNewsRSS() {
  console.log('\n=== Fetching Google News RSS Feed ===');

  // Use exact-match quotes for more precise results
  const encodedName = encodeURIComponent(`"${config.name}"`).replace(/%20/g, '+');
  const feeds = [
    { url: `https://news.google.com/rss/search?q=${encodedName}&hl=it&gl=IT&ceid=IT:it`, locale: 'IT' },
    { url: `https://news.google.com/rss/search?q=${encodedName}&hl=en&gl=US&ceid=US:en`, locale: 'EN' }
  ];

  const allResults = [];

  for (const feed of feeds) {
    try {
      console.log(`Fetching Google News RSS (${feed.locale})...`);
      const response = await axios.get(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const xmlData = response.data;

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
          let dateStr = null;
          if (pubDate) {
            try {
              dateStr = new Date(pubDate).toISOString().split('T')[0];
            } catch (e) {
              // No date available
            }
          }

          // Only include recent results (last 2 years)
          if (dateStr && !isDatePlausible(dateStr)) {
            console.log(`Google News: Skipping old result (${dateStr}): ${title}`);
            continue;
          }

          allResults.push({
            title: decodeHtmlEntities(title),
            url: resolvedUrl,
            snippet: '',
            date: dateStr,
            source: source ? decodeHtmlEntities(source) : extractDomainFromUrl(resolvedUrl),
            searchEngine: 'google-news-rss'
          });
        }
      }
    } catch (error) {
      console.error(`Google News RSS fetch error (${feed.locale}):`, error.message);
    }
  }

  // Deduplicate across both feeds using normalized URL
  const seen = new Set();
  const uniqueResults = allResults.filter(r => {
    const key = normalizeUrl(r.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Google News RSS: Found ${uniqueResults.length} unique recent items (from ${allResults.length} total)`);
  return uniqueResults;
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
  name: 'websearch',
  _testing: {
    normalizeUrl,
    normalizeTitle,
    shouldSkipResult,
    isDatePlausible,
    extractDateFromHTTP,
    extractDateFromUrl,
    extractJsonLdDate,
    parseToYMD
  }
};

// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const axios = require('axios');
const yaml = require('js-yaml');
const { getGeminiClient, MODELS } = require('../helpers/gemini-client');
const linkedin = require('../helpers/linkedin-portability');

// Check for API keys
const hasMastodonKey = process.env.MASTODON_ACCESS_TOKEN;

// Check if running in GitHub Actions
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

/**
 * Collector for aggregating social media posts from LinkedIn, BlueSky, and Mastodon
 * with AI-powered deduplication and summarization
 */
async function collectSocialMediaPosts() {
  console.log('Starting social media aggregation...');
  
  try {
    let allPosts = [];
    const collectionResults = {
      linkedin: 0,
      bluesky: 0,
      mastodon: 0
    };

    // Collect posts from each platform
    console.log('Collecting LinkedIn posts...');
    const linkedinPosts = await collectLinkedInPosts();
    allPosts = [...allPosts, ...linkedinPosts];
    collectionResults.linkedin = linkedinPosts.length;

    console.log('Collecting BlueSky posts...');
    const blueskyPosts = await collectBlueSkyPosts();
    allPosts = [...allPosts, ...blueskyPosts];
    collectionResults.bluesky = blueskyPosts.length;

    console.log('Collecting Mastodon posts...');
    const mastodonPosts = await collectMastodonPosts();
    allPosts = [...allPosts, ...mastodonPosts];
    collectionResults.mastodon = mastodonPosts.length;

    console.log(`Collection summary: LinkedIn: ${collectionResults.linkedin}, BlueSky: ${collectionResults.bluesky}, Mastodon: ${collectionResults.mastodon}`);
    console.log(`Collected ${allPosts.length} total posts from all platforms`);

    // If no posts collected, save empty data
    if (allPosts.length === 0) {
      return await saveEmptyNews();
    }

    // Sort posts by date (newest first)
    allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Take only recent posts (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentPosts = allPosts.filter(post => 
      new Date(post.date) >= thirtyDaysAgo
    );

    console.log(`Filtered to ${recentPosts.length} posts from last 30 days`);

    // Deduplicate and summarize posts using AI
    const processedNews = await deduplicateAndSummarize(recentPosts);

    // Save to news.yml (overwriting any existing manual entries)
    // Use js-yaml to safely generate YAML and prevent injection attacks
    const outputPath = path.join(__dirname, '../../_data/news.yml');
    const yamlContent = yaml.dump(processedNews.map(item => ({
      date: String(item.date || ''),
      content: String(item.content || ''),
      url: String(item.url || ''),
      platforms: Array.isArray(item.platforms) ? item.platforms : [],
      ...(item.toread ? { toread: true } : {})
    })));

    await writeFileAsync(outputPath, yamlContent);
    console.log(`Successfully saved ${processedNews.length} news items to ${outputPath}`);

    return processedNews;
  } catch (error) {
    console.error('Error collecting social media posts:', error);
    return await saveEmptyNews();
  }
}

/**
 * Collect posts from LinkedIn via the Member Data Portability API.
 *
 * The ordinary post endpoints need r_member_social, which LinkedIn does not
 * grant to personal apps — see scripts/helpers/linkedin-portability.js.
 */
async function collectLinkedInPosts() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    console.log('LinkedIn access token not available, skipping LinkedIn posts');
    return [];
  }

  try {
    const { posts, stats } = await linkedin.fetchPublicPosts(token);
    console.log(
      `Found ${stats.kept} public LinkedIn posts (${stats.total} rows over ${stats.pages} pages; ` +
        `${stats.notPublic} not public, ${stats.notFeedPost} not feed posts, ` +
        `${stats.undated} undated, ${stats.empty} without text)`
    );
    console.log(`  LinkedIn visibility values: ${JSON.stringify(stats.byVisibility)}`);
    if (stats.pages === 0) {
      // LinkedIn answers 404 for a domain it has no data for. Seen live right
      // after a token is first issued: profile domains were served within
      // minutes while MEMBER_SHARE_INFO was still being built.
      warnLinkedIn('no post data available — the snapshot is not built yet, or has no posts');
    }
    if (stats.truncated) {
      warnLinkedIn('page limit reached before the end of the post history — recent posts may be missing');
    }

    const daysLeft = await linkedin.daysUntilExpiry(token, {
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET
    });
    if (daysLeft !== null && daysLeft <= linkedin.EXPIRY_WARNING_DAYS) {
      warnLinkedIn(`access token expires in ${daysLeft} day(s) — generate a new one (API_SETUP.md)`);
    }

    return posts;
  } catch (error) {
    warnLinkedIn(`posts not collected: ${linkedin.describeError(error)}`);
    return [];
  }
}

/**
 * LinkedIn problems never fail the run, so nothing else would surface them:
 * in Actions, raise a warning annotation on the run summary as well.
 */
function warnLinkedIn(message) {
  console.warn(`LinkedIn: ${message}`);
  if (isGitHubActions) {
    console.log(`::warning title=LinkedIn::${message}`);
  }
}

/**
 * Collect posts from BlueSky using AT Protocol
 */
async function collectBlueSkyPosts() {
  try {
    // BlueSky AT Protocol API
    const handle = 'fabiogiglietto.bsky.social';
    
    console.log('Collecting BlueSky posts...');
    
    // First, resolve the handle to get the DID
    const resolveResponse = await axios.get(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle`, {
      params: { handle },
      timeout: 10000 // 10 second timeout
    });
    
    const did = resolveResponse.data.did;
    console.log(`Resolved BlueSky handle ${handle} to DID: ${did}`);
    
    // Get the user's timeline/posts
    const postsResponse = await axios.get('https://bsky.social/xrpc/com.atproto.repo.listRecords', {
      params: {
        repo: did,
        collection: 'app.bsky.feed.post',
        limit: 20
      },
      timeout: 10000 // 10 second timeout
    });

    const posts = postsResponse.data.records || [];
    console.log(`Found ${posts.length} BlueSky posts`);
    
    return posts.map(post => ({
      id: post.uri,
      content: post.value.text || '',
      date: post.value.createdAt,
      platform: 'BlueSky',
      url: `https://bsky.app/profile/${handle}/post/${post.uri.split('/').pop()}`,
      originalData: post
    }));
  } catch (error) {
    console.error('Error collecting BlueSky posts:', error.message);
    if (error.code === 'ECONNABORTED') {
      console.log('BlueSky API request timed out');
    } else if (error.response?.status) {
      console.log(`BlueSky API returned status ${error.response.status}`);
    }
    return [];
  }
}

/**
 * Collect posts from Mastodon using Mastodon API
 */
async function collectMastodonPosts() {
  try {
    const instance = 'aoir.social';
    const username = 'fabiogiglietto';
    
    console.log('Collecting Mastodon posts...');
    
    // Get user ID first
    const searchResponse = await axios.get(`https://${instance}/api/v1/accounts/lookup`, {
      params: { acct: username },
      timeout: 10000 // 10 second timeout
    });
    
    const userId = searchResponse.data.id;
    console.log(`Found Mastodon user ID: ${userId}`);
    
    // Get user's statuses/posts
    const postsResponse = await axios.get(`https://${instance}/api/v1/accounts/${userId}/statuses`, {
      params: {
        limit: 20,
        exclude_replies: true,
        exclude_reblogs: true
      },
      headers: hasMastodonKey ? {
        'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`
      } : {},
      timeout: 10000 // 10 second timeout
    });

    const posts = postsResponse.data || [];
    console.log(`Found ${posts.length} Mastodon posts`);
    
    return posts.map(post => ({
      id: post.id,
      content: stripHtmlTags(post.content || ''),
      date: post.created_at,
      platform: 'Mastodon',
      url: post.url,
      originalData: post
    }));
  } catch (error) {
    console.error('Error collecting Mastodon posts:', error.message);
    if (error.code === 'ECONNABORTED') {
      console.log('Mastodon API request timed out');
    } else if (error.response?.status) {
      console.log(`Mastodon API returned status ${error.response.status}`);
      if (error.response.status === 404) {
        console.log('Mastodon user not found or instance unavailable');
      }
    }
    return [];
  }
}

/**
 * Deduplicate and summarize posts using Gemini
 */
async function deduplicateAndSummarize(posts) {
  try {
    const ai = getGeminiClient();
    if (!ai) {
      console.log('Gemini API key not available, using basic deduplication');
      return basicDeduplication(posts);
    }

    console.log('Using Gemini AI to deduplicate and summarize posts...');

    // Prepare posts for AI analysis
    // Detect #toread hashtag to distinguish shared papers from own contributions
    const postsForAnalysis = posts.map((post, index) => {
      const contentLower = (post.content || '').toLowerCase();
      const hasToread = contentLower.includes('#toread') ||
        (post.originalData?.tags || []).some(t => t.name?.toLowerCase() === 'toread');
      return {
        index,
        content: post.content.substring(0, 500), // Limit content length
        date: post.date,
        platform: post.platform,
        url: post.url,
        toread: hasToread
      };
    });

    const prompt = `You are helping to curate news updates for an academic researcher's website.

Analyze these social media posts from Prof. Fabio Giglietto and:

1. **FILTER**: Only include posts that are:
   - Research announcements or publications
   - Academic conference presentations or participation
   - Professional achievements or recognition
   - Important industry/academic news commentary
   - Collaboration announcements
   - Grant or funding news
   - Media interviews or expert commentary

2. **EXCLUDE**: Do not include posts that are:
   - Personal opinions without academic context
   - Casual social interactions
   - Jokes or informal content
   - Retweets/shares without substantial commentary
   - Very short posts (< 20 meaningful words)

3. **WRITING STYLE**: Create varied, engaging summaries that:
   - AVOID starting every item with "Professor Giglietto" or "Fabio Giglietto"
   - Use varied sentence structures and openings
   - Focus on the news/event itself, not who announced it
   - Write in third person but vary the subject
   - Use natural, journalistic language
   - Keep a professional academic tone

4. **PROCESS**: For included posts:
   - Group similar topics together
   - Create professional, third-person summaries
   - Keep most recent date for grouped topics

Posts to analyze:
${JSON.stringify(postsForAnalysis, null, 2)}

Note: Posts marked with "toread": true are papers/articles by other researchers that the professor is sharing (tagged with #toread). Preserve this flag in the output.

Return ONLY a JSON object (no markdown, no explanation) with a "news" property containing an array of professional news items in this format:
{
  "news": [
    {
      "content": "[Engaging summary focusing on the event/news itself, avoiding repetitive name mentions]",
      "date": "YYYY-MM-DD",
      "platforms": ["Platform1"],
      "url": "most_relevant_url",
      "toread": false
    }
  ]
}

Set "toread" to true if any of the source posts for that news item had "toread": true.

Example varied openings:
- "A third PhD scholarship has been announced..."
- "New research reveals..."
- "The PROMPT project released..."
- "A comprehensive guide for researchers..."
- "Coordinated inauthentic behavior was detected..."

Focus on quality over quantity. Return only 3-5 most significant academic/professional updates.
Respond with valid JSON only, no other text.`;

    const result = await ai.models.generateContent({
      model: MODELS.FLASH,
      contents: prompt,
      config: {
        // Deduplicating and rewriting a short list of posts — bounded work,
        // so cap thinking (billed as output) and the response length.
        thinkingConfig: { thinkingLevel: 'low' },
        maxOutputTokens: 2000,
      },
    });
    const aiResponse = result.text || '';
    console.log('AI response received, length:', aiResponse?.length);

    try {
      // Clean the response in case there's extra text
      let cleanResponse = aiResponse?.trim();

      // Remove markdown code blocks if present
      cleanResponse = cleanResponse.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      
      // If the response is wrapped in a JSON object, extract the array
      let parsed = JSON.parse(cleanResponse);
      
      // If the response is an object with an array property, extract it
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Look for common array property names
        const arrayKeys = ['items', 'news', 'posts', 'updates', 'results'];
        for (const key of arrayKeys) {
          if (Array.isArray(parsed[key])) {
            parsed = parsed[key];
            break;
          }
        }
        // If no array found in properties, convert object values to array
        if (!Array.isArray(parsed)) {
          const values = Object.values(parsed);
          if (values.length > 0 && values.every(v => v && typeof v === 'object' && v.content)) {
            parsed = values;
          }
        }
      }
      
      // Ensure we have an array
      if (!Array.isArray(parsed)) {
        throw new Error('AI response is not an array');
      }
      
      console.log(`AI processed ${parsed.length} unique news items`);
      return parsed;
      
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError.message);
      console.error('Raw AI response:', aiResponse?.substring(0, 500) + '...');
      console.log('Falling back to basic deduplication...');
      return basicDeduplication(posts);
    }

  } catch (error) {
    console.error('Error in AI deduplication:', error.message);
    return basicDeduplication(posts);
  }
}

/**
 * Basic deduplication fallback when AI is not available
 */
function basicDeduplication(posts) {
  console.log('Using basic deduplication...');
  
  // Filter for professional content keywords
  const professionalKeywords = [
    'research', 'publication', 'paper', 'study', 'conference', 
    'presentation', 'academic', 'university', 'journal', 'analysis',
    'data', 'social media', 'misinformation', 'algorithm', 'methodology',
    'findings', 'results', 'collaboration', 'grant', 'interview',
    'expert', 'policy', 'technology', 'innovation', 'science'
  ];
  
  // Simple deduplication by similar content with professional filtering
  const uniquePosts = [];
  const seenContent = new Set();
  
  for (const post of posts) {
    const contentLower = post.content.toLowerCase();
    const contentKey = contentLower
      .replace(/[^\w\s]/g, '')
      .substring(0, 100);
    
    // Check if content has professional keywords
    const hasProfessionalContent = professionalKeywords.some(keyword => 
      contentLower.includes(keyword)
    );
    
    // Filter for meaningful, professional content
    if (!seenContent.has(contentKey) && 
        post.content.length > 30 && 
        (hasProfessionalContent || post.content.includes('http'))) {
      seenContent.add(contentKey);
      
      // Clean up content for professional presentation
      let cleanContent = post.content;
      if (cleanContent.length > 150) {
        cleanContent = cleanContent.substring(0, 150) + '...';
      }
      
      const hasToread = contentLower.includes('#toread') ||
        (post.originalData?.tags || []).some(t => t.name?.toLowerCase() === 'toread');
      uniquePosts.push({
        content: cleanContent,
        date: post.date.split('T')[0],
        platforms: [post.platform],
        url: post.url,
        ...(hasToread ? { toread: true } : {})
      });
    }
  }
  
  return uniquePosts.slice(0, 3); // Limit to 3 most relevant items
}

/**
 * Helper functions
 */
function stripHtmlTags(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

async function saveEmptyNews() {
  const outputPath = path.join(__dirname, '../../_data/news.yml');
  await writeFileAsync(outputPath, '# No recent social media updates available\n');
  console.log('Saved empty news data');
  return [];
}

module.exports = {
  collect: collectSocialMediaPosts,
  name: 'social-media-aggregator'
};
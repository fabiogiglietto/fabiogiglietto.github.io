// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const yaml = require('js-yaml');

// Check for API keys
const hasGeminiKey = !!process.env.GEMINI_API_KEY;
const hasLinkedInKey = process.env.LINKEDIN_ACCESS_TOKEN;
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
      platforms: Array.isArray(item.platforms) ? item.platforms : []
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
 * Collect posts from LinkedIn using LinkedIn API
 */
async function collectLinkedInPosts() {
  try {
    console.log('Collecting LinkedIn posts...');
    
    if (!hasLinkedInKey) {
      console.log('LinkedIn access token not available, skipping LinkedIn posts');
      console.log('Note: LinkedIn has severely restricted API access for personal posts in 2024.');
      console.log('Consider using manual post data or alternative social media platforms.');
      return [];
    }

    if (!process.env.LINKEDIN_PERSON_ID) {
      console.log('LinkedIn Person ID not set. Run "node scripts/helpers/get-linkedin-person-id.js" to get your Person ID');
      return [];
    }

    console.log('Attempting to access LinkedIn API...');
    
    try {
      // First verify profile access with current scopes
      const profileResponse = await axios.get('https://api.linkedin.com/v2/people/~', {
        headers: {
          'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });
      
      console.log('✓ LinkedIn profile access successful');
      console.log(`  Profile ID: ${profileResponse.data.id}`);
      
      // Try multiple API endpoints for posts (LinkedIn has changed these frequently)
      const postEndpoints = [
        // Current Posts API (requires specific permissions)
        {
          url: 'https://api.linkedin.com/v2/posts',
          params: {
            q: 'authors',
            authors: `List(urn:li:person:${process.env.LINKEDIN_PERSON_ID})`,
            sortBy: 'LAST_MODIFIED',
            count: 20
          },
          name: 'Posts API v2'
        },
        // Alternative UGC Posts endpoint (may still work for some apps)
        {
          url: 'https://api.linkedin.com/v2/ugcPosts',
          params: {
            q: 'authors',
            authors: `List(urn:li:person:${process.env.LINKEDIN_PERSON_ID})`,
            sortBy: 'LAST_MODIFIED',
            count: 20
          },
          name: 'UGC Posts API'
        },
        // Shares endpoint (legacy but might work)
        {
          url: 'https://api.linkedin.com/v2/shares',
          params: {
            q: 'owners',
            owners: `urn:li:person:${process.env.LINKEDIN_PERSON_ID}`,
            count: 20
          },
          name: 'Shares API'
        }
      ];

      for (const endpoint of postEndpoints) {
        try {
          console.log(`Trying ${endpoint.name}...`);
          
          const postsResponse = await axios.get(endpoint.url, {
            headers: {
              'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
              'X-Restli-Protocol-Version': '2.0.0'
            },
            params: endpoint.params,
            timeout: 10000
          });

          const posts = postsResponse.data.elements || [];
          if (posts.length > 0) {
            console.log(`✓ Found ${posts.length} LinkedIn posts via ${endpoint.name}`);
            
            return posts.map((post, index) => ({
              id: post.id || `linkedin_${Date.now()}_${index}`,
              content: extractLinkedInContent(post),
              date: extractLinkedInDate(post),
              platform: 'LinkedIn',
              url: constructLinkedInUrl(post),
              originalData: post
            }));
          } else {
            console.log(`  ${endpoint.name}: No posts returned`);
          }
          
        } catch (endpointError) {
          console.log(`  ${endpoint.name} failed: ${endpointError.response?.status || endpointError.message}`);
          
          if (endpointError.response?.status === 403) {
            console.log(`  → This endpoint requires additional LinkedIn permissions`);
          } else if (endpointError.response?.status === 422) {
            console.log(`  → Invalid parameters for this endpoint`);
          }
        }
      }
      
      // If all endpoints fail, provide helpful guidance
      console.log('\n⚠️  LinkedIn API Limitations Detected:');
      console.log('   LinkedIn has significantly restricted API access for personal posts in 2024.');
      console.log('   Options to consider:');
      console.log('   1. Apply for LinkedIn Marketing Developer Platform access');
      console.log('   2. Use manual post entry in _data/news.yml');
      console.log('   3. Focus on other social platforms (BlueSky, Mastodon) that have better API access');
      console.log('   4. Use RSS feeds if available for your LinkedIn profile');
      
      return [];
      
    } catch (profileError) {
      console.error('LinkedIn profile access failed:', profileError.response?.status || profileError.message);
      
      if (profileError.response?.status === 401) {
        console.log('→ Access token expired or invalid. Please re-run LinkedIn OAuth setup.');
      } else if (profileError.response?.status === 403) {
        console.log('→ Insufficient permissions. Your LinkedIn app may need approval for additional scopes.');
      }
      
      return [];
    }
    
  } catch (error) {
    console.error('Error in LinkedIn posts collection:', error.message);
    return [];
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
    if (!hasGeminiKey) {
      console.log('Gemini API key not available, using basic deduplication');
      return basicDeduplication(posts);
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
    });

    console.log('Using Gemini AI to deduplicate and summarize posts...');

    // Prepare posts for AI analysis
    const postsForAnalysis = posts.map((post, index) => ({
      index,
      content: post.content.substring(0, 500), // Limit content length
      date: post.date,
      platform: post.platform,
      url: post.url
    }));

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

Return ONLY a JSON object (no markdown, no explanation) with a "news" property containing an array of professional news items in this format:
{
  "news": [
    {
      "content": "[Engaging summary focusing on the event/news itself, avoiding repetitive name mentions]",
      "date": "YYYY-MM-DD",
      "platforms": ["Platform1"],
      "url": "most_relevant_url"
    }
  ]
}

Example varied openings:
- "A third PhD scholarship has been announced..."
- "New research reveals..."
- "The PROMPT project released..."
- "A comprehensive guide for researchers..."
- "Coordinated inauthentic behavior was detected..."

Focus on quality over quantity. Return only 3-5 most significant academic/professional updates.
Respond with valid JSON only, no other text.`;

    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();
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
      
      uniquePosts.push({
        content: cleanContent,
        date: post.date.split('T')[0],
        platforms: [post.platform],
        url: post.url
      });
    }
  }
  
  return uniquePosts.slice(0, 3); // Limit to 3 most relevant items
}

/**
 * Helper functions
 */
function extractLinkedInContent(post) {
  // Extract text content from LinkedIn post structure
  if (post.text && post.text.text) {
    return post.text.text;
  }
  if (post.commentary) {
    return post.commentary;
  }
  if (post.specificContent && post.specificContent.com && post.specificContent.com.linkedin && post.specificContent.com.linkedin.ugc && post.specificContent.com.linkedin.ugc.ShareContent && post.specificContent.com.linkedin.ugc.ShareContent.shareCommentary && post.specificContent.com.linkedin.ugc.ShareContent.shareCommentary.text) {
    return post.specificContent.com.linkedin.ugc.ShareContent.shareCommentary.text;
  }
  return 'LinkedIn post content';
}

function extractLinkedInDate(post) {
  // Try different date field formats that LinkedIn uses
  if (post.created && post.created.time) {
    return new Date(post.created.time).toISOString();
  }
  if (post.createdAt) {
    return new Date(post.createdAt).toISOString();
  }
  if (post.lastModified && post.lastModified.time) {
    return new Date(post.lastModified.time).toISOString();
  }
  if (post.createdTime) {
    return new Date(post.createdTime).toISOString();
  }
  // Fallback to current date
  return new Date().toISOString();
}

function constructLinkedInUrl(post) {
  // Try to construct a proper LinkedIn URL
  if (post.id) {
    // Extract activity ID from various LinkedIn ID formats
    let activityId = post.id;
    if (activityId.includes('urn:li:activity:')) {
      activityId = activityId.replace('urn:li:activity:', '');
    }
    if (activityId.includes('urn:li:share:')) {
      activityId = activityId.replace('urn:li:share:', '');
    }
    return `https://linkedin.com/posts/fabiogiglietto_${activityId}`;
  }
  // Fallback to profile URL
  return 'https://linkedin.com/in/fabiogiglietto';
}

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
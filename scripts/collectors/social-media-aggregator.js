// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const axios = require('axios');
const OpenAI = require('openai');

// Check for API keys
const hasOpenAIKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-');
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
    const outputPath = path.join(__dirname, '../../_data/news.yml');
    const yamlContent = processedNews.map(item => 
      `- date: "${item.date}"\n  content: "${item.content}"\n  url: "${item.url || ''}"\n  platforms: ${JSON.stringify(item.platforms)}`
    ).join('\n\n') + '\n';

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
    if (!hasLinkedInKey) {
      console.log('LinkedIn access token not available, skipping LinkedIn posts');
      return [];
    }

    if (!process.env.LINKEDIN_PERSON_ID) {
      console.log('LinkedIn Person ID not set. Run "node scripts/helpers/get-linkedin-person-id.js" to get your Person ID');
      return [];
    }

    // LinkedIn API endpoint for user posts
    // Note: This requires LinkedIn API access and proper authentication
    const response = await axios.get('https://api.linkedin.com/v2/shares', {
      headers: {
        'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        'X-Restli-Protocol-Version': '2.0.0'
      },
      params: {
        q: 'owners',
        owners: 'urn:li:person:' + process.env.LINKEDIN_PERSON_ID,
        count: 20
      }
    });

    const posts = response.data.elements || [];
    return posts.map(post => ({
      id: post.id,
      content: extractLinkedInContent(post),
      date: new Date(post.created.time).toISOString(),
      platform: 'LinkedIn',
      url: `https://linkedin.com/posts/fabiogiglietto_${post.id}`,
      originalData: post
    }));
  } catch (error) {
    console.error('Error collecting LinkedIn posts:', error.message);
    if (error.response?.status === 401) {
      console.log('LinkedIn API authentication failed. Please check your access token.');
    }
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
 * Deduplicate and summarize posts using OpenAI
 */
async function deduplicateAndSummarize(posts) {
  try {
    if (!hasOpenAIKey) {
      console.log('OpenAI API key not available, using basic deduplication');
      return basicDeduplication(posts);
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    console.log('Using AI to deduplicate and summarize posts...');

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

Return a JSON object with a "news" property containing an array of professional news items in this format:
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

Focus on quality over quantity. Return only 3-5 most significant academic/professional updates.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing and summarizing academic social media content. You must return ONLY a valid JSON array, no other text."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const aiResponse = response.choices[0]?.message?.content;
    console.log('AI response received, length:', aiResponse?.length);
    
    try {
      // Clean the response in case there's extra text
      let cleanResponse = aiResponse?.trim();
      
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
  return post.commentary || 'LinkedIn post content';
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

module.exports = collectSocialMediaPosts;
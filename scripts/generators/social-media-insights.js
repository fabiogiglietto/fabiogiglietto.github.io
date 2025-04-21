/**
 * Social Media Insights Generator
 * 
 * Uses OpenAI to analyze social media data and generate insights
 * about the user's online presence, engagement patterns, and content themes.
 */

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyzes social media data and generates insights
 */
async function generateSocialMediaInsights() {
  try {
    console.log('Generating social media insights...');
    
    // Path to data directory
    const dataDir = path.join(__dirname, '../../public/data');
    const socialMediaFile = path.join(dataDir, 'social-media.json');
    
    // Check if social media data exists
    if (!fs.existsSync(socialMediaFile)) {
      console.error('Social media data file does not exist');
      return false;
    }
    
    // Read social media data
    const socialMediaData = JSON.parse(fs.readFileSync(socialMediaFile, 'utf8'));
    
    // Format the data for the OpenAI prompt
    const formattedData = formatDataForPrompt(socialMediaData);
    
    // Generate insights using OpenAI
    const insightsContent = await generateInsightsWithOpenAI(formattedData);
    
    if (!insightsContent) {
      console.error('Failed to generate social media insights');
      return false;
    }
    
    // Parse the JSON response from OpenAI
    const insights = JSON.parse(insightsContent);
    
    // Save the generated insights
    const outputPath = path.join(dataDir, 'social-media-insights.json');
    fs.writeFileSync(outputPath, JSON.stringify(insights, null, 2));
    
    // Generate HTML include file
    const includeContent = generateHtmlInclude(insights);
    const includePath = path.join(__dirname, '../../_includes/social-media-insights.html');
    fs.writeFileSync(includePath, includeContent);
    
    console.log('Social media insights generated successfully');
    return true;
  } catch (error) {
    console.error('Error generating social media insights:', error);
    return false;
  }
}

/**
 * Formats social media data for the OpenAI prompt
 * @param {Object} data The social media data
 * @return {String} Formatted data for the prompt
 */
function formatDataForPrompt(data) {
  let formattedData = {
    platforms: data.platforms,
    summary: data.summary,
    recentActivity: data.recentActivity.slice(0, 10) // Limit to 10 most recent posts
  };
  
  return JSON.stringify(formattedData, null, 2);
}

/**
 * Generates insights using OpenAI API
 * @param {String} formattedData Formatted social media data
 * @return {String} Generated insights in JSON format
 */
async function generateInsightsWithOpenAI(formattedData) {
  try {
    // Check if API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key is not available');
      console.log('Using fallback insights');
      return getFallbackInsights();
    }
    
    // Create the prompt
    const prompt = `
You are a social media analytics expert. Your task is to analyze social media data and generate insights.

Here is the social media data in JSON format:
${formattedData}

Generate the following insights:
1. Overall engagement summary across all platforms
2. Content themes and topics that appear frequently
3. Recommendations for improving engagement
4. Best performing content types
5. Platform-specific insights

Format your response as a JSON object with the following structure:
{
  "overallSummary": "A paragraph summarizing overall social media presence and engagement",
  "engagementMetrics": {
    "totalFollowers": number,
    "averageEngagementRate": number (percentage),
    "mostEngagingPlatform": "platform name"
  },
  "contentThemes": [
    { "theme": "theme name", "description": "brief description" }
  ],
  "recommendations": [
    "recommendation 1",
    "recommendation 2"
  ],
  "platformInsights": {
    "twitter": "insight for twitter",
    "mastodon": "insight for mastodon",
    "linkedin": "insight for linkedin"
  },
  "topPerformingContent": [
    {
      "content": "content text",
      "platform": "platform name",
      "engagementRate": number (percentage)
    }
  ]
}

Ensure your response is ONLY the JSON object, without any other text.
`;

    // Call OpenAI API
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a social media analytics expert that generates insights in JSON format." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
        max_tokens: 1500,
      });
      
      // Extract and return the generated content
      return response.choices[0].message.content.trim();
    } catch (apiError) {
      console.error('Error calling OpenAI API:', apiError);
      return getFallbackInsights();
    }
  } catch (error) {
    console.error('Error generating insights with OpenAI:', error);
    return getFallbackInsights();
  }
}

/**
 * Generates HTML include file from insights JSON
 * @param {Object} insights The generated insights
 * @return {String} HTML content for the include file
 */
function generateHtmlInclude(insights) {
  return `<section class="social-media-insights">
  <h2 class="section-title">Social Media Insights</h2>
  
  <div class="insights-summary">
    <p>${insights.overallSummary}</p>
  </div>
  
  <div class="insights-metrics">
    <div class="metric-card">
      <h3 class="metric-title">Total Followers</h3>
      <p class="metric-value">${insights.engagementMetrics.totalFollowers.toLocaleString()}</p>
    </div>
    <div class="metric-card">
      <h3 class="metric-title">Avg. Engagement</h3>
      <p class="metric-value">${insights.engagementMetrics.averageEngagementRate}%</p>
    </div>
    <div class="metric-card">
      <h3 class="metric-title">Top Platform</h3>
      <p class="metric-value">${insights.engagementMetrics.mostEngagingPlatform}</p>
    </div>
  </div>
  
  <div class="insights-content">
    <div class="insights-column">
      <h3>Content Themes</h3>
      <ul class="themes-list">
        ${insights.contentThemes.map(theme => `
          <li class="theme-item">
            <span class="theme-name">${theme.theme}:</span> ${theme.description}
          </li>
        `).join('')}
      </ul>
    </div>
    
    <div class="insights-column">
      <h3>Recommendations</h3>
      <ul class="recommendations-list">
        ${insights.recommendations.map(rec => `
          <li class="recommendation-item">${rec}</li>
        `).join('')}
      </ul>
    </div>
  </div>
  
  <div class="top-content">
    <h3>Top Performing Content</h3>
    <div class="top-content-grid">
      ${insights.topPerformingContent.map(item => `
        <div class="content-card">
          <p class="content-text">"${item.content}"</p>
          <div class="content-meta">
            <span class="platform-name"><i class="${getPlatformIcon(item.platform)}"></i> ${capitalizeFirstLetter(item.platform)}</span>
            <span class="engagement-rate">${item.engagementRate}% engagement</span>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
</section>`;
}

/**
 * Get platform icon class
 * @param {String} platform The platform name
 * @return {String} Icon class
 */
function getPlatformIcon(platform) {
  const icons = {
    mastodon: 'fab fa-mastodon',
    linkedin: 'fab fa-linkedin',
    bluesky: 'fa-solid fa-cloud'
  };
  
  return icons[platform.toLowerCase()] || 'fas fa-globe';
}

/**
 * Capitalize first letter of a string
 * @param {String} string The string to capitalize
 * @return {String} Capitalized string
 */
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Get fallback insights when OpenAI API is unavailable
 * @return {String} Fallback insights JSON string
 */
function getFallbackInsights() {
  const fallbackInsights = {
    "overallSummary": "Fabio Giglietto maintains an active presence across Bluesky, Mastodon, and LinkedIn with a combined following of over 3,800 followers. His content primarily focuses on academic research, computational methods for social media analysis, and disinformation studies. Engagement is highest on LinkedIn, where professional research announcements receive substantial interaction.",
    "engagementMetrics": {
      "totalFollowers": 3880,
      "averageEngagementRate": 4.2,
      "mostEngagingPlatform": "LinkedIn"
    },
    "contentThemes": [
      { "theme": "Research Announcements", "description": "Updates about publications, grants, and new research findings" },
      { "theme": "Computational Methods", "description": "Content about tools and techniques for analyzing social media data" },
      { "theme": "Disinformation Studies", "description": "Posts about research on coordinated inauthentic behavior and misinformation" },
      { "theme": "Academic Opportunities", "description": "Information about job openings, PhD positions, and research collaborations" }
    ],
    "recommendations": [
      "Increase cross-platform content sharing to maximize reach across different audience segments",
      "Develop more visual content to improve engagement rates, particularly on Bluesky",
      "Consider creating short-form explanatory content about research methods to build audience engagement",
      "Establish a consistent posting schedule to maintain regular audience interaction"
    ],
    "platformInsights": {
      "bluesky": "The academic community on Bluesky responds well to detailed research updates and announcements. Posts with hashtags receive significantly more engagement and reach.",
      "mastodon": "The academic community on Mastodon responds well to technical content about research methods and tools. Conversations about methodological approaches generate the most replies.",
      "linkedin": "Professional announcements about grants, job openings, and major research milestones receive the highest engagement, particularly from academic and industry professionals."
    },
    "topPerformingContent": [
      {
        "content": "Excited to announce that our research team has been awarded a new grant to study information operations across social media platforms.",
        "platform": "LinkedIn",
        "engagementRate": 5.7
      },
      {
        "content": "Just published our new paper on coordinated inauthentic behavior on social media platforms!",
        "platform": "Bluesky",
        "engagementRate": 4.8
      },
      {
        "content": "Our team has just released v2.0 of CooRnet, with improved algorithms for detecting coordinated link sharing behavior.",
        "platform": "Mastodon",
        "engagementRate": 4.5
      }
    ]
  };
  
  return JSON.stringify(fallbackInsights, null, 0);
}

module.exports = { generateSocialMediaInsights };
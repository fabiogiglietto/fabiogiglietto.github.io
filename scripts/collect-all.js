/**
 * Main data collection script that runs all collectors
 * 
 * This script imports and executes all the individual data collectors
 * and handles error logging and data saving.
 */

// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Import all collectors
const orcidCollector = require('./collectors/orcid');
const scholarCollector = require('./collectors/scholar');
const universityCollector = require('./collectors/university');
const githubCollector = require('./collectors/github');
const newsCollector = require('./collectors/news');
const webSearchCollector = require('./collectors/websearch');
const socialMediaCollector = require('./collectors/social-media');
const socialMediaAggregator = require('./collectors/social-media-aggregator');
const wosCollector = require('./collectors/wos');
const scopusCollector = require('./collectors/scopus');
const semanticScholarCollector = require('./collectors/semantic-scholar');
const publicationsAggregator = require('./collectors/publications-aggregator');
const toreadCollector = require('./collectors/toread');

// Import generators
const aboutGenerator = require('./generators/about-generator');
const teachingGenerator = require('./generators/teaching-generator');
const socialMediaInsightsGenerator = require('./generators/social-media-insights');
const publicationsGenerator = require('./generators/publications-generator');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../public/data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Run all collectors and save data
async function collectAll() {
  try {
    console.log('Starting data collection...');
    
    // Check if running in GitHub Actions to manage verbose warnings
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    const hasOpenAIKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-');
    
    // Show API setup status once at the beginning
    if (isGitHubActions) {
      console.log('Running in GitHub Actions environment');
      console.log('API keys status:');
      console.log(`- OpenAI API key: ${hasOpenAIKey ? 'Available' : 'Missing'}`);
      console.log(`- Web of Science API key: ${process.env.WOS_API_KEY ? 'Available' : 'Missing'}`);
      console.log(`- Scopus API key: ${process.env.SCOPUS_API_KEY ? 'Available' : 'Missing'}`);
      console.log(`- Semantic Scholar API key: ${process.env.S2_API_KEY ? 'Available' : 'Missing'}`);
    }
    
    // Run all collectors in parallel with quiet error handling
    const [orcidData, scholarData, universityData, githubData, newsData, webSearchData, socialMediaData, wosData, scopusData, semanticScholarData, aggregatedPublicationsData, toreadData] = await Promise.all([
      orcidCollector.collect().catch(err => {
        console.error('ORCID collection error:', err.message);
        return null;
      }),
      scholarCollector.collect().catch(err => {
        console.error('Scholar collection error:', err.message);
        return null;
      }),
      universityCollector.collect().catch(err => {
        console.error('University collection error:', err.message);
        return null;
      }),
      githubCollector.collect().catch(err => {
        console.error('GitHub collection error:', err.message);
        return null;
      }),
      newsCollector.collect().catch(err => {
        console.error('News collection error:', err.message);
        return null;
      }),
      webSearchCollector().catch(err => {
        // Don't show detailed errors for OpenAI when not in GitHub Actions
        if (!isGitHubActions && err.message.includes('OpenAI')) {
          console.log('Web Search requires OpenAI API key, using mock data');
        } else {
          console.error('Web Search collection error:', err.message);
        }
        return null;
      }),
      socialMediaCollector.collect().catch(err => {
        console.error('Social Media collection error:', err.message);
        return null;
      }),
      wosCollector.collect().catch(err => {
        // Only show detailed WoS errors in GitHub Actions
        if (isGitHubActions) {
          console.error('Web of Science collection error:', err.message);
        }
        return null;
      }),
      scopusCollector.collect().catch(err => {
        // Only show detailed Scopus errors in GitHub Actions
        if (isGitHubActions) {
          console.error('Scopus collection error:', err.message);
        }
        return null;
      }),
      semanticScholarCollector.collect().catch(err => {
        // Only show detailed Semantic Scholar errors in GitHub Actions
        if (isGitHubActions) {
          console.error('Semantic Scholar collection error:', err.message);
        }
        return null;
      }),
      publicationsAggregator.collect().catch(err => {
        console.error('Publications aggregation error:', err.message);
        return null;
      }),
      toreadCollector.collect().catch(err => {
        console.error('Toread collection error:', err.message);
        return null;
      })
    ]);
    
    // Save all collected data
    if (orcidData) fs.writeFileSync(path.join(dataDir, 'orcid.json'), JSON.stringify(orcidData, null, 2));
    if (scholarData) fs.writeFileSync(path.join(dataDir, 'scholar.json'), JSON.stringify(scholarData, null, 2));
    if (universityData) fs.writeFileSync(path.join(dataDir, 'university.json'), JSON.stringify(universityData, null, 2));
    if (githubData) fs.writeFileSync(path.join(dataDir, 'github.json'), JSON.stringify(githubData, null, 2));
    if (newsData) fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(newsData, null, 2));
    if (webSearchData) {
      fs.writeFileSync(path.join(dataDir, 'websearch.json'), JSON.stringify(webSearchData, null, 2));
      // Also copy to Jekyll _data directory for site.data.websearch access
      fs.writeFileSync(path.join(__dirname, '../_data/websearch.json'), JSON.stringify(webSearchData, null, 2));
    }
    if (socialMediaData) fs.writeFileSync(path.join(dataDir, 'social-media.json'), JSON.stringify(socialMediaData, null, 2));
    if (wosData) fs.writeFileSync(path.join(dataDir, 'wos.json'), JSON.stringify(wosData, null, 2));
    if (scopusData) fs.writeFileSync(path.join(dataDir, 'scopus.json'), JSON.stringify(scopusData, null, 2));
    if (semanticScholarData) fs.writeFileSync(path.join(dataDir, 'semantic-scholar.json'), JSON.stringify(semanticScholarData, null, 2));
    if (aggregatedPublicationsData) fs.writeFileSync(path.join(dataDir, 'aggregated-publications.json'), JSON.stringify(aggregatedPublicationsData, null, 2));
    if (toreadData) {
      fs.writeFileSync(path.join(dataDir, 'toread.json'), JSON.stringify(toreadData, null, 2));
      // Also copy to Jekyll _data directory for site.data.toread access
      fs.writeFileSync(path.join(__dirname, '../_data/toread.json'), JSON.stringify(toreadData, null, 2));
    }
    
    // Create a summary file with collection timestamp
    const summary = {
      lastUpdated: new Date().toISOString(),
      collections: {
        orcid: !!orcidData,
        scholar: !!scholarData,
        university: !!universityData,
        github: !!githubData,
        news: !!newsData,
        websearch: !!webSearchData,
        socialMedia: !!socialMediaData,
        wos: !!wosData,
        scopus: !!scopusData,
        semanticScholar: !!semanticScholarData,
        aggregatedPublications: !!aggregatedPublicationsData,
        toread: !!toreadData
      }
    };
    
    fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify(summary, null, 2));
    
    console.log('Data collection completed successfully');
    
    // Update News & Updates section with social media content
    try {
      console.log('Aggregating social media posts for News & Updates...');
      await socialMediaAggregator();
      console.log('Social media aggregation completed successfully');
    } catch (socialError) {
      console.error('Error aggregating social media posts:', socialError.message);
      // Continue execution even if social media aggregation fails
    }
    
    // Generate About Me section using OpenAI
    try {
      const aboutGenerated = await aboutGenerator.generateAboutMe();
      if (aboutGenerated) {
        console.log('About Me section generated successfully');
      } else {
        console.log('About Me section generation skipped or failed');
      }
    } catch (genError) {
      console.error('Error generating About Me section:', genError);
      // Continue execution even if the generation fails
    }
    
    // Generate Teaching data
    try {
      const teachingGenerated = await teachingGenerator.generateTeachingData();
      if (teachingGenerated) {
        console.log('Teaching data generated successfully');
      } else {
        console.log('Teaching data generation skipped or failed');
      }
    } catch (genError) {
      console.error('Error generating teaching data:', genError);
      // Continue execution even if the generation fails
    }
    
    // Generate Social Media Insights
    try {
      const insightsGenerated = await socialMediaInsightsGenerator.generateSocialMediaInsights();
      if (insightsGenerated) {
        console.log('Social media insights generated successfully');
      } else {
        console.log('Social media insights generation skipped or failed');
      }
    } catch (genError) {
      console.error('Error generating social media insights:', genError);
      // Continue execution even if the generation fails
    }
    
    // Generate Publications Data from Scholar
    try {
      const publicationsGenerated = await publicationsGenerator.generatePublicationsData();
      if (publicationsGenerated) {
        console.log('Publications data generated successfully');
      } else {
        console.log('Publications data generation skipped or failed');
      }
    } catch (genError) {
      console.error('Error generating publications data:', genError);
      // Continue execution even if the generation fails
    }
  } catch (error) {
    console.error('Error in data collection process:', error);
    process.exit(1);
  }
}

// Run the collection process
collectAll();
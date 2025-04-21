/**
 * Main data collection script that runs all collectors
 * 
 * This script imports and executes all the individual data collectors
 * and handles error logging and data saving.
 */

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
const wosCollector = require('./collectors/wos');
const scopusCollector = require('./collectors/scopus');
const publicationsAggregator = require('./collectors/publications-aggregator');

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
    
    // Run all collectors in parallel
    const [orcidData, scholarData, universityData, githubData, newsData, webSearchData, socialMediaData, wosData, scopusData, aggregatedPublicationsData] = await Promise.all([
      orcidCollector.collect().catch(err => {
        console.error('ORCID collection error:', err);
        return null;
      }),
      scholarCollector.collect().catch(err => {
        console.error('Scholar collection error:', err);
        return null;
      }),
      universityCollector.collect().catch(err => {
        console.error('University collection error:', err);
        return null;
      }),
      githubCollector.collect().catch(err => {
        console.error('GitHub collection error:', err);
        return null;
      }),
      newsCollector.collect().catch(err => {
        console.error('News collection error:', err);
        return null;
      }),
      webSearchCollector().catch(err => {
        console.error('Web Search collection error:', err);
        return null;
      }),
      socialMediaCollector.collect().catch(err => {
        console.error('Social Media collection error:', err);
        return null;
      }),
      wosCollector.collect().catch(err => {
        console.error('Web of Science collection error:', err);
        return null;
      }),
      scopusCollector.collect().catch(err => {
        console.error('Scopus collection error:', err);
        return null;
      }),
      publicationsAggregator.collect().catch(err => {
        console.error('Publications aggregation error:', err);
        return null;
      })
    ]);
    
    // Save all collected data
    if (orcidData) fs.writeFileSync(path.join(dataDir, 'orcid.json'), JSON.stringify(orcidData, null, 2));
    if (scholarData) fs.writeFileSync(path.join(dataDir, 'scholar.json'), JSON.stringify(scholarData, null, 2));
    if (universityData) fs.writeFileSync(path.join(dataDir, 'university.json'), JSON.stringify(universityData, null, 2));
    if (githubData) fs.writeFileSync(path.join(dataDir, 'github.json'), JSON.stringify(githubData, null, 2));
    if (newsData) fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(newsData, null, 2));
    if (webSearchData) fs.writeFileSync(path.join(dataDir, 'websearch.json'), JSON.stringify(webSearchData, null, 2));
    if (socialMediaData) fs.writeFileSync(path.join(dataDir, 'social-media.json'), JSON.stringify(socialMediaData, null, 2));
    if (wosData) fs.writeFileSync(path.join(dataDir, 'wos.json'), JSON.stringify(wosData, null, 2));
    if (scopusData) fs.writeFileSync(path.join(dataDir, 'scopus.json'), JSON.stringify(scopusData, null, 2));
    if (aggregatedPublicationsData) fs.writeFileSync(path.join(dataDir, 'aggregated-publications.json'), JSON.stringify(aggregatedPublicationsData, null, 2));
    
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
        aggregatedPublications: !!aggregatedPublicationsData
      }
    };
    
    fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify(summary, null, 2));
    
    console.log('Data collection completed successfully');
    
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
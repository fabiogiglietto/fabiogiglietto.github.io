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
    const [orcidData, scholarData, universityData, githubData, newsData] = await Promise.all([
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
      })
    ]);
    
    // Save all collected data
    if (orcidData) fs.writeFileSync(path.join(dataDir, 'orcid.json'), JSON.stringify(orcidData, null, 2));
    if (scholarData) fs.writeFileSync(path.join(dataDir, 'scholar.json'), JSON.stringify(scholarData, null, 2));
    if (universityData) fs.writeFileSync(path.join(dataDir, 'university.json'), JSON.stringify(universityData, null, 2));
    if (githubData) fs.writeFileSync(path.join(dataDir, 'github.json'), JSON.stringify(githubData, null, 2));
    if (newsData) fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(newsData, null, 2));
    
    // Create a summary file with collection timestamp
    const summary = {
      lastUpdated: new Date().toISOString(),
      collections: {
        orcid: !!orcidData,
        scholar: !!scholarData,
        university: !!universityData,
        github: !!githubData,
        news: !!newsData
      }
    };
    
    fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify(summary, null, 2));
    
    console.log('Data collection completed successfully');
  } catch (error) {
    console.error('Error in data collection process:', error);
    process.exit(1);
  }
}

// Run the collection process
collectAll();
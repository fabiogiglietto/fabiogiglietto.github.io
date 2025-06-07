#!/usr/bin/env node

/**
 * Last Run Checker
 * 
 * This script checks the timestamp of the last data collection
 * and provides insights into whether the scheduled workflow is working.
 */

const fs = require('fs');
const path = require('path');

function checkLastRun() {
  console.log('\n' + '='.repeat(60));
  console.log('🕒 Last Data Collection Check');
  console.log('='.repeat(60));
  
  const dataDir = path.join(__dirname, '../../public/data');
  const files = [
    'summary.json',
    'semantic-scholar.json',
    'aggregated-publications.json',
    'scholar.json',
    'orcid.json'
  ];
  
  console.log('\n📁 Data File Timestamps:\n');
  
  const timestamps = [];
  
  files.forEach(file => {
    const filePath = path.join(dataDir, file);
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const lastUpdated = data.lastUpdated || data.timestamp || stats.mtime.toISOString();
        
        console.log(`✅ ${file.padEnd(25)} ${lastUpdated}`);
        timestamps.push(new Date(lastUpdated));
      } else {
        console.log(`❌ ${file.padEnd(25)} File not found`);
      }
    } catch (error) {
      console.log(`⚠️  ${file.padEnd(25)} Error reading file`);
    }
  });
  
  if (timestamps.length > 0) {
    const mostRecent = new Date(Math.max(...timestamps));
    const hoursAgo = (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60);
    
    console.log('\n📊 Analysis:');
    console.log('=============');
    console.log(`Most recent update: ${mostRecent.toISOString()}`);
    console.log(`Hours ago: ${hoursAgo.toFixed(1)}`);
    
    if (hoursAgo < 2) {
      console.log('✅ Recent data - workflow likely working');
    } else if (hoursAgo < 25) {
      console.log('🕒 Data from today - normal for daily schedule');
    } else if (hoursAgo < 49) {
      console.log('⚠️  Data from yesterday - check if workflow ran');
    } else {
      console.log('❌ Old data - workflow may have issues');
    }
  }
  
  // Check if Semantic Scholar data exists
  const s2Path = path.join(dataDir, 'semantic-scholar.json');
  if (fs.existsSync(s2Path)) {
    try {
      const s2Data = JSON.parse(fs.readFileSync(s2Path, 'utf8'));
      console.log('\n📚 Semantic Scholar Status:');
      console.log(`   Publications: ${s2Data.publications?.length || 0}`);
      console.log(`   Profile: ${s2Data.profile?.name || 'Unknown'}`);
      console.log(`   Last updated: ${s2Data.lastUpdated || 'Unknown'}`);
    } catch (error) {
      console.log('\n⚠️  Semantic Scholar data file exists but has issues');
    }
  } else {
    console.log('\n❌ Semantic Scholar data not found');
    console.log('   This is expected until the next workflow run with S2_API_KEY');
  }
  
  console.log('\n🔄 Next Steps:');
  console.log('===============');
  console.log('1. Ensure S2_API_KEY is added to GitHub Secrets');
  console.log('2. Wait for next scheduled run (daily at midnight UTC)');
  console.log('3. Or manually trigger via Actions tab');
  console.log('4. Check Actions tab for any error messages');
  
  console.log('\n📅 Workflow Schedule:');
  console.log('   • Runs daily at 00:00 UTC');
  console.log('   • Manual trigger available in Actions tab');
  console.log('   • Look for "Update Website Data" workflow');
  
  console.log('\n='.repeat(60) + '\n');
}

if (require.main === module) {
  checkLastRun();
}

module.exports = { checkLastRun };
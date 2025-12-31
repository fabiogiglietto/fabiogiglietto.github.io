/**
 * Test script for Web of Science API integration
 */
require('dotenv').config();
const wosCollector = require('./scripts/collectors/wos');
const fs = require('fs');

async function testWosApi() {
  console.log('Testing Web of Science API integration...');
  console.log('API Key available:', process.env.WOS_API_KEY ? 'Yes' : 'No');
  
  try {
    const result = await wosCollector.collect();
    console.log('Web of Science API test completed');
    console.log(`Retrieved ${result.publications.length} publications`);
    
    // Display citation metrics
    console.log('\nCitation Metrics:');
    console.log(`Total Citations: ${result.metrics.citationCount}`);
    console.log(`Document Count: ${result.metrics.documentCount}`);
    console.log(`h-index: ${result.metrics.hIndex}`);
    
    // Display top publications by citation count
    console.log('\nTop Publications by Citation Count:');
    const topPubs = [...result.publications].sort((a, b) => b.citations - a.citations).slice(0, 5);
    topPubs.forEach((pub, index) => {
      console.log(`[${index + 1}] ${pub.title} (${pub.year}) - Citations: ${pub.citations}`);
      console.log(`    Authors: ${pub.authors}`);
      console.log(`    Venue: ${pub.venue}`);
      console.log('');
    });
    
    // Save the result to a test file for inspection
    fs.writeFileSync('./wos-test-result.json', JSON.stringify(result, null, 2));
    console.log('\nFull results saved to wos-test-result.json');
  } catch (error) {
    console.error('Error testing Web of Science API:', error);
  }
}

testWosApi();
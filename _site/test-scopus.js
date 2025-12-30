/**
 * Test script for Scopus API integration
 * 
 * This script tests the Scopus API collector and displays detailed results
 * about publications, citation metrics, and publication years.
 * 
 * Troubleshooting Scopus API issues:
 * 1. Ensure your API key is valid and active
 * 2. Verify that your API key has permission to access Scopus Search API
 * 3. Check if your institution has a valid Scopus subscription
 * 4. If you have an institution token, add it to .env as SCOPUS_INSTTOKEN
 * 5. Ensure your institution's IP range is registered with Scopus (for IP-based auth)
 * 6. Try running this test from your institution's network if possible
 */
require('dotenv').config();
const scopusCollector = require('./scripts/collectors/scopus');
const fs = require('fs');

async function testScopusApi() {
  console.log('==== Scopus API Integration Test ====');
  
  // Check environment setup
  const apiKeyMasked = process.env.SCOPUS_API_KEY 
    ? `${process.env.SCOPUS_API_KEY.substring(0, 4)}...${process.env.SCOPUS_API_KEY.substring(process.env.SCOPUS_API_KEY.length - 4)}`
    : 'Not available';
  console.log(`API Key: ${apiKeyMasked}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Running on GitHub Actions: ${process.env.GITHUB_ACTIONS ? 'Yes' : 'No'}`);
  console.log('\nFetching data from Scopus...');
  
  const startTime = Date.now();
  
  try {
    // Run the collector
    const result = await scopusCollector.collect();
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Scopus API test completed in ${elapsedTime} seconds`);
    console.log(`Retrieved ${result.publications.length} publications`);
    console.log(`Using ${result.publications.length === 3 ? 'mock' : 'live'} data`);
    
    // Display citation metrics
    console.log('\n==== Citation Metrics ====');
    console.log(`Total Citations: ${result.metrics.citationCount}`);
    console.log(`Document Count: ${result.metrics.documentCount}`);
    console.log(`h-index: ${result.metrics.hIndex}`);
    
    // Display publication year distribution
    console.log('\n==== Publications by Year ====');
    const yearCounts = {};
    result.publications.forEach(pub => {
      if (pub.year) {
        yearCounts[pub.year] = (yearCounts[pub.year] || 0) + 1;
      }
    });
    Object.keys(yearCounts).sort().forEach(year => {
      console.log(`  ${year}: ${yearCounts[year]} publications`);
    });
    
    // Display top publications by citation count
    console.log('\n==== Top Publications by Citation Count ====');
    const topPubs = [...result.publications].sort((a, b) => b.citations - a.citations).slice(0, 5);
    topPubs.forEach((pub, index) => {
      console.log(`[${index + 1}] ${pub.title} (${pub.year}) - Citations: ${pub.citations}`);
      console.log(`    Authors: ${pub.authors}`);
      console.log(`    Venue: ${pub.venue}`);
      console.log(`    DOI: ${pub.doi || 'N/A'}`);
      console.log('');
    });
    
    // Validate data integrity
    console.log('\n==== Data Integrity Check ====');
    const missingFields = [];
    result.publications.forEach(pub => {
      if (!pub.title) missingFields.push('title');
      if (!pub.authors) missingFields.push('authors');
      if (!pub.year) missingFields.push('year');
      if (!pub.venue) missingFields.push('venue');
    });
    
    if (missingFields.length > 0) {
      console.warn(`Some publications are missing fields: ${[...new Set(missingFields)].join(', ')}`);
    } else {
      console.log('All publications have required fields (title, authors, year, venue)');
    }
    
    // Save the result to a test file for inspection
    fs.writeFileSync('./scopus-test-result.json', JSON.stringify(result, null, 2));
    console.log('\nFull results saved to scopus-test-result.json');
  } catch (error) {
    console.error('Error testing Scopus API:', error);
  }
}

testScopusApi();
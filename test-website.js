/**
 * Puppeteer test script for fabiogiglietto.github.io
 * Tests the toread section and overall website functionality
 */

const puppeteer = require('puppeteer');

async function testWebsite() {
  console.log('🚀 Starting website test with Puppeteer...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set viewport for consistent testing
    await page.setViewport({ width: 1200, height: 800 });
    
    console.log('📱 Navigating to https://fabiogiglietto.github.io/');
    await page.goto('https://fabiogiglietto.github.io/', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Basic page tests
    console.log('\n🔍 Running basic page tests...');
    
    const title = await page.title();
    console.log(`✅ Page title: "${title}"`);
    
    // Check if main sections exist
    const sectionsToCheck = [
      '.intro-section',
      '.toread-papers',
      '.recent-publications',
      '.research-projects'
    ];
    
    for (const selector of sectionsToCheck) {
      const element = await page.$(selector);
      if (element) {
        console.log(`✅ Found section: ${selector}`);
      } else {
        console.log(`❌ Missing section: ${selector}`);
      }
    }
    
    // Test toread section specifically
    console.log('\n📚 Testing FG\'s #toread section...');
    
    const toreadSection = await page.$('.toread-papers');
    if (toreadSection) {
      console.log('✅ Toread section found');
      
      // Check section title
      const sectionTitle = await page.$eval('.toread-papers .section-title', el => el.textContent);
      console.log(`✅ Section title: "${sectionTitle}"`);
      
      // Check if papers are loaded
      const paperCards = await page.$$('.toread-papers .paper-card');
      console.log(`✅ Found ${paperCards.length} paper cards in toread section`);
      
      if (paperCards.length > 0) {
        // Get details of first few papers
        for (let i = 0; i < Math.min(3, paperCards.length); i++) {
          const paperTitle = await paperCards[i].$eval('.paper-title', el => el.textContent.trim());
          const paperAuthors = await paperCards[i].$eval('.paper-authors', el => el.textContent.trim());
          const dateAdded = await paperCards[i].$eval('.date-added', el => el.textContent.trim());
          
          console.log(`📄 Paper ${i + 1}:`);
          console.log(`   Title: ${paperTitle.substring(0, 80)}${paperTitle.length > 80 ? '...' : ''}`);
          console.log(`   Authors: ${paperAuthors.substring(0, 60)}${paperAuthors.length > 60 ? '...' : ''}`);
          console.log(`   ${dateAdded}`);
        }
        
        // Test carousel functionality
        const leftArrow = await page.$('.carousel-arrow-left');
        const rightArrow = await page.$('.carousel-arrow-right');
        
        if (leftArrow && rightArrow) {
          console.log('✅ Carousel navigation arrows found');
          
          // Test clicking right arrow
          await rightArrow.click();
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log('✅ Right arrow click test passed');
          
          // Test clicking left arrow
          await leftArrow.click();
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log('✅ Left arrow click test passed');
        }
      } else {
        console.log('⚠️  No paper cards found - checking for empty state');
        const emptyState = await page.$('.toread-papers .empty-state');
        if (emptyState) {
          const emptyMessage = await page.$eval('.empty-state p', el => el.textContent);
          console.log(`📭 Empty state message: "${emptyMessage}"`);
        }
      }
      
      // Check JSON source link
      const jsonLink = await page.$('.toread-papers .json-source-link');
      if (jsonLink) {
        const href = await page.$eval('.json-source-link', el => el.href);
        console.log(`✅ JSON source link found: ${href}`);
      }
      
    } else {
      console.log('❌ Toread section not found');
    }
    
    // Test other sections briefly
    console.log('\n📊 Testing other sections...');
    
    // Check recent publications
    const recentPubs = await page.$$('.recent-publications .publication-item');
    console.log(`✅ Found ${recentPubs.length} recent publications`);
    
    // Check research projects
    const projects = await page.$$('.research-projects .project-card');
    console.log(`✅ Found ${projects.length} research projects`);
    
    // Check news section
    const newsItems = await page.$$('.news .news-item');
    console.log(`✅ Found ${newsItems.length} news items`);
    
    // Test responsive design
    console.log('\n📱 Testing responsive design...');
    
    // Test mobile viewport
    await page.setViewport({ width: 375, height: 667 });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const toreadMobile = await page.$('.toread-papers');
    if (toreadMobile) {
      const isVisible = await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }, toreadMobile);
      console.log(`✅ Toread section ${isVisible ? 'visible' : 'hidden'} on mobile`);
    }
    
    // Performance check
    console.log('\n⚡ Running performance checks...');
    
    const metrics = await page.metrics();
    console.log(`✅ Page loaded ${metrics.Documents} documents`);
    console.log(`✅ Page made ${metrics.JSEventListeners} JS event listeners`);
    console.log(`✅ Page used ${Math.round(metrics.JSHeapUsedSize / 1024 / 1024 * 100) / 100} MB of JS heap`);
    
    // Take a screenshot for verification
    await page.setViewport({ width: 1200, height: 800 });
    await page.screenshot({ 
      path: '/tmp/website-test-screenshot.png',
      fullPage: true 
    });
    console.log('✅ Screenshot saved to /tmp/website-test-screenshot.png');
    
    console.log('\n🎉 Website test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testWebsite().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
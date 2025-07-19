/**
 * Quick test to verify latest paper is showing on live site
 */

const puppeteer = require('puppeteer');

async function testLatestPaper() {
  console.log('🔍 Testing for latest paper on live site...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto('https://fabiogiglietto.github.io/', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Check for the latest paper
    const latestPaperTitle = await page.$eval('.toread-papers .paper-card:first-child .paper-title', 
      el => el.textContent.trim()
    );
    
    const latestPaperDate = await page.$eval('.toread-papers .paper-card:first-child .date-added', 
      el => el.textContent.trim()
    );
    
    console.log(`📄 Latest paper: "${latestPaperTitle}"`);
    console.log(`📅 Date: ${latestPaperDate}`);
    
    // Check total paper count
    const paperCount = await page.$$eval('.toread-papers .paper-card', cards => cards.length);
    console.log(`📊 Total papers displayed: ${paperCount}`);
    
    // Check if it's the expected paper
    if (latestPaperTitle.includes('Demystifying hashtag hijacking')) {
      console.log('✅ Latest paper is correctly displayed!');
      
      if (latestPaperDate.includes('Jul 15, 2025')) {
        console.log('✅ Date is correct: July 15, 2025');
      } else {
        console.log(`⚠️  Expected July 15, 2025 but got: ${latestPaperDate}`);
      }
    } else {
      console.log('❌ Latest paper not found');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testLatestPaper();
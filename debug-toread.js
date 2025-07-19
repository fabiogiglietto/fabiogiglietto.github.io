/**
 * Debug toread section to see what's happening with paper display
 */

const puppeteer = require('puppeteer');

async function debugToread() {
  console.log('🔍 Debugging toread section display...');
  
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
    
    // Check toread section structure
    console.log('\n📚 Checking toread section structure...');
    
    const toreadExists = await page.$('.toread-papers');
    console.log(`✅ Toread section exists: ${!!toreadExists}`);
    
    if (toreadExists) {
      // Check carousel container
      const carouselExists = await page.$('.papers-carousel-container');
      console.log(`✅ Carousel container exists: ${!!carouselExists}`);
      
      const carousel = await page.$('.papers-carousel');
      console.log(`✅ Carousel exists: ${!!carousel}`);
      
      // Count paper cards
      const paperCards = await page.$$('.toread-papers .paper-card');
      console.log(`📊 Total paper cards found: ${paperCards.length}`);
      
      if (paperCards.length > 0) {
        console.log('\n📄 Paper details:');
        for (let i = 0; i < Math.min(5, paperCards.length); i++) {
          try {
            const title = await paperCards[i].$eval('.paper-title', el => el.textContent.trim());
            const authors = await paperCards[i].$eval('.paper-authors', el => el.textContent.trim());
            console.log(`${i + 1}. "${title.substring(0, 60)}..." - ${authors.substring(0, 40)}...`);
          } catch (e) {
            console.log(`${i + 1}. Error reading paper ${i + 1}: ${e.message}`);
          }
        }
      }
      
      // Check carousel CSS and visibility
      console.log('\n🎨 Checking CSS and visibility...');
      
      const carouselStyle = await page.evaluate(() => {
        const carousel = document.querySelector('.papers-carousel');
        if (!carousel) return 'Carousel not found';
        
        const style = window.getComputedStyle(carousel);
        return {
          display: style.display,
          overflow: style.overflow,
          width: style.width,
          height: style.height,
          transform: style.transform
        };
      });
      
      console.log('Carousel styles:', carouselStyle);
      
      // Check if papers are hidden by CSS
      const visibleCards = await page.evaluate(() => {
        const cards = document.querySelectorAll('.paper-card');
        let visible = 0;
        cards.forEach(card => {
          const style = window.getComputedStyle(card);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            visible++;
          }
        });
        return { total: cards.length, visible };
      });
      
      console.log(`👁️  Cards visibility: ${visibleCards.visible} visible out of ${visibleCards.total} total`);
      
      // Check for JavaScript errors
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });
      
      // Wait a moment for any errors
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (errors.length > 0) {
        console.log('\n❌ JavaScript errors found:');
        errors.forEach(error => console.log(`   ${error}`));
      } else {
        console.log('\n✅ No JavaScript errors detected');
      }
      
      // Check carousel indicators
      const indicators = await page.$$('.carousel-indicators .indicator');
      console.log(`🔘 Carousel indicators found: ${indicators.length}`);
      
    } else {
      console.log('❌ Toread section not found');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await browser.close();
  }
}

debugToread();
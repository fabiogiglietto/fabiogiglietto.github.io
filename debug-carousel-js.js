/**
 * Debug carousel JavaScript functionality
 */

const puppeteer = require('puppeteer');

async function debugCarouselJS() {
  console.log('🔍 Debugging carousel JavaScript...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Listen for console messages
    page.on('console', msg => {
      console.log(`🖥️  Console ${msg.type()}: ${msg.text()}`);
    });
    
    // Listen for errors
    page.on('pageerror', error => {
      console.log(`❌ Page error: ${error.message}`);
    });
    
    await page.goto('https://fabiogiglietto.github.io/', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for carousel initialization
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check carousel JavaScript state
    const carouselDebug = await page.evaluate(() => {
      const carousel = document.getElementById('papersCarousel');
      const indicators = document.getElementById('carouselIndicators');
      const leftArrow = document.querySelector('.carousel-arrow-left');
      const rightArrow = document.querySelector('.carousel-arrow-right');
      
      if (!carousel) return { error: 'Carousel not found' };
      
      const cards = carousel.querySelectorAll('.paper-card');
      const visibleCards = [];
      const hiddenCards = [];
      
      cards.forEach((card, index) => {
        const style = window.getComputedStyle(card);
        if (style.display === 'none') {
          hiddenCards.push(index);
        } else {
          visibleCards.push(index);
        }
      });
      
      return {
        totalCards: cards.length,
        visibleCards: visibleCards,
        hiddenCards: hiddenCards.length,
        indicatorsFound: !!indicators,
        indicatorsCount: indicators ? indicators.children.length : 0,
        leftArrowFound: !!leftArrow,
        rightArrowFound: !!rightArrow,
        leftArrowDisabled: leftArrow ? leftArrow.disabled : null,
        rightArrowDisabled: rightArrow ? rightArrow.disabled : null
      };
    });
    
    console.log('\n🎯 Carousel JavaScript Debug Results:');
    console.log('Total cards:', carouselDebug.totalCards);
    console.log('Visible cards:', carouselDebug.visibleCards);
    console.log('Hidden cards count:', carouselDebug.hiddenCards);
    console.log('Indicators found:', carouselDebug.indicatorsFound);
    console.log('Indicators count:', carouselDebug.indicatorsCount);
    console.log('Left arrow found:', carouselDebug.leftArrowFound);
    console.log('Right arrow found:', carouselDebug.rightArrowFound);
    console.log('Left arrow disabled:', carouselDebug.leftArrowDisabled);
    console.log('Right arrow disabled:', carouselDebug.rightArrowDisabled);
    
    // Test arrow click
    console.log('\n🖱️  Testing arrow clicks...');
    
    const clickResult = await page.evaluate(() => {
      const rightArrow = document.querySelector('.carousel-arrow-right');
      if (rightArrow && !rightArrow.disabled) {
        rightArrow.click();
        
        // Check visibility after click
        const carousel = document.getElementById('papersCarousel');
        const cards = carousel.querySelectorAll('.paper-card');
        const visibleAfterClick = [];
        
        cards.forEach((card, index) => {
          const style = window.getComputedStyle(card);
          if (style.display !== 'none') {
            visibleAfterClick.push(index);
          }
        });
        
        return {
          clicked: true,
          visibleAfterClick: visibleAfterClick
        };
      }
      return { clicked: false, reason: 'Arrow not found or disabled' };
    });
    
    console.log('Right arrow click result:', clickResult);
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    await browser.close();
  }
}

debugCarouselJS();
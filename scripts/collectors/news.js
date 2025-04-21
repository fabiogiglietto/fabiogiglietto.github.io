/**
 * News data collector
 * 
 * Fetches recent news mentions or publications
 */

const axios = require('axios');
const cheerio = require('cheerio');

async function collect() {
  console.log('Collecting News data...');
  
  // This is an example - you would replace this with actual sources relevant to the profile
  const sources = [
    {
      name: 'University News',
      url: 'https://example.edu/news',
      searchTerm: 'Fabio Giglietto'
    },
    {
      name: 'Research Blog',
      url: 'https://example.edu/blog',
      searchTerm: 'Fabio Giglietto'
    }
  ];
  
  try {
    // Collect news from all sources
    const newsItems = await Promise.all(
      sources.map(async (source) => {
        try {
          const response = await axios.get(source.url);
          const $ = cheerio.load(response.data);
          
          // Search for mentions - this is a simplified example
          // Adjust the selectors based on the actual website structure
          const items = [];
          $('article, .news-item').each((i, element) => {
            const content = $(element).text();
            
            // Check if the search term appears in the content
            if (content.includes(source.searchTerm)) {
              items.push({
                title: $(element).find('h2, .title').text().trim(),
                date: $(element).find('.date, time').text().trim(),
                summary: $(element).find('.summary, p').first().text().trim(),
                url: $(element).find('a').attr('href'),
                source: source.name
              });
            }
          });
          
          return items;
        } catch (error) {
          console.warn(`Error fetching news from ${source.name}:`, error.message);
          return [];
        }
      })
    );
    
    // Flatten the array of arrays and sort by date (most recent first)
    const allNews = newsItems
      .flat()
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return {
      news: allNews,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching News data:', error.message);
    throw error;
  }
}

module.exports = { collect };
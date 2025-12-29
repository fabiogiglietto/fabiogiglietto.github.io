/**
 * News data collector
 * 
 * Fetches recent news mentions or publications
 */

const axios = require('axios');
const cheerio = require('cheerio');

async function collect() {
  console.log('Collecting News data...');
  
  // News sources to search for mentions
  const sources = [
    {
      name: 'University News',
      url: 'https://www.uniurb.it/novita-ed-eventi/notizie',
      searchTerm: 'Fabio Giglietto'
    },
    {
      name: 'Research Blog',
      url: 'https://news.google.com/topics/CAAqKAgKIiJDQkFTRXdvTkwyY3ZNVEZtTUhvMmJtc3phaElDYVhRb0FBUAE?ceid=IT:it&oc=3',
      searchTerm: 'Fabio Giglietto'
    },
    {
      name: 'Threads',
      url: 'https://www.threads.net/@fabiogiglietto',
      searchTerm: ''
    },
    {
      name: 'LinkedIn',
      url: 'https://www.linkedin.com/in/fabiogiglietto/',
      searchTerm: ''
    },
    {
      name: 'Mastodon',
      url: 'https://aoir.social/@fabiogiglietto',
      searchTerm: ''
    },
    {
      name: 'BlueSky',
      url: 'https://bsky.app/profile/fabiogiglietto.bsky.social',
      searchTerm: ''
    }
  ];
  
  try {
    // Collect news from all sources
    const newsItems = await Promise.all(
      sources.map(async (source) => {
        try {
          // Use a common browser user agent
          const response = await axios.get(source.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml',
              'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 10000 // 10 second timeout
          });
          const $ = cheerio.load(response.data);
          
          // Search for mentions or get posts
          // Adjust the selectors based on the actual website structure
          const items = [];
          
          // For social media profiles, collect posts without searching for terms
          if (source.searchTerm === '') {
            // Social media profiles - collect posts directly
            let selector = 'article, .post, .feed-item';
            
            // Platform-specific selectors
            if (source.name === 'Threads') {
              selector = 'article, div[role="article"]';
            } else if (source.name === 'LinkedIn') {
              selector = '.feed-shared-update-v2, .occludable-update';
            } else if (source.name === 'Mastodon') {
              selector = '.status, .entry';
            } else if (source.name === 'BlueSky') {
              selector = '.post, .feed-post';
            }
            
            $(selector).each((i, element) => {
              if (i < 5) { // Limit to most recent 5 posts
                items.push({
                  title: $(element).find('h2, .title, .post-title').text().trim() || `${source.name} Post`,
                  date: $(element).find('.date, time, .timestamp').text().trim() || 'Recent',
                  summary: $(element).find('.content, .post-content, p').first().text().trim(),
                  url: $(element).find('a').attr('href') || source.url,
                  source: source.name
                });
              }
            });
          } else {
            // News sources - search for mentions
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
          }
          
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

module.exports = {
  collect,
  name: 'news'
};
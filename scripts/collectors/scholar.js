/**
 * Google Scholar data collector
 * 
 * Scrapes publication data from Google Scholar profile
 */

const axios = require('axios');
const cheerio = require('cheerio');

async function collect() {
  console.log('Collecting Google Scholar data...');
  
  // Google Scholar ID for Fabio Giglietto
  const scholarId = 'FmenbcUAAAAJ';
  
  try {
    const response = await axios.get(`https://scholar.google.com/citations?user=${scholarId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Extract publication data
    const publications = [];
    $('.gsc_a_tr').each((i, element) => {
      publications.push({
        title: $(element).find('.gsc_a_at').text(),
        authors: $(element).find('.gs_gray').first().text(),
        venue: $(element).find('.gs_gray').eq(1).text(),
        year: $(element).find('.gsc_a_y').text(),
        citations: $(element).find('.gsc_a_c').text()
      });
    });
    
    // Extract profile data
    const profile = {
      name: $('#gsc_prf_in').text(),
      affiliation: $('.gsc_prf_il').first().text(),
      interests: $('.gsc_prf_inta').map((i, el) => $(el).text()).get(),
      citations: $('#gsc_rsb_st .gsc_rsb_sc1').map((i, el) => $(el).text()).get()
    };
    
    return {
      profile,
      publications,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching Scholar data:', error.message);
    throw error;
  }
}

module.exports = { collect };
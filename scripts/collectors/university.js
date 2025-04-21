/**
 * University profile data collector
 * 
 * Fetches academic profile data from university website
 */

const axios = require('axios');
const cheerio = require('cheerio');

async function collect() {
  console.log('Collecting University profile data...');
  
  // University of Urbino profile URL
  const profileUrl = 'https://www.uniurb.it/persone/fabio-giglietto';
  
  try {
    const response = await axios.get(profileUrl);
    const $ = cheerio.load(response.data);
    
    // Extract and process faculty profile data
    // This is a simplified example - adjust the selectors based on the actual website structure
    const profile = {
      name: $('.faculty-name').text().trim(),
      title: $('.faculty-title').text().trim(),
      department: $('.faculty-department').text().trim(),
      email: $('.faculty-email').text().trim(),
      phone: $('.faculty-phone').text().trim(),
      office: $('.faculty-office').text().trim(),
      bio: $('.faculty-bio').text().trim(),
      courses: $('.faculty-courses li').map((i, el) => $(el).text().trim()).get(),
      office_hours: $('.faculty-hours').text().trim()
    };
    
    return {
      profile,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching University data:', error.message);
    throw error;
  }
}

module.exports = { collect };
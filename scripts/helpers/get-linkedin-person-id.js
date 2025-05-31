/**
 * Helper script to get LinkedIn Person ID
 * Run this once to get your Person ID for the environment variables
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function getLinkedInPersonId() {
  console.log('=== LinkedIn Person ID Helper ===\n');
  
  try {
    if (!process.env.LINKEDIN_ACCESS_TOKEN) {
      console.log('❌ LINKEDIN_ACCESS_TOKEN not found in your .env file');
      console.log('\nTo get your LinkedIn access token, please:');
      console.log('1. First, set up your LinkedIn Developer App:');
      console.log('   - Go to https://developer.linkedin.com/');
      console.log('   - Create a new app');
      console.log('   - Add these environment variables to your .env file:');
      console.log('     LINKEDIN_CLIENT_ID=your_client_id');
      console.log('     LINKEDIN_CLIENT_SECRET=your_client_secret');
      console.log('');
      console.log('2. Then run the OAuth helper:');
      console.log('   node scripts/helpers/linkedin-oauth.js');
      console.log('');
      console.log('3. Follow the browser authentication flow');
      return;
    }

    console.log('✓ Access token found, attempting to get Person ID...\n');

    const response = await axios.get('https://api.linkedin.com/v2/people/~', {
      headers: {
        'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    const personId = response.data.id;
    const firstName = response.data.localizedFirstName || 'Unknown';
    const lastName = response.data.localizedLastName || 'Unknown';
    
    console.log('✅ Successfully retrieved your LinkedIn Person ID!');
    console.log(`\nProfile: ${firstName} ${lastName}`);
    console.log(`Person ID: ${personId}`);
    console.log('\n=== Add this to your .env file ===');
    console.log(`LINKEDIN_PERSON_ID=${personId}`);
    
    // Check if .env file exists and offer to append
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      if (!envContent.includes('LINKEDIN_PERSON_ID=')) {
        console.log('\n=== Auto-update .env file? ===');
        console.log('Would you like to automatically add LINKEDIN_PERSON_ID to your .env file?');
        console.log('Run this script with --auto-update flag to enable:');
        console.log(`node scripts/helpers/get-linkedin-person-id.js --auto-update`);
        
        // Check for auto-update flag
        if (process.argv.includes('--auto-update')) {
          fs.appendFileSync(envPath, `\nLINKEDIN_PERSON_ID=${personId}\n`);
          console.log('✅ Added LINKEDIN_PERSON_ID to .env file');
        }
      } else {
        console.log('\n✓ LINKEDIN_PERSON_ID already exists in your .env file');
      }
    }
    
    return personId;
  } catch (error) {
    console.error('❌ Error getting Person ID:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('\n🔧 Token appears to be invalid or expired. Please:');
      console.log('1. Generate a new access token using:');
      console.log('   node scripts/helpers/linkedin-oauth.js');
      console.log('2. Update your .env file with the new token');
      console.log('3. Run this script again');
    } else if (error.response?.status === 403) {
      console.log('\n🔧 Permission denied. Please ensure your LinkedIn app has the following scopes:');
      console.log('- r_liteprofile (or r_basicprofile)');
      console.log('- w_member_social');
    } else {
      console.log('\n🔧 Network or API error. Please check your internet connection and try again.');
    }
  }
}

// Run the function
if (require.main === module) {
  getLinkedInPersonId();
}

module.exports = { getLinkedInPersonId };
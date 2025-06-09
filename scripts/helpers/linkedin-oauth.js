/**
 * LinkedIn OAuth Helper
 * This script helps you generate a LinkedIn access token
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

// LinkedIn OAuth configuration
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in your .env file');
  process.exit(1);
}

// Step 1: Authorization URL
app.get('/auth', (req, res) => {
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
    `response_type=code&` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `scope=profile%20w_member_social`;
  
  res.redirect(authUrl);
});

// Step 2: Handle callback and exchange code for token
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('Authorization code not provided');
  }
  
  try {
    // Exchange authorization code for access token
    const tokenResponse = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    
    const accessToken = tokenResponse.data.access_token;
    
    console.log('\n=== LinkedIn Access Token Generated ===');
    console.log('Add this to your .env file:');
    console.log(`LINKEDIN_ACCESS_TOKEN=${accessToken}`);
    console.log('\nToken expires in:', tokenResponse.data.expires_in, 'seconds');
    
    // Automatically get the Person ID
    try {
      console.log('\n=== Getting LinkedIn Person ID ===');
      const personResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const personId = personResponse.data.sub;
      console.log('Add this to your .env file:');
      console.log(`LINKEDIN_PERSON_ID=${personId}`);
      
      res.send(`
        <h1>Success!</h1>
        <p>Your LinkedIn access token and Person ID have been generated and logged to the console.</p>
        <p>Copy both values from the console and add them to your .env file:</p>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
LINKEDIN_ACCESS_TOKEN=${accessToken}
LINKEDIN_PERSON_ID=${personId}
        </pre>
        <p>You can close this window and stop the server (Ctrl+C).</p>
      `);
      
    } catch (personError) {
      console.error('Error getting Person ID:', personError.response?.data || personError.message);
      console.log('\nYou can get your Person ID later by running:');
      console.log('node scripts/helpers/get-linkedin-person-id.js');
      
      res.send(`
        <h1>Partially Successful!</h1>
        <p>Your LinkedIn access token has been generated, but we couldn't get your Person ID automatically.</p>
        <p>Add the token to your .env file and then run the Person ID script:</p>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
LINKEDIN_ACCESS_TOKEN=${accessToken}
        </pre>
        <p>Then run: <code>node scripts/helpers/get-linkedin-person-id.js</code></p>
        <p>You can close this window and stop the server (Ctrl+C).</p>
      `);
    }
    
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error.message);
    res.status(500).send('Error generating access token');
  }
});

app.get('/', (req, res) => {
  res.send(`
    <h1>LinkedIn OAuth Setup</h1>
    <p>Click the link below to authorize your LinkedIn account:</p>
    <a href="/auth" style="background: #0077b5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
      Authorize LinkedIn Account
    </a>
  `);
});

app.listen(PORT, () => {
  console.log(`\n=== LinkedIn OAuth Setup ===`);
  console.log(`1. Make sure you have set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in your .env file`);
  console.log(`2. Add this redirect URI to your LinkedIn app settings: ${REDIRECT_URI}`);
  console.log(`3. Open your browser and go to: http://localhost:${PORT}`);
  console.log(`4. Follow the authorization flow`);
  console.log(`\nServer running on http://localhost:${PORT}`);
});
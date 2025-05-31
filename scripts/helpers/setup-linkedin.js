#!/usr/bin/env node

/**
 * Complete LinkedIn API Setup Helper
 * 
 * This script provides a guided setup process for LinkedIn API integration.
 * It will help you configure your LinkedIn Developer App and generate the
 * necessary access tokens and Person ID.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

function printHeader() {
  console.log('\n' + '='.repeat(60));
  console.log('🔗 LinkedIn API Setup Helper');
  console.log('='.repeat(60));
  console.log('\nThis script will guide you through setting up LinkedIn API integration.');
  console.log('You\'ll need a LinkedIn account to proceed.\n');
}

function checkEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.log('📄 Creating .env file...');
    fs.writeFileSync(envPath, '# Environment variables for API access\n\n');
    console.log('✅ Created .env file\n');
  }
}

function printInstructions() {
  console.log('📋 Setup Instructions:');
  console.log('');
  console.log('1️⃣  Create LinkedIn Developer Application');
  console.log('   → Go to: https://developer.linkedin.com/');
  console.log('   → Sign in with your LinkedIn account');
  console.log('   → Click "Create app"');
  console.log('   → Fill out the form (app name, LinkedIn page, etc.)');
  console.log('');
  console.log('2️⃣  Configure App Settings');
  console.log('   → In your app dashboard, go to "Auth" tab');
  console.log('   → Add redirect URL: http://localhost:3000/callback');
  console.log('   → In "Products" tab, request "Sign In with LinkedIn"');
  console.log('   → Note your Client ID and Client Secret');
  console.log('');
  console.log('3️⃣  Add Credentials to .env');
  console.log('   → Copy your Client ID and Secret');
  console.log('   → Add them to your .env file as shown below');
  console.log('');
}

function printEnvTemplate() {
  console.log('📝 Add these lines to your .env file:');
  console.log('');
  console.log('   LINKEDIN_CLIENT_ID=your_client_id_here');
  console.log('   LINKEDIN_CLIENT_SECRET=your_client_secret_here');
  console.log('');
}

function checkCurrentSetup() {
  console.log('🔍 Checking current setup...\n');
  
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const personId = process.env.LINKEDIN_PERSON_ID;
  
  console.log(`Client ID:     ${clientId ? '✅ Set' : '❌ Missing'}`);
  console.log(`Client Secret: ${clientSecret ? '✅ Set' : '❌ Missing'}`);
  console.log(`Access Token:  ${accessToken ? '✅ Set' : '❌ Missing'}`);
  console.log(`Person ID:     ${personId ? '✅ Set' : '❌ Missing'}`);
  console.log('');
  
  if (clientId && clientSecret && !accessToken) {
    console.log('🎯 Ready for OAuth flow! Run:');
    console.log('   node scripts/helpers/linkedin-oauth.js');
    console.log('');
  } else if (accessToken && !personId) {
    console.log('🎯 Ready to get Person ID! Run:');
    console.log('   node scripts/helpers/get-linkedin-person-id.js');
    console.log('');
  } else if (clientId && clientSecret && accessToken && personId) {
    console.log('🎉 LinkedIn setup is complete!');
    console.log('');
    console.log('🧪 Test your setup:');
    console.log('   node scripts/collectors/social-media-aggregator.js');
    console.log('');
  }
  
  return { clientId, clientSecret, accessToken, personId };
}

function printNextSteps(setup) {
  if (!setup.clientId || !setup.clientSecret) {
    console.log('📌 Next Steps:');
    console.log('');
    console.log('1. Complete the LinkedIn Developer App setup (steps 1-2 above)');
    console.log('2. Add your Client ID and Secret to .env file');
    console.log('3. Re-run this script: node scripts/helpers/setup-linkedin.js');
    console.log('');
  } else if (!setup.accessToken) {
    console.log('📌 Next Steps:');
    console.log('');
    console.log('1. Run the OAuth flow:');
    console.log('   node scripts/helpers/linkedin-oauth.js');
    console.log('');
    console.log('2. Open http://localhost:3000 in your browser');
    console.log('3. Authorize your LinkedIn account');
    console.log('4. Copy the generated tokens to your .env file');
    console.log('');
  } else if (!setup.personId) {
    console.log('📌 Next Steps:');
    console.log('');
    console.log('1. Get your Person ID:');
    console.log('   node scripts/helpers/get-linkedin-person-id.js');
    console.log('');
    console.log('2. Add the Person ID to your .env file');
    console.log('');
  }
}

function printTroubleshooting() {
  console.log('🛠️  Troubleshooting:');
  console.log('');
  console.log('❓ "Invalid redirect URI"');
  console.log('   → Make sure http://localhost:3000/callback is in your app settings');
  console.log('');
  console.log('❓ "Invalid client credentials"');
  console.log('   → Double-check your Client ID and Secret in .env file');
  console.log('');
  console.log('❓ "Insufficient permissions"');
  console.log('   → Request "Sign In with LinkedIn" product in your app dashboard');
  console.log('');
  console.log('❓ "Token expired"');
  console.log('   → Re-run: node scripts/helpers/linkedin-oauth.js');
  console.log('');
}

function printHelp() {
  console.log('📚 Additional Resources:');
  console.log('');
  console.log('• LinkedIn Developer Documentation:');
  console.log('  https://docs.microsoft.com/en-us/linkedin/');
  console.log('');
  console.log('• API Setup Guide:');
  console.log('  See API_SETUP.md in this project');
  console.log('');
  console.log('• Get help:');
  console.log('  https://github.com/anthropics/claude-code/issues');
  console.log('');
}

// Main execution
function main() {
  printHeader();
  checkEnvFile();
  printInstructions();
  printEnvTemplate();
  
  const setup = checkCurrentSetup();
  printNextSteps(setup);
  
  if (!setup.clientId || !setup.clientSecret || !setup.accessToken) {
    printTroubleshooting();
  }
  
  printHelp();
  
  console.log('='.repeat(60));
  console.log('🚀 Happy coding!');
  console.log('='.repeat(60) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = { main };
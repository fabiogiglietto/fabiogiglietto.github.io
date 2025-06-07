#!/usr/bin/env node

/**
 * API Setup Status Checker
 * 
 * This script checks the status of all API integrations and provides
 * guidance on what needs to be set up.
 */

require('dotenv').config();

function checkAPISetup() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 API Setup Status Check');
  console.log('='.repeat(60));
  
  const apis = {
    openai: {
      name: 'OpenAI',
      required: process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-'),
      description: 'Required for AI content generation and analysis',
      setup: 'Get API key from https://platform.openai.com/'
    },
    linkedin: {
      name: 'LinkedIn',
      required: process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_PERSON_ID,
      partial: process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET,
      description: 'Optional for LinkedIn posts collection',
      setup: 'Run: node scripts/helpers/setup-linkedin.js'
    },
    mastodon: {
      name: 'Mastodon',
      required: process.env.MASTODON_ACCESS_TOKEN,
      description: 'Optional for enhanced Mastodon access',
      setup: 'Get token from your Mastodon instance settings'
    },
    wos: {
      name: 'Web of Science',
      required: process.env.WOS_API_KEY,
      description: 'Optional for enhanced publication data',
      setup: 'Contact your institution\'s library for API access'
    },
    scopus: {
      name: 'Scopus',
      required: process.env.SCOPUS_API_KEY,
      description: 'Optional for enhanced publication data',
      setup: 'Get API key from https://dev.elsevier.com/'
    },
    semanticScholar: {
      name: 'Semantic Scholar',
      required: process.env.S2_API_KEY,
      description: 'Optional for comprehensive publication data and metrics',
      setup: 'Get API key from https://www.semanticscholar.org/product/api'
    }
  };
  
  console.log('\n📊 Status Overview:\n');
  
  let allRequired = true;
  let anyOptional = false;
  
  Object.keys(apis).forEach(key => {
    const api = apis[key];
    const status = api.required ? '✅ Configured' : 
                   api.partial ? '⚠️  Partial' : 
                   '❌ Missing';
    
    const priority = key === 'openai' ? '(Required)' : 
                     key === 'linkedin' ? '(Recommended)' : 
                     '(Optional)';
    
    console.log(`${status} ${api.name.padEnd(15)} ${priority}`);
    console.log(`   ${api.description}`);
    
    if (!api.required) {
      if (key === 'openai') {
        allRequired = false;
      } else {
        anyOptional = true;
      }
    }
    
    if (!api.required && !api.partial) {
      console.log(`   Setup: ${api.setup}`);
    } else if (api.partial) {
      console.log(`   Next: ${api.setup}`);
    }
    
    console.log('');
  });
  
  // Summary and recommendations
  console.log('=' .repeat(60));
  
  if (!allRequired) {
    console.log('🚨 Required Setup Needed:');
    console.log('   OpenAI API key is required for basic functionality');
    console.log('   Get it from: https://platform.openai.com/');
    console.log('');
  }
  
  if (apis.linkedin.partial && !apis.linkedin.required) {
    console.log('🔗 LinkedIn Setup In Progress:');
    console.log('   Run: node scripts/helpers/linkedin-oauth.js');
    console.log('   Then: node scripts/helpers/get-linkedin-person-id.js');
    console.log('');
  }
  
  if (allRequired && anyOptional) {
    console.log('✅ Core Setup Complete!');
    console.log('   Your website will work with current configuration.');
    console.log('   Optional APIs can enhance functionality.');
    console.log('');
  } else if (allRequired && !anyOptional) {
    console.log('🎉 Full Setup Complete!');
    console.log('   All APIs are configured and ready to use.');
    console.log('');
  }
  
  // Test recommendations
  console.log('🧪 Test Your Setup:');
  console.log('   node scripts/collect-all.js        # Full data collection');
  console.log('   node scripts/collectors/social-media-aggregator.js  # Social media only');
  console.log('');
  
  console.log('📚 Documentation:');
  console.log('   See API_SETUP.md for detailed setup instructions');
  console.log('');
  
  console.log('='.repeat(60) + '\n');
}

if (require.main === module) {
  checkAPISetup();
}

module.exports = { checkAPISetup };
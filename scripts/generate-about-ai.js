/**
 * AI-powered About Me Generator 
 * 
 * This script uses the OpenAI API to generate an "About Me" section
 * based on collected data from various sources.
 * 
 * It will use the real OpenAI API in GitHub Actions with the secret OPENAI_API_KEY,
 * or fall back to mock data when run locally without the API key.
 */

// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Check for API key in environment
const hasApiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-');

// Simplified function to check if running in GitHub Actions
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

async function generateAIAboutMe() {
  console.log('Generating AI-powered About Me content...');
  
  try {
    if (!hasApiKey) {
      console.log('No valid OpenAI API key found in environment variables.');
      
      if (isGitHubActions) {
        console.error('ERROR: Running in GitHub Actions but OPENAI_API_KEY is not set or is invalid!');
        console.error('Please make sure the OPENAI_API_KEY secret is properly configured in the repository.');
      } else {
        console.log('Running locally without OpenAI API key. Using fallback generator.');
      }
      
      // Use the generator module directly without mock
      const aboutGenerator = require('./generators/about-generator');
      const success = await aboutGenerator.generateAboutMe();
      
      return success;
    } else {
      console.log('Valid OpenAI API key found. Using real OpenAI API for generation.');
      
      // Use the generator module with the actual API key
      const aboutGenerator = require('./generators/about-generator');
      const success = await aboutGenerator.generateAboutMe();
      
      if (success) {
        console.log('AI About Me content was generated successfully!');
        console.log('The content has been saved to _includes/generated-about.html');
        return true;
      } else {
        console.error('Failed to generate About Me content with OpenAI');
        return false;
      }
    }
  } catch (error) {
    console.error('Error generating AI About Me content:', error);
    return false;
  }
}

// Run the generator
generateAIAboutMe().then(success => {
  if (success) {
    console.log('AI About Me generation completed successfully');
  } else {
    console.log('AI About Me generation failed or was skipped');
    process.exit(1);
  }
}).catch(error => {
  console.error('Error in AI About Me generation:', error);
  process.exit(1);
});
/**
 * AI-powered About Me Generator
 *
 * This script uses the Google Gemini API to generate an "About Me" section
 * based on collected data from various sources.
 *
 * It will use the real Gemini API in GitHub Actions with the secret GEMINI_API_KEY,
 * or fall back to static content when run locally without the API key.
 */

// Load environment variables from .env file for local development
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Check for API key in environment
const hasApiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0;

// Simplified function to check if running in GitHub Actions
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

async function generateAIAboutMe() {
  console.log('Generating AI-powered About Me content...');

  try {
    if (!hasApiKey) {
      console.log('No valid Gemini API key found in environment variables.');

      if (isGitHubActions) {
        console.error('ERROR: Running in GitHub Actions but GEMINI_API_KEY is not set or is invalid!');
        console.error('Please make sure the GEMINI_API_KEY secret is properly configured in the repository.');
      } else {
        console.log('Running locally without Gemini API key. Using fallback generator.');
      }

      // Use the generator module directly without mock
      const aboutGenerator = require('./generators/about-generator');
      const success = await aboutGenerator.generateAboutMe();

      return success;
    } else {
      console.log('Valid Gemini API key found. Using real Gemini API for generation.');

      // Use the generator module with the actual API key
      const aboutGenerator = require('./generators/about-generator');
      const success = await aboutGenerator.generateAboutMe();

      if (success) {
        console.log('AI About Me content was generated successfully!');
        console.log('The content has been saved to _includes/generated-about.html');
        return true;
      } else {
        console.error('Failed to generate About Me content with Gemini');
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
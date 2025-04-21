/**
 * AI-powered About Me Generator 
 * 
 * This script simulates the OpenAI-powered About Me generation for testing
 * by providing a placeholder API key and implementing a mock API response.
 * 
 * IMPORTANT: This is for development/testing only, not for production use.
 */

const fs = require('fs');
const path = require('path');

// Mock OpenAI API implementation
class MockOpenAI {
  constructor() {
    console.log('Initializing mock OpenAI client for testing...');
  }

  async chat() {
    return {
      completions: {
        create: async (options) => {
          console.log('Mock OpenAI API call with options:', JSON.stringify(options, null, 2));
          
          // Simulate API response delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
          return {
            choices: [
              {
                message: {
                  content: `<p>Fabio Giglietto is a distinguished <strong>Full Professor of Sociology of Cultural and Communication Processes</strong> at the University of Urbino Carlo Bo, Italy. His groundbreaking research sits at the intersection of Internet Studies, computational social science, and digital media analysis, with a particular focus on political communication and the complex dynamics of online information disorders. Over the years, he has built an impressive academic profile with numerous highly-cited publications in leading international journals.</p>

<p>Professor Giglietto has made significant contributions to the field through his pioneering work on <em>Coordinated Link Sharing Behavior (CLSB)</em> and the development of CooRnet, an innovative open-source tool for detecting coordinated activity on social media platforms. His research has been recognized globally, with his most cited work on second screen participation receiving nearly 400 citations. Currently, he leads several major research initiatives, including the MINE project exploring methodological innovations in media analysis, the EU-funded vera.ai project focused on verifying and authenticating digital content, and PROMPT, which examines disinformation narratives across Europe.</p>

<p>As a productive scholar with publications in prestigious journals such as the Journal of Communication, Information, Communication & Society, and Social Media + Society, Professor Giglietto continues to advance understanding of how digital technologies shape contemporary communication practices. Since 2014, he has served as editor of the Journal of Sociocybernetics and maintains active involvement in key professional organizations including the International Communication Association and the Association of Internet Researchers. Through his teaching and research supervision, he is dedicated to training the next generation of scholars in digital media analysis and computational approaches to communication research.</p>`
                }
              }
            ]
          };
        }
      }
    };
  }
}

async function generateAIAboutMe() {
  console.log('Generating AI-powered About Me content...');
  
  try {
    // Set a placeholder API key in the environment
    // (Only for this script's execution)
    process.env.OPENAI_API_KEY = 'sk-test-key-placeholder';
    
    // Override the OpenAI import with our mock version
    const aboutGenerator = require('./generators/about-generator');
    
    // Replace the actual OpenAI client with our mock
    const originalOpenAI = require('openai').OpenAI;
    require('openai').OpenAI = MockOpenAI;
    
    // Call the generator
    const success = await aboutGenerator.generateAboutMe();
    
    if (success) {
      console.log('AI About Me content was generated successfully!');
      console.log('The content has been saved to _includes/generated-about.html');
      return true;
    } else {
      console.error('Failed to generate AI About Me content');
      return false;
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
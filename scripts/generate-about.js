/**
 * Standalone About Me Generator
 *
 * This script creates a fallback About Me section that can be used
 * when the Gemini-powered generator fails or API key is not available.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

async function generateAboutMe() {
  console.log('Generating fallback About Me content...');

  try {
    // Create fallback content from config
    const aboutMeContent = `<p>${config.name} is a ${config.title} at ${config.institution}, ${config.department}. Research focuses on ${config.researchInterests.join(', ')}.</p>`;
    
    // Save the generated content
    const includePath = path.join(__dirname, '../_includes/generated-about.html');
    fs.writeFileSync(includePath, aboutMeContent);
    
    console.log('About Me section generated successfully');
    return true;
  } catch (error) {
    console.error('Error generating About Me section:', error);
    return false;
  }
}

// Run the generator directly when this script is executed
generateAboutMe().then(success => {
  if (success) {
    console.log('About Me generation completed successfully');
  } else {
    console.log('About Me generation failed');
    process.exit(1);
  }
}).catch(error => {
  console.error('Error in About Me generation:', error);
  process.exit(1);
});
/**
 * Standalone About Me Generator
 * 
 * This script creates a fallback About Me section that can be used
 * when the OpenAI-powered generator fails or API key is not available.
 */

const fs = require('fs');
const path = require('path');

async function generateAboutMe() {
  console.log('Generating fallback About Me content...');
  
  try {
    // Create fallback content
    const aboutMeContent = `<p>Fabio Giglietto is a Full Professor of Sociology of Cultural and Communication Processes at the University of Urbino Carlo Bo, Italy. His research focuses on the intersection of Internet Studies, computational social science, and digital media analysis, with particular emphasis on political communication and disinformation.</p>

<p>He has made significant contributions to the field through his pioneering work on Coordinated Link Sharing Behavior (CLSB) and the development of CooRnet, an open-source tool for detecting coordinated activity on social platforms. He leads several major research initiatives, including the MINE project, the EU-funded vera.ai project, and is a key partner in PROMPT, which focuses on detecting and analyzing disinformation narratives across Europe.</p>

<p>His publications appear in leading journals such as Journal of Communication, Information, Communication & Society, and Social Media + Society. Since 2014, he has served as editor of the Journal of Sociocybernetics and is active in professional organizations including the International Communication Association and the Association of Internet Researchers.</p>`;
    
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
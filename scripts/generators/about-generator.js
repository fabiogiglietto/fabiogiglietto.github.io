/**
 * About Me Generator Module
 * 
 * This module uses OpenAI API to generate a personalized "About Me" section
 * based on collected data from various sources (ORCID, Google Scholar, GitHub, etc.)
 */

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

// Initialize OpenAI client with better error handling
let openai = null;
try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '', // Handle empty string case
  });
} catch (error) {
  console.warn('Failed to initialize OpenAI client:', error.message);
  // Continue execution - we'll check openai before using it
}

/**
 * Reads all collected data and generates an "About Me" section
 */
async function generateAboutMe() {
  try {
    console.log('Generating About Me section...');
    
    // Check if OpenAI API key is available early
    if (!process.env.OPENAI_API_KEY || !openai) {
      console.warn('OPENAI_API_KEY environment variable is not set or OpenAI client failed to initialize');
      console.log('Generating fallback content instead of using OpenAI API');
      return generateFallbackContent();
    }
    
    // Path to data directory
    const dataDir = path.join(__dirname, '../../public/data');
    
    // Read all data files
    const data = {};
    const dataFiles = [
      'orcid.json',
      'scholar.json',
      'university.json',
      'github.json',
      'news.json',
      'websearch.json',
      'summary.json'
    ];
    
    // Track which files were successfully loaded
    const loadedFiles = [];
    
    // Load each data file if it exists
    for (const file of dataFiles) {
      const filePath = path.join(dataDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          data[file.replace('.json', '')] = JSON.parse(fileContent);
          loadedFiles.push(file);
        } catch (err) {
          console.error(`Error reading ${file}:`, err.message);
        }
      } else {
        console.log(`File ${file} not found in ${dataDir}`);
      }
    }
    
    console.log(`Successfully loaded ${loadedFiles.length} data files: ${loadedFiles.join(', ')}`);
    
    // If no data was collected, return early with fallback
    if (Object.keys(data).length === 0) {
      console.error('No data available for generating About Me section');
      return generateFallbackContent();
    }
    
    // Format the data for the OpenAI prompt
    const formattedData = formatDataForPrompt(data);
    
    // Generate content using OpenAI
    const aboutMeContent = await generateContentWithOpenAI(formattedData);
    
    if (!aboutMeContent) {
      console.error('Failed to generate About Me content');
      return generateFallbackContent();
    }
    
    // Save the generated content
    const includePath = path.join(__dirname, '../../_includes/generated-about.html');
    fs.writeFileSync(includePath, aboutMeContent);
    
    console.log('About Me section generated successfully');
    return true;
  } catch (error) {
    console.error('Error generating About Me section:', error.message);
    return generateFallbackContent();
  }
}

/**
 * Generates fallback content when OpenAI generation fails
 */
async function generateFallbackContent() {
  try {
    console.log('Generating fallback About Me content...');
    
    // Create fallback content
    const aboutMeContent = `<p>Fabio Giglietto is a Full Professor of Internet Studies at the University of Urbino Carlo Bo, Italy. His research focuses on the intersection of Internet Studies, computational social science, and digital media analysis, with particular emphasis on political communication and disinformation.</p>

<p>He has made significant contributions to the field through his pioneering work on Coordinated Link Sharing Behavior (CLSB) and the development of CooRnet, an open-source tool for detecting coordinated activity on social platforms. He leads several major research initiatives, including the MINE project, the EU-funded vera.ai project, and is a key partner in PROMPT, which focuses on detecting and analyzing disinformation narratives across Europe.</p>

<p>His publications appear in leading journals such as Journal of Communication, Information, Communication & Society, and Social Media + Society. Since 2014, he has served as editor of the Journal of Sociocybernetics and is active in professional organizations including the International Communication Association and the Association of Internet Researchers.</p>`;
    
    // Save the generated content
    const includePath = path.join(__dirname, '../../_includes/generated-about.html');
    fs.writeFileSync(includePath, aboutMeContent);
    
    console.log('Fallback About Me content saved successfully');
    return true;
  } catch (error) {
    console.error('Error generating fallback content:', error.message);
    return false;
  }
}

/**
 * Formats collected data for the OpenAI prompt
 * @param {Object} data The collected data
 * @return {String} Formatted data for the prompt
 */
function formatDataForPrompt(data) {
  let formattedData = '';
  
  // Format ORCID data
  if (data.orcid) {
    formattedData += `\n--- PERSONAL INFO ---\n`;
    
    if (data.orcid.profile && data.orcid.profile.name) {
      const name = data.orcid.profile.name;
      formattedData += `Name: ${name['given-names']?.value || ''} ${name['family-name']?.value || ''}\n`;
    }
    
    if (data.orcid.profile && data.orcid.profile.biography) {
      formattedData += `Biography: ${data.orcid.profile.biography.content}\n`;
    }
    
    if (data.orcid.profile && data.orcid.profile.keywords && data.orcid.profile.keywords.keyword) {
      const keywords = data.orcid.profile.keywords.keyword.map(k => k.content).join(', ');
      formattedData += `Keywords: ${keywords}\n`;
    }
  }
  
  // Format Scholar data
  if (data.scholar && data.scholar.publications) {
    formattedData += `\n--- PUBLICATIONS ---\n`;
    
    data.scholar.publications.slice(0, 5).forEach((pub, index) => {
      formattedData += `${index + 1}. "${pub.title}" (${pub.year}) - Citations: ${pub.citations}\n`;
    });
    
    const totalCitations = data.scholar.publications.reduce((sum, pub) => 
      sum + parseInt(pub.citations || 0), 0);
    
    formattedData += `Total publications: ${data.scholar.publications.length}\n`;
    formattedData += `Total citations: ${totalCitations}\n`;
  }
  
  // Format University data
  if (data.university && data.university.profile) {
    const profile = data.university.profile;
    formattedData += `\n--- UNIVERSITY PROFILE ---\n`;
    formattedData += `Position: ${profile.title || 'Professor'}\n`;
    formattedData += `Department: ${profile.department || 'Department of Communication Sciences'}\n`;
    formattedData += `Institution: ${profile.institution || 'University of Urbino Carlo Bo'}\n`;
    
    // Add some fallback research interests if they're not available
    const interests = profile.research_interests && Array.isArray(profile.research_interests) 
      ? profile.research_interests.join(', ')
      : 'Digital Media Analysis, Social Media Research, Computational Social Science';
    
    formattedData += `Research interests: ${interests}\n`;
  } else {
    // Add default university info if not available
    formattedData += `\n--- UNIVERSITY PROFILE ---\n`;
    formattedData += `Position: Professor\n`;
    formattedData += `Department: Department of Communication Sciences, Humanities and International Studies\n`;
    formattedData += `Institution: University of Urbino Carlo Bo\n`;
    formattedData += `Research interests: Digital Media Analysis, Social Media Research, Computational Social Science\n`;
  }
  
  // Format GitHub data
  if (data.github && data.github.repos) {
    formattedData += `\n--- GITHUB ACTIVITY ---\n`;
    formattedData += `Total repositories: ${data.github.repos.length}\n`;
    
    // Popular repositories
    const popularRepos = [...data.github.repos]
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 3);
    
    if (popularRepos.length > 0) {
      formattedData += `Top repositories:\n`;
      popularRepos.forEach(repo => {
        formattedData += `- ${repo.name}: ${repo.description || 'No description'} (Stars: ${repo.stars})\n`;
      });
    }
  }
  
  // Format Web Search data
  if (data.websearch && data.websearch.mentions) {
    formattedData += `\n--- WEB MENTIONS ---\n`;
    data.websearch.mentions.slice(0, 3).forEach((mention, index) => {
      formattedData += `${index + 1}. ${mention.title} - ${mention.url}\n`;
      if (mention.snippet) {
        formattedData += `   ${mention.snippet}\n`;
      }
    });
  }
  
  return formattedData;
}

/**
 * Generates content using OpenAI API
 * @param {String} formattedData Formatted data for the prompt
 * @return {String} Generated HTML content
 */
async function generateContentWithOpenAI(formattedData) {
  try {
    // Check if OpenAI client is properly initialized
    if (!openai) {
      console.error('OpenAI client not initialized');
      return null;
    }
    
    // Double-check that the API key is still set (could have been unset between checks)
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY no longer available');
      return null;
    }
    
    // Create the prompt
    const prompt = `
You are an academic website content generator. Your task is to create a professional "About Me" section for an academic's personal website.
Use the provided information to create a well-written, engaging, and professional biography that highlights the academic's expertise, research interests, achievements, and current position.
Ensure the biography accurately reflects the academic's current title as 'Full Professor of Internet Studies' or 'Professor of Internet Studies'. Avoid using 'Associate Professor' or other outdated titles.

Format the content as clean HTML that can be included directly in the website. Use appropriate paragraph tags (<p>) for text and include appropriate semantic HTML elements.
Keep the tone professional but approachable. The content should be 3-4 paragraphs long.

Here is the academic's information:
${formattedData}

Additionally, search the web for recent information about Fabio Giglietto, particularly focusing on:
1. Recent publications or research projects
2. University of Urbino Carlo Bo affiliations
3. Current research on social media analysis, disinformation, or computational social science
4. Any recent grants, awards, or important professional activities
5. Latest posts and activity on BlueSky (@fabiogiglietto.bsky.social), Mastodon, Threads, and LinkedIn

For the social media content, don't create a separate social media section, but instead use this information to understand his current work and interests, then incorporate these insights naturally into the biography. Focus on the professional content from his social profiles that reveals what projects he's currently working on.

Include any relevant up-to-date information you find in the biography, but maintain a professional tone.

Generate ONLY the HTML content for the "About Me" section. Do not include any explanations, notes, or markdown formatting outside the HTML content. Your response should be valid HTML that starts with <p> and ends with </p> without any additional formatting or explanation.
`;

    console.log('Calling OpenAI API with GPT-4o...');
    
    try {
      // Call OpenAI API with web search capability
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an academic website content generator that creates professional bios based on academic data. Output ONLY valid HTML without any markdown formatting or additional text." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
        // Web search may not be supported in your current tier
        // Uncomment this if you have the appropriate access:
        /*
        tools: [{
          "type": "web_search",
          "web_search": {
            "enable_cite_command": false
          }
        }]
        */
      });
      
      // Extract the generated content
      let content = response.choices[0].message.content.trim();
      
      // Validate that the response is HTML content (starts with <p> or similar)
      if (!content.startsWith('<p') && !content.startsWith('<div') && !content.startsWith('<section')) {
        console.warn('Generated content does not appear to be properly formatted HTML');
        // Try to fix if it seems like valid content but incorrectly formatted
        if (content.includes('<p>')) {
          // Extract just the HTML portion
          const htmlStart = content.indexOf('<p>');
          const htmlEnd = content.lastIndexOf('</p>') + 4;
          if (htmlStart >= 0 && htmlEnd > htmlStart) {
            content = content.substring(htmlStart, htmlEnd);
            console.log('Fixed content formatting to extract HTML portion');
          }
        } else {
          console.error('Could not extract valid HTML from response');
          return null;
        }
      }
      
      console.log('Successfully generated content with GPT-4o');
      return content;
    } catch (apiError) {
      console.error('Error calling OpenAI API with GPT-4o:', apiError.message);
      console.log('Trying fallback model GPT-3.5-turbo...');
      
      // Try with a different model if the first one fails
      try {
        const fallbackResponse = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are an academic website content generator that creates professional bios based on academic data. Output ONLY valid HTML without any markdown formatting or additional text." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1000
          // No tools parameter for the fallback model as it may not support web search
        });
        
        // Extract the generated content
        let content = fallbackResponse.choices[0].message.content.trim();
        
        // Validate that the response is HTML content (starts with <p> or similar)
        if (!content.startsWith('<p') && !content.startsWith('<div') && !content.startsWith('<section')) {
          console.warn('Generated content from fallback model does not appear to be properly formatted HTML');
          // Try to fix if it seems like valid content but incorrectly formatted
          if (content.includes('<p>')) {
            // Extract just the HTML portion
            const htmlStart = content.indexOf('<p>');
            const htmlEnd = content.lastIndexOf('</p>') + 4;
            if (htmlStart >= 0 && htmlEnd > htmlStart) {
              content = content.substring(htmlStart, htmlEnd);
              console.log('Fixed content formatting to extract HTML portion');
            }
          } else {
            console.error('Could not extract valid HTML from fallback response');
            return null;
          }
        }
        
        console.log('Successfully generated content with GPT-3.5-turbo');
        return content;
      } catch (fallbackError) {
        console.error('Fallback model also failed:', fallbackError.message);
        return null;
      }
    }
  } catch (error) {
    console.error('Error generating content with OpenAI:', error.message);
    return null;
  }
}

module.exports = { generateAboutMe };
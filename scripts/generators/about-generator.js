/**
 * About Me Generator Module
 * 
 * This module uses OpenAI API to generate a personalized "About Me" section
 * based on collected data from various sources (ORCID, Google Scholar, GitHub, etc.)
 */

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Reads all collected data and generates an "About Me" section
 */
async function generateAboutMe() {
  try {
    console.log('Generating About Me section...');
    
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
    
    // Load each data file if it exists
    for (const file of dataFiles) {
      const filePath = path.join(dataDir, file);
      if (fs.existsSync(filePath)) {
        try {
          data[file.replace('.json', '')] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
          console.error(`Error reading ${file}:`, err);
        }
      }
    }
    
    // If no data was collected, return early
    if (Object.keys(data).length === 0) {
      console.error('No data available for generating About Me section');
      return false;
    }
    
    // Format the data for the OpenAI prompt
    const formattedData = formatDataForPrompt(data);
    
    // Generate content using OpenAI
    const aboutMeContent = await generateContentWithOpenAI(formattedData);
    
    if (!aboutMeContent) {
      console.error('Failed to generate About Me content');
      return false;
    }
    
    // Save the generated content
    const includePath = path.join(__dirname, '../../_includes/generated-about.html');
    fs.writeFileSync(includePath, aboutMeContent);
    
    console.log('About Me section generated successfully');
    return true;
  } catch (error) {
    console.error('Error generating About Me section:', error);
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
      formattedData += `Name: ${name['given-names'].value} ${name['family-name'].value}\n`;
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
    // Check if API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key is not available');
      console.log('Falling back to default content');
      
      // Return default content if no API key is available
      return `<p>Professor Fabio Giglietto is a researcher specializing in Digital Media Analysis at the Department of Communication Sciences, Humanities and International Studies at the University of Urbino Carlo Bo. His research focuses on social media data analysis, online communication patterns, and computational methods for studying digital media.</p>
<p>With expertise in computational analysis of social media platforms, Dr. Giglietto has published extensively in leading journals including the Journal of Communication, Information, Communication & Society, and Social Media + Society. His work examines how digital technologies shape communication practices and social dynamics.</p>
<p>Beyond his research, Professor Giglietto is dedicated to teaching and mentoring students in the field of Internet Studies. His academic website serves as a hub for his publications, research projects, and teaching activities. Feel free to explore his work or reach out with collaboration ideas.</p>`;
    }
    
    // Create the prompt
    const prompt = `
You are an academic website content generator. Your task is to create a professional "About Me" section for an academic's personal website.
Use the provided information to create a well-written, engaging, and professional biography that highlights the academic's expertise, research interests, achievements, and current position.

Format the content as clean HTML that can be included directly in the website. Use appropriate paragraph tags (<p>) for text and include appropriate semantic HTML elements.
Keep the tone professional but approachable. The content should be 3-4 paragraphs long.

Here is the academic's information:
${formattedData}

Generate ONLY the HTML content for the "About Me" section. Do not include any explanations or notes outside the HTML content.
`;

    try {
      // Call OpenAI API
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an academic website content generator that creates professional bios based on academic data." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });
      
      // Extract and return the generated content
      return response.choices[0].message.content.trim();
    } catch (apiError) {
      console.error('Error calling OpenAI API:', apiError);
      console.log('Using fallback model due to API error');
      
      // Try with a different model if the first one fails
      try {
        const fallbackResponse = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are an academic website content generator that creates professional bios based on academic data." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1000,
        });
        
        return fallbackResponse.choices[0].message.content.trim();
      } catch (fallbackError) {
        console.error('Fallback model also failed:', fallbackError);
        // Return default content if both models fail
        return `<p>Professor Fabio Giglietto is a researcher specializing in Digital Media Analysis at the Department of Communication Sciences, Humanities and International Studies at the University of Urbino Carlo Bo. His research focuses on social media data analysis, online communication patterns, and computational methods for studying digital media.</p>
<p>With expertise in computational analysis of social media platforms, Dr. Giglietto has published extensively in leading journals including the Journal of Communication, Information, Communication & Society, and Social Media + Society. His work examines how digital technologies shape communication practices and social dynamics.</p>
<p>Beyond his research, Professor Giglietto is dedicated to teaching and mentoring students in the field of Internet Studies. His academic website serves as a hub for his publications, research projects, and teaching activities. Feel free to explore his work or reach out with collaboration ideas.</p>`;
      }
    }
  } catch (error) {
    console.error('Error generating content with OpenAI:', error);
    // Return default content if there's an error
    return `<p>Professor Fabio Giglietto is a researcher specializing in Digital Media Analysis at the Department of Communication Sciences, Humanities and International Studies at the University of Urbino Carlo Bo. His research focuses on social media data analysis, online communication patterns, and computational methods for studying digital media.</p>
<p>With expertise in computational analysis of social media platforms, Dr. Giglietto has published extensively in leading journals including the Journal of Communication, Information, Communication & Society, and Social Media + Society. His work examines how digital technologies shape communication practices and social dynamics.</p>
<p>Beyond his research, Professor Giglietto is dedicated to teaching and mentoring students in the field of Internet Studies. His academic website serves as a hub for his publications, research projects, and teaching activities. Feel free to explore his work or reach out with collaboration ideas.</p>`;
  }
}

module.exports = { generateAboutMe };
/**
 * About Me Generator Module
 *
 * This module uses Google Gemini API to generate a personalized "About Me" section
 * based on collected data from various sources (ORCID, Google Scholar, GitHub, etc.)
 * Features Google Search grounding for up-to-date information about recent activities.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const sanitizeHtml = require('sanitize-html');
const config = require('../config');
const { getGeminiClient, MODELS } = require('../helpers/gemini-client');

/**
 * Reads all collected data and generates an "About Me" section
 */
async function generateAboutMe() {
  try {
    console.log('Generating About Me section...');

    // Check if Gemini client is available early
    if (!getGeminiClient()) {
      console.warn('GEMINI_API_KEY environment variable is not set or Gemini client failed to initialize');
      console.log('Generating fallback content instead of using Gemini API');
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
      'websearch.json',
      'summary.json',
      'teaching.json'
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

    // Load news.yml from _data directory (has social media posts with toread flags)
    const newsYamlPath = path.join(__dirname, '../../_data/news.yml');
    if (fs.existsSync(newsYamlPath)) {
      try {
        const newsYaml = yaml.load(fs.readFileSync(newsYamlPath, 'utf8'));
        data.newsYaml = newsYaml;
        console.log('Successfully loaded news.yml');
      } catch (err) {
        console.error('Error reading news.yml:', err.message);
      }
    }

    // If no data was collected, return early with fallback
    if (Object.keys(data).length === 0) {
      console.error('No data available for generating About Me section');
      return generateFallbackContent();
    }
    
    // Format the data for the Gemini prompt
    const formattedData = formatDataForPrompt(data);

    // Generate content using Gemini
    const aboutMeContent = await generateContentWithGemini(formattedData);
    
    if (!aboutMeContent) {
      console.error('Failed to generate About Me content');
      return generateFallbackContent();
    }
    
    // Sanitize the generated content to prevent XSS attacks
    const sanitizedContent = sanitizeHtml(aboutMeContent, {
      allowedTags: ['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'br', 'div', 'section'],
      allowedAttributes: {
        'a': ['href', 'target', 'rel']
      },
      allowedSchemes: ['http', 'https', 'mailto']
    });

    // Save the sanitized content
    const includePath = path.join(__dirname, '../../_includes/generated-about.html');
    fs.writeFileSync(includePath, sanitizedContent);

    console.log('About Me section generated and sanitized successfully');
    return true;
  } catch (error) {
    console.error('Error generating About Me section:', error.message);
    return generateFallbackContent();
  }
}

/**
 * Generates fallback content when Gemini API generation fails
 */
async function generateFallbackContent() {
  try {
    console.log('Generating fallback About Me content...');
    
    // Create fallback content from config
    const aboutMeContent = `<p>${config.name} is a ${config.title} at ${config.institution}, ${config.department}. Research focuses on ${config.researchInterests.join(', ')}.</p>`;
    
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
 * Formats collected data for the Gemini API prompt
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
    // Add default university info from config if not available
    formattedData += `\n--- UNIVERSITY PROFILE ---\n`;
    formattedData += `Position: ${config.title}\n`;
    formattedData += `Department: ${config.department}\n`;
    formattedData += `Institution: ${config.institution}\n`;
    formattedData += `Research interests: ${config.researchInterests.join(', ')}\n`;
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

  // Format Teaching data (current courses)
  if (data.teaching && Array.isArray(data.teaching)) {
    const currentCourses = data.teaching.filter(c => c.current);
    if (currentCourses.length > 0) {
      formattedData += `\n--- CURRENT TEACHING ---\n`;
      formattedData += `Courses for current academic year:\n`;
      currentCourses.forEach((course, index) => {
        formattedData += `${index + 1}. ${course.english_title || course.title} (${course.level || 'Master'}, ${course.semester || ''})\n`;
      });
    }
  }

  // Format News/Social Media posts from news.yml, split by toread flag
  if (data.newsYaml && Array.isArray(data.newsYaml)) {
    const sorted = data.newsYaml.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Posts about own work/ideas (no #toread tag)
    const ownPosts = sorted.filter(p => !p.toread).slice(0, 5);
    if (ownPosts.length > 0) {
      formattedData += `\n--- RECENT OWN CONTRIBUTIONS AND IDEAS ---\n`;
      formattedData += `Recent posts about the person's own research, projects, and professional opinions:\n`;
      ownPosts.forEach((post, index) => {
        const content = post.content.substring(0, 150) + (post.content.length > 150 ? '...' : '');
        formattedData += `${index + 1}. ${post.date}: ${content}\n`;
      });
    }

    // Posts sharing others' work (#toread tag)
    const sharedPosts = sorted.filter(p => p.toread).slice(0, 5);
    if (sharedPosts.length > 0) {
      formattedData += `\n--- CURRENT RESEARCH INTERESTS (shared papers by others) ---\n`;
      formattedData += `Papers by other researchers that the person recently shared (DO NOT attribute these as their own work):\n`;
      sharedPosts.forEach((post, index) => {
        const content = post.content.substring(0, 150) + (post.content.length > 150 ? '...' : '');
        formattedData += `${index + 1}. ${post.date}: ${content}\n`;
      });
    }
  }

  return formattedData;
}

/**
 * Generates content using Gemini API with Google Search grounding
 * @param {String} formattedData Formatted data for the prompt
 * @return {String} Generated HTML content
 */
async function generateContentWithGemini(formattedData) {
  try {
    const ai = getGeminiClient();
    if (!ai) {
      console.error('Gemini client not initialized');
      return null;
    }

    // Create the prompt
    const prompt = `
You are an academic website content generator. Your task is to create a professional "About Me" section for an academic's personal website.
Use the provided information to create a well-written, engaging, and professional biography that highlights the academic's expertise, research interests, achievements, and current position.
Ensure the biography accurately reflects the academic's current title as '${config.title}'. Avoid using outdated titles.

Format the content as clean HTML that can be included directly in the website. Use appropriate paragraph tags (<p>) for text and include appropriate semantic HTML elements.
Keep the tone professional but approachable. The content should be 3-4 paragraphs long.

Here is the academic's information:
${formattedData}

Additionally, use Google Search to verify information about ${config.name}, particularly focusing on:
1. Recent publications or research projects directly authored by this person
2. ${config.institution} affiliations
3. Current research on ${config.researchInterests.join(', ')}
4. Any recent grants, awards, or important professional activities

Only include information you can verify as the person's own publications, projects, or achievements.

The data includes two types of social media posts:
- "RECENT OWN CONTRIBUTIONS AND IDEAS": These are about the person's own research and can be described as their work.
- "CURRENT RESEARCH INTERESTS (shared papers by others)": These are papers by OTHER researchers that the person shared. Use these ONLY to characterize broader research interests and engagement with the field — NEVER attribute these papers as the person's own work.

Additionally, in the biography, briefly mention current teaching activities where relevant.
Keep these as natural, brief mentions woven into the narrative - not as separate sections or bullet points.
The focus remains on the overall academic profile and research contributions.

IMPORTANT: Only describe research that is directly authored by this person. Papers from the "shared papers by others" section must NOT be presented as the person's own work — only use them to show what topics the person is currently interested in.

IMPORTANT: Before finalizing, review the text to eliminate any repetition. Avoid repeating the same concepts, phrases, or information across paragraphs. Each paragraph should introduce new information without restating what was already covered.

Generate ONLY the HTML content for the "About Me" section. Do not include any explanations, notes, markdown code blocks, or additional text. Your response should be valid HTML that starts with <p> and ends with </p> without any additional formatting or explanation.
Do NOT use Markdown syntax (such as *asterisks* for italics). Use proper HTML tags like <em> for emphasis instead.
`;

    console.log(`Calling Gemini API with ${MODELS.FLASH} and Google Search grounding...`);

    try {
      const response = await ai.models.generateContent({
        model: MODELS.FLASH,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      });

      let content = (response.text || '').trim();

      // Remove markdown code blocks if present
      if (content.startsWith('```html')) {
        content = content.replace(/^```html\n/, '').replace(/\n```$/, '');
      } else if (content.startsWith('```')) {
        content = content.replace(/^```\n/, '').replace(/\n```$/, '');
      }

      content = content.trim();

      // Validate that the response is HTML content (starts with <p> or similar)
      if (!content.startsWith('<p') && !content.startsWith('<div') && !content.startsWith('<section')) {
        console.warn('Generated content does not appear to be properly formatted HTML');
        // Try to fix if it seems like valid content but incorrectly formatted
        if (content.includes('<p>')) {
          // Extract just the HTML portion
          const htmlStart = content.indexOf('<p>');
          const htmlEnd = content.lastIndexOf('</p>') + 4;
          if (htmlStart >= 0 && htmlEnd > htmlStart) {
            const fixedContent = content.substring(htmlStart, htmlEnd);
            console.log('Fixed content formatting to extract HTML portion');
            return fixedContent;
          }
        } else {
          console.error('Could not extract valid HTML from response');
          return null;
        }
      }

      // Log if grounding metadata is available
      if (response.candidates && response.candidates[0].groundingMetadata) {
        console.log('Google Search grounding was used for this generation');
      }

      console.log(`Successfully generated content with ${MODELS.FLASH}`);
      return content;
    } catch (apiError) {
      console.error('Error calling Gemini API:', apiError.message);

      console.log(`Trying fallback model ${MODELS.FLASH_LATEST}...`);
      try {
        const response = await ai.models.generateContent({
          model: MODELS.FLASH_LATEST,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
        });

        let content = (response.text || '').trim();

        // Remove markdown code blocks if present
        if (content.startsWith('```html')) {
          content = content.replace(/^```html\n/, '').replace(/\n```$/, '');
        } else if (content.startsWith('```')) {
          content = content.replace(/^```\n/, '').replace(/\n```$/, '');
        }

        content = content.trim();

        // Validate HTML format
        if (!content.startsWith('<p') && !content.startsWith('<div') && !content.startsWith('<section')) {
          console.warn('Generated content from fallback model does not appear to be properly formatted HTML');
          if (content.includes('<p>')) {
            const htmlStart = content.indexOf('<p>');
            const htmlEnd = content.lastIndexOf('</p>') + 4;
            if (htmlStart >= 0 && htmlEnd > htmlStart) {
              const fixedContent = content.substring(htmlStart, htmlEnd);
              console.log('Fixed content formatting to extract HTML portion');
              return fixedContent;
            }
          } else {
            console.error('Could not extract valid HTML from fallback response');
            return null;
          }
        }

        console.log(`Successfully generated content with ${MODELS.FLASH_LATEST}`);
        return content;
      } catch (fallbackError) {
        console.error(`${MODELS.FLASH_LATEST} fallback also failed:`, fallbackError.message);
        return null;
      }
    }
  } catch (error) {
    console.error('Error generating content with Gemini:', error.message);
    return null;
  }
}

module.exports = { generateAboutMe };
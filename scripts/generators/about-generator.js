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
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sanitizeHtml = require('sanitize-html');

// Initialize Gemini client with better error handling
let genAI = null;
let model = null;
try {
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Use Gemini 2.0 Flash for best quality with Google Search grounding
    model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      // Enable Google Search grounding for web search capabilities
      tools: [{ googleSearch: {} }]
    });
  }
} catch (error) {
  console.warn('Failed to initialize Gemini client:', error.message);
  // Continue execution - we'll check model before using it
}

/**
 * Reads all collected data and generates an "About Me" section
 */
async function generateAboutMe() {
  try {
    console.log('Generating About Me section...');

    // Check if Gemini API key is available early
    if (!process.env.GEMINI_API_KEY || !model) {
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
      'news.json',
      'websearch.json',
      'summary.json',
      'toread.json',
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

    // Load news.yml from _data directory (has richer content than news.json)
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

  // Format ToRead data (recent research interests)
  if (data.toread && Array.isArray(data.toread)) {
    const recentPapers = data.toread
      .filter(p => p.dateAdded)
      .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
      .slice(0, 5);
    if (recentPapers.length > 0) {
      formattedData += `\n--- RECENT READING INTERESTS ---\n`;
      formattedData += `Latest papers added to reading list (showing research direction):\n`;
      recentPapers.forEach((paper, index) => {
        const date = paper.dateAdded ? paper.dateAdded.split('T')[0] : '';
        formattedData += `${index + 1}. "${paper.title}" (${date})\n`;
      });
    }
  }

  // Format News/Social Media posts from news.yml
  if (data.newsYaml && Array.isArray(data.newsYaml)) {
    const recentPosts = data.newsYaml
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    if (recentPosts.length > 0) {
      formattedData += `\n--- RECENT SOCIAL MEDIA ACTIVITY ---\n`;
      formattedData += `Recent professional posts and discussions:\n`;
      recentPosts.forEach((post, index) => {
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
    // Check if Gemini model is properly initialized
    if (!model) {
      console.error('Gemini model not initialized');
      return null;
    }

    // Double-check that the API key is still set (could have been unset between checks)
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY no longer available');
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

Additionally, use Google Search to find recent information about Fabio Giglietto, particularly focusing on:
1. Recent publications or research projects
2. University of Urbino Carlo Bo affiliations
3. Current research on social media analysis, disinformation, or computational social science
4. Any recent grants, awards, or important professional activities
5. Latest posts and activity on BlueSky (@fabiogiglietto.bsky.social), Mastodon, Threads, and LinkedIn

For the social media content, don't create a separate social media section, but instead use this information to understand his current work and interests, then incorporate these insights naturally into the biography. Focus on the professional content from his social profiles that reveals what projects he's currently working on.

Include any relevant up-to-date information you find in the biography, but maintain a professional tone.

Additionally, in the biography, briefly mention where relevant:
- Current teaching activities (courses this academic year like Generative AI and Media, Digital Social Network Analysis)
- Recent research interests (based on reading list topics like coordinated behavior detection, multimodal narratives)
- Active participation in professional social media discussions about platform policies and research methods

Keep these as natural, brief mentions woven into the narrative - not as separate sections or bullet points.
The focus remains on the overall academic profile and research contributions.

IMPORTANT: Before finalizing, review the text to eliminate any repetition. Avoid repeating the same concepts, phrases, or information across paragraphs. Each paragraph should introduce new information without restating what was already covered.

Generate ONLY the HTML content for the "About Me" section. Do not include any explanations, notes, markdown code blocks, or additional text. Your response should be valid HTML that starts with <p> and ends with </p> without any additional formatting or explanation.
`;

    console.log('Calling Gemini API with gemini-2.0-flash and Google Search grounding...');

    try {
      // Call Gemini API with Google Search grounding enabled
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      });

      const response = await result.response;
      let content = response.text().trim();

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

      console.log('Successfully generated content with Gemini 2.0 Flash');
      return content;
    } catch (apiError) {
      console.error('Error calling Gemini API:', apiError.message);

      // Try with Gemini 1.5 Flash Latest as fallback
      console.log('Trying fallback model gemini-1.5-flash-latest...');
      try {
        const flashModel = genAI.getGenerativeModel({
          model: "gemini-1.5-flash-latest",
          tools: [{ googleSearch: {} }]
        });

        const result = await flashModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
        });

        const response = await result.response;
        let content = response.text().trim();

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

        console.log('Successfully generated content with Gemini 1.5 Flash');
        return content;
      } catch (fallbackError) {
        console.error('Gemini 1.5 Flash fallback also failed:', fallbackError.message);
        return null;
      }
    }
  } catch (error) {
    console.error('Error generating content with Gemini:', error.message);
    return null;
  }
}

module.exports = { generateAboutMe };
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
const { readBioSeed } = require('../helpers/bio-seed');

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

    // Load the authoritative bio seed — hand-curated ground truth
    const bioSeed = readBioSeed();
    if (bioSeed) {
      data.bioSeed = bioSeed;
      console.log('Successfully loaded authoritative bio seed');
    } else {
      console.warn('Bio seed not found at scripts/data/bio-seed.md — generator will run without ground truth');
    }

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

    const includePath = path.join(__dirname, '../../_includes/generated-about.html');

    // Prefer the authoritative bio seed's opening paragraphs as fallback
    const bioSeed = readBioSeed();
    if (bioSeed) {
      const paragraphs = bioSeed
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('-') && !p.startsWith('*'))
        .slice(0, 4);

      if (paragraphs.length > 0) {
        const LINK_TOKEN = '\uE001';
        const BOLD_OPEN = '\uE002';
        const BOLD_CLOSE = '\uE003';
        const EM_OPEN = '\uE004';
        const EM_CLOSE = '\uE005';

        const html = paragraphs
          .map(p => {
            // Capture markdown autolinks <http(s)://...> and mdlinks [text](url)
            const links = [];
            let work = p.replace(/<((https?:\/\/|mailto:)[^>\s]+)>/g, (_, url) => {
              links.push({ url, text: url });
              return LINK_TOKEN;
            });
            work = work.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => {
              links.push({ url, text });
              return LINK_TOKEN;
            });

            // Tokenize emphasis before escaping HTML
            work = work
              .replace(/\*\*([^*]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
              .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, `$1${EM_OPEN}$2${EM_CLOSE}`);

            // Escape HTML
            let escaped = work
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');

            // Restore tokens as real tags
            escaped = escaped
              .replace(new RegExp(BOLD_OPEN, 'g'), '<strong>')
              .replace(new RegExp(BOLD_CLOSE, 'g'), '</strong>')
              .replace(new RegExp(EM_OPEN, 'g'), '<em>')
              .replace(new RegExp(EM_CLOSE, 'g'), '</em>');

            // Restore links as anchor tags, in order
            let linkIdx = 0;
            escaped = escaped.replace(new RegExp(LINK_TOKEN, 'g'), () => {
              const { url, text } = links[linkIdx++] || { url: '', text: '' };
              const safeUrl = url.replace(/"/g, '&quot;');
              return `<a href="${safeUrl}" target="_blank" rel="noopener">${text}</a>`;
            });

            return `<p>${escaped}</p>`;
          })
          .join('\n');

        const sanitized = sanitizeHtml(html, {
          allowedTags: ['p', 'strong', 'em', 'a', 'br'],
          allowedAttributes: { 'a': ['href', 'target', 'rel'] },
          allowedSchemes: ['http', 'https', 'mailto']
        });

        fs.writeFileSync(includePath, sanitized);
        console.log('Fallback About Me content (from bio seed) saved successfully');
        return true;
      }
    }

    // Last-resort fallback from config when no bio seed is available
    const aboutMeContent = `<p>${config.name} is ${config.title} at ${config.institution}, ${config.department}. Research focuses on ${config.researchInterests.join(', ')}.</p>`;
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

  // Authoritative biography — always first, always primary ground truth
  if (data.bioSeed) {
    formattedData += `\n--- AUTHORITATIVE BIOGRAPHY (PRIMARY GROUND TRUTH) ---\n`;
    formattedData += `The text below is hand-curated by the subject and is the authoritative source for all facts: academic title, institutional affiliation, the MINE research programme and its sub-projects, project roles (e.g. WP4 Leader on vera.ai, Partner on PROMPT), grant IDs and funders, software tools (CooRnet status and the CrowdTangle context; CooRTweet as the downstream tool maintained by others), professional memberships, timeline and dates. Prefer this over any other source when facts conflict.\n\n`;
    formattedData += `${data.bioSeed}\n`;
  }

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
You are an academic website content generator. Your task is to produce the "About Me" section for ${config.name}'s personal website.

GROUND TRUTH
The data block starting with "--- AUTHORITATIVE BIOGRAPHY (PRIMARY GROUND TRUTH) ---" is the hand-curated, authoritative source. Treat it as the primary source for every fact you state: academic title, institutional affiliation, the MINE research programme and its sub-projects, project roles (WP4 Leader on vera.ai, Partner on PROMPT, PI roles), grant IDs and funders, dates and statuses, software tools (CooRnet discontinued after CrowdTangle's shutdown on 14 Aug 2024; CooRTweet as the downstream tool maintained by Righetti & Balluff — Fabio is NOT a CooRTweet co-developer), and professional memberships (ICA, AoIR, ISA RC51, Italian Association for Political Communication). When the authoritative biography conflicts with any other block, follow the authoritative biography.

USE OF SUPPLEMENTARY DATA
The other blocks (ORCID, Scholar, GitHub, web mentions, teaching, social posts) are supplementary. Use them only for freshness signals: very recent activity, current teaching semester, updated citation counts, recent talks. Do not let them override facts in the authoritative biography, and do not fabricate details that the authoritative biography does not support.

CONTENT TO SURFACE — CONCISELY
Weave the following into the narrative naturally, not as bullet lists. Summarize rather than enumerate: do NOT list every MINE sub-project, funder, or grant ID one by one — the detailed project table is displayed elsewhere on the site. Mention them at the level of breadth, e.g. "a succession of externally funded sub-projects on elections, public opinion and health information."
- The MINE programme by name, its role as an umbrella for Fabio's research line, and that no external grant is currently active under it.
- CooRnet (it introduced the Coordinated Link Sharing Behavior method) and its discontinuation after CrowdTangle's shutdown; CooRTweet as the downstream independent package maintained by others.
- Recent European role — WP4 Leader on vera.ai (concluded 2025) and Partner on PROMPT (concluded 2026) — without enumerating grant IDs.
- Memberships in ICA, AoIR and ISA RC51 (where he has served on the board).
- Current teaching: Generative AI and Media; Digital Social Network Analysis.

SHARED PAPERS GUARDRAIL
If a "CURRENT RESEARCH INTERESTS (shared papers by others)" block is present, those papers are shared by Fabio but authored by others. They must NEVER be attributed as his own work — use them only to indicate topics he is currently following.

GOOGLE SEARCH GROUNDING
You may use Google Search to verify very recent activity, but treat the authoritative biography as the dominant source. Do not use search results to override the authoritative biography's statements about status, dates, roles, or tool authorship.

FORMAT
- Output 3–4 concise paragraphs of clean HTML, each wrapped in <p>…</p>. Aim for roughly 80–140 words per paragraph — tight, not telegraphic.
- Do not include headings, lists, code blocks, markdown syntax, or any explanatory prose around the HTML.
- Use <em> for emphasis; never asterisks.
- Keep the tone professional but approachable.
- Eliminate repetition — each paragraph should introduce new material.
- Start with <p> and end with </p>. No preamble, no trailing notes.

DATA
${formattedData}
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
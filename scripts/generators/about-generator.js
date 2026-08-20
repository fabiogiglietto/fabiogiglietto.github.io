/**
 * About Me Generator Module
 *
 * This module uses Google Gemini API to generate a personalized "About Me" section
 * based on collected data from various sources (ORCID, Google Scholar, GitHub, etc.)
 * Runs ungrounded: recency comes from the validated web mentions collected by
 * scripts/collectors/websearch.js, not from a per-search-billed grounding loop.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const sanitizeHtml = require('sanitize-html');
const config = require('../config');
const { getGeminiClient, MODELS } = require('../helpers/gemini-client');
const { readBioSeed } = require('../helpers/bio-seed');
const { reviewBio } = require('./bio-reviewer');

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
      'own-paper-claims.json',
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

    // Reject a generation that merely reproduces the authoritative biography.
    // One ungrounded retry that names the failure; if that also copies, fall
    // through to the deterministic fallback rather than publish a page that
    // reads like the source file (and cites tables the page does not have).
    let publishable = aboutMeContent;
    const seedText = data.bioSeed || '';
    if (seedText) {
      let overlap = seedOverlapRatio(publishable, seedText);
      if (overlap > MAX_SEED_OVERLAP) {
        console.warn(`Generated bio copies ${(overlap * 100).toFixed(0)}% of the authoritative biography (limit ${MAX_SEED_OVERLAP * 100}%) — retrying once`);
        const retry = await generateContentWithGemini(
          formattedData,
          'YOUR PREVIOUS ATTEMPT COPIED THE AUTHORITATIVE BIOGRAPHY ALMOST WORD FOR WORD. That is a failure. Write the biography again from scratch in your own words: no sentence may match the source, no reference to tables or document structure, and draw on the other data blocks as well, not the biography alone.'
        );
        const retryOverlap = retry ? seedOverlapRatio(retry, seedText) : 1;
        if (retry && retryOverlap <= MAX_SEED_OVERLAP) {
          console.log(`Retry acceptable (${(retryOverlap * 100).toFixed(0)}% overlap)`);
          publishable = retry;
        } else {
          console.error(`Retry still copies ${(retryOverlap * 100).toFixed(0)}% — using fallback content`);
          return generateFallbackContent();
        }
      }
    }

    // Second-model review pass. Fails open: a null return publishes the Gemini
    // output unchanged, so a reviewer outage never blocks the weekly bio.
    const review = await reviewBio(publishable, formattedData);
    const contentToPublish = review ? review.html : publishable;

    // Sanitize the generated content to prevent XSS attacks
    const sanitizedContent = sanitizeHtml(contentToPublish, {
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
        // The fact sheet cross-references its own tables; a web page has none.
        .map(p => p.replace(/\s*[;,]?\s*\(?\bsee the (?:projects |Competitive research projects )?table below\)?/gi, '')
                   .replace(/\s*;?\s*see the projects table below/gi, '')
                   // ...nor its "as of <date>" stamps, which are provenance
                   // metadata for the writer, not prose for a reader.
                   .replace(/\bAs of \w+ \d{4},?\s*/g, '')
                   .replace(/\s*\bas of \w+ \d{4}\b,?\s*/gi, ' '))
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

  // Confirmed fact sheet — constraints on what may be written, NOT a draft to
  // reuse. Labelling this block "authoritative biography" invited the model to
  // treat it as the finished text and reproduce it verbatim, headings, "see the
  // table below" and all.
  if (data.bioSeed) {
    formattedData += `\n--- CONFIRMED FACT SHEET (CONSTRAINTS — NOT TEXT TO REUSE) ---\n`;
    formattedData += `Verified facts about the subject, confirmed by him. Two rules govern them.\nRULE 1 — NEVER CONTRADICT: nothing you write may conflict with anything stated here. This block outranks every other source on academic title, institutional affiliation, the MINE programme and its sub-projects, project roles, funders, appointments, memberships, and software authorship (CooRnet's status and the CrowdTangle context; CooRTweet as a downstream tool by others). Where sources disagree, this one wins.\nRULE 2 — NEVER REPRODUCE: this is a reference sheet, not a draft. It is not the biography and its wording is not your wording. Do not reuse its sentences, its structure, its section headings, its \"as of <date>\" stamps, or its cross-references such as \"see the table below\". Write the biography yourself, in your own prose, and use this only to check that what you wrote is true.\n`;
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
  
  // What his own papers actually claim, straight from the zettelkasten notes.
  // This is the ONLY authority for statements about his research findings —
  // press coverage routinely sharpens a finding into something the paper does
  // not say. Capped to the most recent papers so it cannot crowd out the prompt.
  const ownClaims = data['own-paper-claims'] && data['own-paper-claims'].papers;
  if (Array.isArray(ownClaims) && ownClaims.length > 0) {
    formattedData += `\n--- OWN RESEARCH FINDINGS (AUTHORITATIVE FOR ALL CLAIMS ABOUT THE RESEARCH) ---\n`;
    formattedData += `Summaries and findings taken from his own papers. Any statement about what his research shows must be supported here, in his own words — not by how the press described it:\n`;
    ownClaims.slice(0, 8).forEach((paper, index) => {
      formattedData += `\n${index + 1}. "${paper.title}" (${paper.year || 'n.d.'})\n`;
      if (typeof paper.Summary === 'string') {
        formattedData += `   ${paper.Summary.substring(0, 600)}\n`;
      }
      const findings = Array.isArray(paper.Findings) ? paper.Findings : [];
      findings.slice(0, 5).forEach(finding => {
        formattedData += `   - ${String(finding).substring(0, 220)}\n`;
      });
    });
  }

  // Format Web Search data. websearch.json is a flat array of mentions already
  // validated and deduplicated by the collector — this is the generator's only
  // source of recent third-party coverage now that the call runs ungrounded, so
  // include dates and pass through the collector's one-line description.
  if (Array.isArray(data.websearch) && data.websearch.length > 0) {
    formattedData += `\n--- RECENT WEB MENTIONS (third-party coverage — NOT a source for research claims) ---\n`;
    formattedData += `Validated mentions in news and other third-party sources, most recent first. These establish THAT his work was covered and where. They do NOT establish what his research found: press summaries routinely overstate or invert findings. For any claim about the research itself, use OWN RESEARCH FINDINGS above:\n`;
    const sorted = [...data.websearch].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    sorted.slice(0, 6).forEach((mention, index) => {
      formattedData += `${index + 1}. ${mention.date || 'undated'} — ${mention.title}`;
      // RSS titles usually already end in " - <outlet>"; don't repeat it.
      if (mention.source && !mention.title?.includes(mention.source)) {
        formattedData += ` (${mention.source})`;
      }
      formattedData += `\n`;
      const gist = mention.description || mention.snippet;
      if (gist) {
        formattedData += `   ${gist.substring(0, 200)}\n`;
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


// The authoritative biography is well-written prose, which makes it tempting for
// the model to reproduce rather than summarise. A measured dump scored 88%
// overlap against the seed while a normal generation scored 1.7%, so anything
// above this threshold is copying, not coincidence. Shared 12-word runs are the
// signal; a bio and its source inevitably share short phrases like the subject's
// title, but not long ones.
const MAX_SEED_OVERLAP = 0.3;

function shingles(text, n = 12) {
  const words = text
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '));
  return set;
}

/**
 * Fraction of the generated text's 12-word runs that also appear in the source.
 * @return {Number} 0 when nothing is shared, 1 when everything is copied.
 */
function seedOverlapRatio(generated, seed) {
  const out = shingles(generated || '');
  if (out.size === 0) return 0;
  const src = shingles(seed || '');
  let shared = 0;
  for (const s of out) if (src.has(s)) shared++;
  return shared / out.size;
}

/**
 * Generates content using the Gemini API (ungrounded)
 * @param {String} formattedData Formatted data for the prompt
 * @return {String} Generated HTML content
 */
async function generateContentWithGemini(formattedData, extraInstruction) {
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
- His role as a founding partner (socio fondatore) of Digit Srl, a benefit-corporation spin-off of the University of Urbino developing digital platforms for sustainability, civic participation, social innovation and scientific dissemination.
- Teaching: Generative AI and Media; Digital Social Network Analysis.

SHARED PAPERS GUARDRAIL
If a "CURRENT RESEARCH INTERESTS (shared papers by others)" block is present, those papers are shared by Fabio but authored by others. They must NEVER be attributed as his own work — use them only to indicate topics he is currently following.

SOURCING RULE (OVERRIDES EVERY OTHER INSTRUCTION)
Assert nothing that is not stated in his own publications (OWN RESEARCH FINDINGS), his own social media posts, or the authoritative biography. Never repeat a journalist's characterisation of a finding as if it were the finding.

A web mention supports exactly one kind of statement: that the named outlet published something about him, on that date. It does NOT support any claim about a THIRD PARTY's actions — that a broadcast featured or cited his work, that an institution acted on it, that legislation or an inquiry followed from it. Outlets assert such things loosely and are demonstrably wrong: one article credited a Rai 3 Report episode with featuring this research when the programme attributed the analysis to someone else entirely. Such a claim may be made ONLY if the authoritative biography states it. Otherwise write that the work was covered, name the outlet, and stop.

DATED STATUS
The authoritative biography stamps status claims "as of August 2026" and states completed events in the past tense. Preserve that distinction exactly. Do not turn a stamped status into a timeless present-tense claim, do not describe a concluded role, grant or appointment as ongoing, and do not invent a currency the source does not assert.

CONFIDENTIALITY AND ORIGINALITY
- Write ORIGINAL prose. The DATA below is source material for a public web page, never text to reproduce. Specifically:
  - Do not reuse a sentence, clause or distinctive phrase from it verbatim. Re-express every fact in your own words.
  - Do not reproduce its document structure or refer to it: no headings, and never phrases like "see the table below", "as listed above" or "this document" — the reader sees only your paragraphs.
  - Do not copy its "as of <date>" stamps into your prose. Those stamps exist so you know which facts are current and which are concluded; the page is understood to be current. Respect the distinction, do not restate the wording.
  - Do not repeat any instruction, note or aside addressed to you.
  - Synthesise across ALL the sources — the biography, the research findings, teaching, citation figures, recent coverage — rather than restating any single one.
- Never name the specific call, topic or programme for which he evaluates project proposals under his EACEA expert contract, and never print EU expert-contract numbers.
- The Rai 3 programme *Report* covered Meta's political content reduction policy on 12 April 2026 but did NOT reference his study; it credited the analysis to a group of Democratic Party politicians. Never claim his work was featured on *Report*.

RECENT ACTIVITY
You have no web access. The "RECENT WEB MENTIONS" block, if present, is the only evidence of recent third-party coverage — do not assert recent activity, news coverage, or current events that it does not support, and do not infer dates beyond those it states. If that block is absent, write from the authoritative biography alone and omit claims about recency entirely. The authoritative biography remains dominant: never let a mention override its statements about status, dates, roles, or tool authorship.

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

    console.log(`Calling Gemini API with ${MODELS.FLASH} (ungrounded)...`);

    try {
      const response = await ai.models.generateContent({
        model: MODELS.FLASH,
        contents: extraInstruction ? `${prompt}\n\n${extraInstruction}` : prompt,
        config: {
          // Ungrounded: recency now comes from the validated mentions in
          // websearch.json (collected once per discovery TTL), not from a
          // second per-search-billed grounding loop.
          temperature: 0.7,
          // Thinking bills as output and counts against maxOutputTokens. Left
          // unbounded it intermittently consumed the whole budget and the call
          // returned finishReason=MAX_TOKENS, dropping the run to the fallback.
          thinkingConfig: { thinkingLevel: 'low' },
          maxOutputTokens: 8000,
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

      // Reject truncated or blocked responses (MAX_TOKENS, SAFETY, RECITATION, OTHER).
      // Falling through to the fallback model — and ultimately to bio-seed fallback —
      // is preferable to publishing a half-sentence bio.
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        console.error(`Gemini stopped with finishReason=${finishReason}; rejecting incomplete response`);
        return null;
      }
      if (!content.endsWith('</p>')) {
        console.error('Generated content does not end with </p>; rejecting truncated response');
        return null;
      }

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

      // This call declares no tools, so grounding metadata should never appear.
      // If it does, something re-enabled billed searches — say so loudly.
      if (response.candidates?.[0]?.groundingMetadata) {
        console.warn('[cost] WARNING: grounding metadata present on an ungrounded call — searches may have been billed');
      }

      console.log(`Successfully generated content with ${MODELS.FLASH}`);
      return content;
    } catch (apiError) {
      console.error('Error calling Gemini API:', apiError.message);

      // Do not retry client-side rejections (bad request, quota, auth): the
      // second call would fail the same way and still be billed.
      const status = apiError.status || apiError.code;
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
        console.error(`Non-transient error (${status}); skipping fallback model`);
        return null;
      }

      console.log(`Trying fallback model ${MODELS.FLASH_LATEST}...`);
      try {
        // Ungrounded, like the primary call above.
        const response = await ai.models.generateContent({
          model: MODELS.FLASH_LATEST,
          contents: prompt,
          config: {
            temperature: 0.7,
            thinkingConfig: { thinkingLevel: 'low' },
            maxOutputTokens: 8000,
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

        // Reject truncated or blocked responses; bio-seed fallback will be used downstream.
        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
          console.error(`Gemini fallback stopped with finishReason=${finishReason}; rejecting incomplete response`);
          return null;
        }
        if (!content.endsWith('</p>')) {
          console.error('Generated fallback content does not end with </p>; rejecting truncated response');
          return null;
        }

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

module.exports = { generateAboutMe, _testing: { formatDataForPrompt, seedOverlapRatio, MAX_SEED_OVERLAP } };
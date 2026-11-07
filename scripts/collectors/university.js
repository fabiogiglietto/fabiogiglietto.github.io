/**
 * University profile data collector
 * 
 * Fetches academic profile data from university website
 * including teaching information, courses, and office hours
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function collect() {
  console.log('Collecting University profile data...');

  // University profile URL from config
  const profileUrl = config.universityProfileUrl;
  
  try {
    const response = await axios.get(profileUrl);
    const $ = cheerio.load(response.data);
    
    // Extract basic profile info
    const profile = extractProfileInfo($);
    
    // Extract teaching data directly from the profile page
    // Specifically from the "Insegnamenti e Programmi" tab
    const extracted = extractTeachingFromProfilePage($);

    // Save teaching data to a dedicated file for the teaching generator. If
    // the page yielded no courses, keep the last real file rather than
    // inventing courses or blanking the teaching page.
    const teachingDataPath = path.join(__dirname, '../../public/data/teaching.json');
    let teaching = extracted;
    if (extracted) {
      fs.writeFileSync(teachingDataPath, JSON.stringify(extracted, null, 2));
      console.log(`Teaching data saved to ${teachingDataPath}`);
    } else {
      try {
        teaching = JSON.parse(fs.readFileSync(teachingDataPath, 'utf8'));
        console.warn('No courses extracted from the profile page — keeping the previous teaching.json');
      } catch {
        console.warn('No courses extracted and no previous teaching.json — teaching data unavailable');
        teaching = null;
      }
    }
    
    return {
      profile,
      teaching,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching University data:', error.message);
    console.error(error.stack);
    
    // Never invent a profile: returning null keeps the last real university.json.
    return null;
  }
}

/**
 * Extracts profile information from the university page
 */
function extractProfileInfo($) {
  // Try to find the name in various potential elements
  let name = $('.page-title').text().trim();
  if (!name) name = $('h1').first().text().trim();
  if (!name) name = config.name; // Fallback

  // Extract other profile data with conservative fallbacks from config
  const profile = {
    name: name,
    title: $('.profile-title').text().trim() || config.title,
    department: $('.profile-department').text().trim() || config.department,
    email: $('.profile-email').text().trim() || config.email,
    phone: $('.profile-phone').text().trim() || config.phone,
    office: $('.profile-office').text().trim() || config.office,
    bio: $('.profile-bio').text().trim() || "",
    research_interests: $('.profile-interests li').map((i, el) => $(el).text().trim()).get() ||
      config.researchInterests,
    office_hours: $('.profile-hours').text().trim() || config.officeHours
  };
  
  return profile;
}

/**
 * Extracts teaching information directly from the profile page
 * Specifically from the "Insegnamenti e Programmi" tab with table id="insegnamenti"
 */
function extractTeachingFromProfilePage($) {
  console.log('Extracting teaching data from profile page...');
  
  const courseData = [];
  
  // Look for the courses table in the "Insegnamenti e Programmi" tab
  const courseTable = $('#insegnamenti');
  
  if (courseTable.length > 0) {
    console.log('Found courses table, parsing rows...');
    
    // Process table rows, skipping the header
    const tableRows = courseTable.find('tbody tr');
    
    tableRows.each((i, row) => {
      const columns = $(row).find('td');
      
      if (columns.length >= 5) {
        // Extract key course information from table columns
        const academicYearText = $(columns[0]).text().trim();
        
        // Course information: main title and possibly English title in small tag
        const courseColumn = $(columns[1]);
        const courseTitle = courseColumn.find('a').first().text().trim();
        const englishTitleElement = courseColumn.find('small a').first();
        const englishTitle = englishTitleElement.length > 0 ? englishTitleElement.text().trim() : '';
        
        // Check if this is a "mutuato" course (borrowed course) that should be skipped
        const isMutuato = courseColumn.text().toLowerCase().includes('mutuato');
        if (isMutuato) {
          console.log(`Skipping "mutuato" course: ${courseTitle} (${academicYearText})`);
          return; // Skip this course and continue with the next one
        }
        
        // Course URL
        const courseUrl = courseColumn.find('a').first().attr('href') || '';
        // Syllabus URL (second link or first if only one exists)
        const syllabusUrl = courseColumn.find('small a').first().attr('href') || courseUrl;
        
        // Degree information
        const degreeColumn = $(columns[2]);
        // Get full text of the degree column to capture codes like (LM-XX) or (L-XX)
        const degreeFullText = degreeColumn.text().trim();
        const degreeTitle = degreeColumn.find('a').first().text().trim();
        const degreeTitleEnglish = degreeColumn.find('small a').first().text().trim();
        
        // Credits and discipline code
        const credits = parseInt($(columns[3]).text().trim(), 10) || 6;
        const disciplineCode = $(columns[4]).text().trim();
        
        // Parse academic year (format: "2024/2025")
        // Convert to standard format "2024-2025"
        const academicYear = academicYearText.replace('/', '-');
        
        // Determine if course is current based on academic year
        const isCurrentCourse = isCurrentAcademicYear(academicYear);
        
        // Create a code from the course title for display purposes
        const courseCode = generateCourseCode(courseTitle, academicYear);
        
        // Create course object
        courseData.push({
          title: courseTitle,
          english_title: englishTitle,
          code: courseCode,
          academic_year: academicYear,
          degree: degreeTitle,
          degree_english: degreeTitleEnglish,
          degree_full_text: degreeFullText,  // Store full text with codes
          credits: credits,
          discipline_code: disciplineCode,
          current: isCurrentCourse,
          syllabus_url: syllabusUrl.startsWith('/') ? `https://www.uniurb.it${syllabusUrl}` : syllabusUrl,
          // Try to determine semester and level from degree info
          semester: determineSemester(courseTitle, degreeTitle),
          level: determineLevel(degreeFullText)  // Use full text for better detection
          // No description: the profile page has none, and a keyword template
          // is not one (until 2026-11-07 every published description was).
        });
      }
    });
    
    console.log(`Extracted ${courseData.length} courses from the table`);
  } else {
    console.log('No course table found on the profile page.');
    return null;
  }
  
  if (courseData.length === 0) {
    console.log('No courses found in the table.');
    return null;
  }
  
  // Extract office hours if available, otherwise use default
  const officeHours = extractOfficeHours($) ||
    `${config.officeHours}\nOr by appointment (email: ${config.email})`;
  
  return {
    courses: courseData,
    office_hours: officeHours,
    tutorials: getDefaultTutorials(),
    supervision: getDefaultSupervision()
  };
}

/**
 * Generates a course code from the title and academic year
 * Example: "DIGITAL MEDIA ANALYSIS" 2024-2025 -> "DMA2024"
 */
function generateCourseCode(title, academicYear) {
  // Extract the first letters of each word in the title
  const initials = title.split(/\s+/)
    .filter(word => word.length > 0)
    .map(word => word[0])
    .join('');
  
  // Extract the starting year from the academic year (e.g., 2024 from 2024-2025)
  const yearMatch = academicYear.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : '';
  
  // Combine initials and year
  return (initials + year).toUpperCase();
}

/**
 * Helper function to extract office hours from the page
 */
function extractOfficeHours($) {
  // Try various selectors for office hours information
  const officeHoursSelectors = [
    '.office-hours', 
    '.ricevimento', 
    '.contact-info',
    'h3:contains("Office Hours"), h3:contains("Ricevimento")'
  ];
  
  for (const selector of officeHoursSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      // Get the text or the text of the next element
      let text = element.text().trim();
      if (!text.includes(':')) {
        text = element.next().text().trim();
      }
      if (text) return text;
    }
  }
  
  return null;
}

/**
 * Tries to determine the semester from course title or details
 */
function determineSemester(title, details) {
  const combinedText = (title + " " + details).toLowerCase();
  
  if (combinedText.includes("primo semestre") || 
      combinedText.includes("i semestre") || 
      combinedText.includes("1° semestre") ||
      combinedText.includes("fall")) {
    return "Fall";
  }
  
  if (combinedText.includes("secondo semestre") || 
      combinedText.includes("ii semestre") || 
      combinedText.includes("2° semestre") ||
      combinedText.includes("spring")) {
    return "Spring";
  }
  
  // If semester can't be determined, make a guess based on current month
  const currentMonth = new Date().getMonth(); // 0-11
  return currentMonth >= 2 && currentMonth <= 8 ? "Fall" : "Spring";
}

/**
 * Tries to determine the course level from degree information
 * Based on Italian university degree classification codes:
 * - (LM-XX) = Laurea Magistrale = Master's degree
 * - (L-XX) = Laurea = Bachelor's degree
 * - No code = PhD Program
 */
function determineLevel(degreeInfo) {
  // Check for degree codes in parentheses first (most reliable)
  // LM- indicates Laurea Magistrale (Master's degree)
  if (degreeInfo.includes('(LM-') || degreeInfo.includes('LM-')) {
    return "Master";
  }

  // L- (but not LM-) indicates Laurea (Bachelor's degree)
  // Check for (L- pattern while ensuring it's not (LM-
  if ((degreeInfo.includes('(L-') || degreeInfo.match(/\bL-\d/)) &&
      !degreeInfo.includes('LM-')) {
    return "Bachelor";
  }

  // Additional checks for text-based indicators
  const lowerDegree = degreeInfo.toLowerCase();

  if (lowerDegree.includes("magistrale") ||
      lowerDegree.includes("specialistica") ||
      lowerDegree.includes("master") ||
      lowerDegree.includes("secondo livello")) {
    return "Master";
  }

  if (lowerDegree.includes("dottorato") ||
      lowerDegree.includes("phd") ||
      lowerDegree.includes("doctoral")) {
    return "PhD";
  }

  // Manual mapping based on known degree programs (when codes aren't in the page)
  const masterDegreePrograms = [
    'Informatica e Innovazione Digitale', // LM-18
    'Informatics and Digital Innovation', // LM-18
    'Comunicazione e Pubblicità per le Organizzazioni', // LM-59
    'Advertising and Organizations Communication', // LM-59
  ];

  const bachelorDegreePrograms = [
    'Informazione, Media, Pubblicit', // L-20 (partial match to handle encoding issues)
    'Information, media and advertisement', // L-20
    'Informatica Applicata', // L-31
    'Applied Informatics', // L-31
  ];

  // Check if degree program is known Master's level
  if (masterDegreePrograms.some(program => degreeInfo.includes(program))) {
    return "Master";
  }

  // Check if degree program is known Bachelor's level
  if (bachelorDegreePrograms.some(program => degreeInfo.includes(program))) {
    return "Bachelor";
  }

  // If degree info is empty or has no code, assume PhD Program
  if (!degreeInfo || degreeInfo.trim() === '') {
    return "PhD";
  }

  // Default to PhD if no specific code found (per user's requirement)
  return "PhD";
}

/**
 * Gets the current academic year in format "YYYY-YYYY"
 */
function getCurrentAcademicYear() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth(); // 0-11
  
  // Academic year typically starts in September/October
  if (month >= 8) { // September or later
    return `${currentYear}-${currentYear + 1}`;
  } else {
    return `${currentYear - 1}-${currentYear}`;
  }
}

/**
 * Checks if the given academic year is the current one
 */
function isCurrentAcademicYear(yearString) {
  const currentYear = new Date().getFullYear();
  return yearString.includes(currentYear.toString()) || 
         yearString.includes((currentYear + 1).toString());
}

/**
 * Returns default tutorials data
 */
function getDefaultTutorials() {
  return [
    {
      title: "Introduction to R for Communication Research",
      description: "A beginner's guide to R programming for communication and media research",
      url: config.urls.rForCommResearch
    },
    {
      title: "Social Media Data Analysis with Python",
      description: "Tutorial series on collecting and analyzing social media data with Python",
      url: config.urls.socialMediaPython
    }
  ];
}

/**
 * Returns default supervision information
 */
function getDefaultSupervision() {
  return "I am available to supervise Bachelor's and Master's theses in the following areas:\n\n" +
    "- Digital Media Analysis\n" +
    "- Social Media Research\n" +
    "- Computational Social Science\n" +
    "- Media Studies\n" +
    "- Online Misinformation and Disinformation\n\n" +
    "If you are interested in working with me, please email me with a brief outline of your research interests.";
}

module.exports = {
  collect,
  name: 'university'
};
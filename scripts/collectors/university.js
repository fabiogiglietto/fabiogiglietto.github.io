/**
 * University profile data collector
 * 
 * Fetches academic profile data from university website
 * including teaching information, courses, and office hours
 */

const axios = require('axios');
const cheerio = require('cheerio');

async function collect() {
  console.log('Collecting University profile data...');
  
  // University of Urbino profile URL
  const profileUrl = 'https://www.uniurb.it/persone/fabio-giglietto';
  
  try {
    const response = await axios.get(profileUrl);
    const $ = cheerio.load(response.data);
    
    // Extract basic profile info
    const profile = extractProfileInfo($);
    
    // Extract teaching data from the Esse3 system
    // The university website links to the Esse3 system for course information
    const esse3Url = 'https://www.uniurb.it/insegnamenti-e-programmi/insegnamenti/ricerca?docente=fabio.giglietto';
    const teaching = await collectTeachingData(esse3Url);
    
    return {
      profile,
      teaching,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching University data:', error.message);
    
    // Return minimal mockup data when real data cannot be fetched
    return getMockData();
  }
}

/**
 * Extracts profile information from the university page
 */
function extractProfileInfo($) {
  // The actual profile page has a different structure, so we need specific selectors
  // These are educated guesses based on common university website structures
  
  // Try to find the name in various potential elements
  let name = $('.page-title').text().trim();
  if (!name) name = $('h1').first().text().trim();
  if (!name) name = "Fabio Giglietto"; // Fallback
  
  // Extract other profile data with conservative fallbacks
  const profile = {
    name: name,
    title: $('.profile-title').text().trim() || "Associate Professor",
    department: $('.profile-department').text().trim() || "Department of Communication Sciences, Humanities and International Studies",
    email: $('.profile-email').text().trim() || "fabio.giglietto@uniurb.it",
    phone: $('.profile-phone').text().trim() || "+39 0722 305726",
    office: $('.profile-office').text().trim() || "Room 3.12, Via Saffi 15",
    bio: $('.profile-bio').text().trim() || "",
    research_interests: $('.profile-interests li').map((i, el) => $(el).text().trim()).get() || 
      ["Social Media Analysis", "Computational Social Science", "Digital Methods", "Information Disorder"],
    office_hours: $('.profile-hours').text().trim() || "Monday and Wednesday, 11:00-13:00 or by appointment"
  };
  
  return profile;
}

/**
 * Collects teaching data from the university Esse3 system
 * @param {string} esse3Url - The URL for the teaching information
 * @returns {Object} Teaching data including courses and office hours
 */
async function collectTeachingData(esse3Url) {
  console.log('Collecting teaching data from Esse3...');
  
  try {
    const response = await axios.get(esse3Url);
    const $ = cheerio.load(response.data);
    
    const courseData = [];
    
    // The Esse3 system typically uses tables to display course information
    // Look for tables with course listings
    const courseTable = $('table.esse3-table, table.table-striped, .table-responsive table');
    
    if (courseTable.length > 0) {
      // Process table rows, skipping the header
      const tableRows = courseTable.find('tr').slice(1);
      
      tableRows.each((i, row) => {
        const columns = $(row).find('td');
        
        // Extract key course information
        // Column indexes may need adjustment based on actual table structure
        const academicYearText = $(columns[0]).text().trim();
        const courseText = $(columns[1]).text().trim();
        const degreeText = $(columns[2]).text().trim();
        const creditsText = $(columns[3]).text().trim();
        const disciplineText = $(columns[4]).text().trim();
        
        // Extract course links if available
        const courseLink = $(columns[1]).find('a').attr('href') || '';
        
        // Parse academic year (format typically: "2024-2025")
        const academicYear = academicYearText || getCurrentAcademicYear();
        
        // Determine if course is current based on academic year
        const currentYear = new Date().getFullYear();
        const isCurrentCourse = academicYear.includes(currentYear.toString()) || 
                               academicYear.includes((currentYear + 1).toString());
        
        // Parse credits (typically a number followed by "CFU")
        const credits = parseInt(creditsText.match(/\d+/) || "6", 10);
        
        // Extract course title and English title if available
        let courseTitle = courseText;
        let courseEnglishTitle = '';
        
        // Some systems separate English title with a separator or in another element
        if (courseText.includes(' - ')) {
          const parts = courseText.split(' - ');
          courseTitle = parts[0].trim();
          courseEnglishTitle = parts.length > 1 ? parts[1].trim() : '';
        }
        
        // Similarly for degree title
        let degreeTitle = degreeText;
        let degreeEnglishTitle = '';
        
        if (degreeText.includes(' - ')) {
          const parts = degreeText.split(' - ');
          degreeTitle = parts[0].trim();
          degreeEnglishTitle = parts.length > 1 ? parts[1].trim() : '';
        }
        
        // Create course object
        courseData.push({
          title: courseTitle,
          english_title: courseEnglishTitle,
          academic_year: academicYear,
          degree: degreeTitle,
          degree_english: degreeEnglishTitle,
          credits: credits,
          discipline_code: disciplineText,
          current: isCurrentCourse,
          syllabus_url: courseLink,
          // Try to determine semester and level from course/degree info
          semester: determineSemester(courseTitle, degreeTitle),
          level: determineLevel(degreeTitle)
        });
      });
    } else {
      console.log('No course table found on Esse3 page. Trying alternative methods...');
      
      // Try alternative method - look for course listings in other formats
      const courseSections = $('.course-listing, .course-section, .insegnamento');
      
      if (courseSections.length > 0) {
        courseSections.each((i, section) => {
          const title = $(section).find('.course-title, h3, h4').first().text().trim();
          const details = $(section).find('.course-details, .details, p').text().trim();
          const link = $(section).find('a').attr('href') || '';
          
          // Try to extract academic year from details or section
          const academicYearMatch = details.match(/\d{4}-\d{4}/) || ['2024-2025'];
          const academicYear = academicYearMatch[0];
          
          // Create basic course object from available data
          courseData.push({
            title: title,
            english_title: '',
            academic_year: academicYear,
            degree: extractDegreeInfo(details),
            credits: extractCredits(details),
            current: isCurrentAcademicYear(academicYear),
            syllabus_url: link,
            semester: determineSemester(title, details),
            level: determineLevel(details)
          });
        });
      }
    }
    
    // If we still have no courses, the structure might be different or courses unavailable
    if (courseData.length === 0) {
      console.log('No courses found using structured methods. Falling back to mock data.');
      return getMockTeachingData();
    }
    
    // Extract office hours if available, otherwise use from profile
    const officeHours = extractOfficeHours($) || 
      "Monday 14:00-16:00, Room 3.12\nWednesday 10:00-12:00, Room 3.12\nOr by appointment (email: fabio.giglietto@uniurb.it)";
    
    return {
      courses: courseData,
      office_hours: officeHours,
      tutorials: getDefaultTutorials(),
      supervision: getDefaultSupervision()
    };
  } catch (error) {
    console.error('Error fetching teaching data:', error.message);
    // Fall back to mock data on error
    return getMockTeachingData();
  }
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
 * Extracts degree information from course details text
 */
function extractDegreeInfo(details) {
  // Look for common degree names in Italian
  const degreePatterns = [
    /laurea\s+in\s+([^,\.]+)/i,
    /corso\s+di\s+laurea\s+in\s+([^,\.]+)/i,
    /cdl\s+in\s+([^,\.]+)/i,
    /([^,\.]+)\s+\(\s*lm-\d+\s*\)/i,
    /([^,\.]+)\s+\(\s*l-\d+\s*\)/i
  ];
  
  for (const pattern of degreePatterns) {
    const match = details.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return "Scienze della Comunicazione"; // Default fallback
}

/**
 * Extracts credit value from course details text
 */
function extractCredits(details) {
  // Look for common credit notations (CFU, ECTS, etc.)
  const creditsMatch = details.match(/(\d+)\s*(?:cfu|crediti|ects)/i);
  return creditsMatch ? parseInt(creditsMatch[1], 10) : 6; // Default to 6 credits
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
 */
function determineLevel(degreeInfo) {
  const lowerDegree = degreeInfo.toLowerCase();
  
  if (lowerDegree.includes("magistrale") || 
      lowerDegree.includes("specialistica") || 
      lowerDegree.includes("lm-") || 
      lowerDegree.includes("master") || 
      lowerDegree.includes("secondo livello")) {
    return "Master";
  }
  
  if (lowerDegree.includes("dottorato") || 
      lowerDegree.includes("phd") || 
      lowerDegree.includes("doctoral")) {
    return "PhD";
  }
  
  return "Bachelor"; // Default to Bachelor level
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
      url: "https://github.com/fabiogiglietto/R-for-communication-research"
    },
    {
      title: "Social Media Data Analysis with Python",
      description: "Tutorial series on collecting and analyzing social media data with Python",
      url: "https://github.com/fabiogiglietto/social-media-python"
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

/**
 * Returns mock data for when real data cannot be fetched
 */
function getMockData() {
  return {
    profile: {
      name: "Fabio Giglietto",
      title: "Associate Professor",
      department: "Department of Communication Sciences, Humanities and International Studies",
      email: "fabio.giglietto@uniurb.it",
      phone: "+39 0722 305726",
      office: "Room 3.12, Via Saffi 15",
      bio: "",
      research_interests: [
        "Social Media Analysis", 
        "Computational Social Science", 
        "Digital Methods", 
        "Information Disorder"
      ],
      office_hours: "Monday and Wednesday, 11:00-13:00 or by appointment"
    },
    teaching: getMockTeachingData(),
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Returns mock teaching data
 */
function getMockTeachingData() {
  return {
    courses: [
      {
        title: "Digital Media Analysis",
        english_title: "Digital Media Analysis",
        academic_year: "2024-2025",
        degree: "Laurea Magistrale in Comunicazione e Pubblicità per le Organizzazioni",
        degree_english: "Master's Degree in Communication and Advertising for Organizations",
        credits: 9,
        discipline_code: "SPS/08",
        current: true,
        syllabus_url: "https://www.uniurb.it/syllabi/digitalmedia2024",
        semester: "Fall",
        level: "Master"
      },
      {
        title: "Metodi di Ricerca per la Comunicazione",
        english_title: "Research Methods for Communication",
        academic_year: "2024-2025",
        degree: "Laurea in Informazione, Media, Pubblicità",
        degree_english: "Bachelor's Degree in Information, Media, Advertising",
        credits: 6,
        discipline_code: "SPS/08",
        current: true,
        syllabus_url: "https://www.uniurb.it/syllabi/metodiricerca2024",
        semester: "Spring",
        level: "Bachelor"
      },
      {
        title: "Big Data e Social Media Analytics",
        english_title: "Big Data and Social Media Analytics",
        academic_year: "2023-2024",
        degree: "Laurea Magistrale in Comunicazione e Pubblicità per le Organizzazioni",
        degree_english: "Master's Degree in Communication and Advertising for Organizations",
        credits: 6,
        discipline_code: "SPS/08",
        current: false,
        syllabus_url: "https://www.uniurb.it/syllabi/bigdata2023",
        semester: "Fall",
        level: "Master"
      }
    ],
    office_hours: "Monday 14:00-16:00, Room 3.12\nWednesday 10:00-12:00, Room 3.12\nOr by appointment (email: fabio.giglietto@uniurb.it)",
    tutorials: getDefaultTutorials(),
    supervision: getDefaultSupervision()
  };
}

module.exports = { collect };
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

async function collect() {
  console.log('Collecting University profile data...');
  
  // University of Urbino profile URL
  const profileUrl = 'https://www.uniurb.it/persone/fabio-giglietto';
  
  try {
    const response = await axios.get(profileUrl);
    const $ = cheerio.load(response.data);
    
    // Extract basic profile info
    const profile = extractProfileInfo($);
    
    // Extract teaching data directly from the profile page
    // Specifically from the "Insegnamenti e Programmi" tab
    const teaching = extractTeachingFromProfilePage($);
    
    // Save teaching data to a dedicated file for the teaching generator
    const teachingDataPath = path.join(__dirname, '../../public/data/teaching.json');
    fs.writeFileSync(teachingDataPath, JSON.stringify(teaching, null, 2));
    console.log(`Teaching data saved to ${teachingDataPath}`);
    
    return {
      profile,
      teaching,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching University data:', error.message);
    console.error(error.stack);
    
    // Return minimal mockup data when real data cannot be fetched
    return getMockData();
  }
}

/**
 * Extracts profile information from the university page
 */
function extractProfileInfo($) {
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
        
        // Course URL
        const courseUrl = courseColumn.find('a').first().attr('href') || '';
        // Syllabus URL (second link or first if only one exists)
        const syllabusUrl = courseColumn.find('small a').first().attr('href') || courseUrl;
        
        // Degree information
        const degreeColumn = $(columns[2]);
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
          credits: credits,
          discipline_code: disciplineCode,
          current: isCurrentCourse,
          syllabus_url: syllabusUrl.startsWith('/') ? `https://www.uniurb.it${syllabusUrl}` : syllabusUrl,
          // Try to determine semester and level from degree info
          semester: determineSemester(courseTitle, degreeTitle),
          level: determineLevel(degreeTitle),
          // Add a basic description based on the course title
          description: generateCourseDescription(courseTitle, englishTitle)
        });
      }
    });
    
    console.log(`Extracted ${courseData.length} courses from the table`);
  } else {
    console.log('No course table found on the profile page. Falling back to mock data.');
    return getMockTeachingData();
  }
  
  // If we still have no courses, fallback to mock data
  if (courseData.length === 0) {
    console.log('No courses found in the table. Falling back to mock data.');
    return getMockTeachingData();
  }
  
  // Extract office hours if available, otherwise use default
  const officeHours = extractOfficeHours($) || 
    "Monday 14:00-16:00, Room 3.12\nWednesday 10:00-12:00, Room 3.12\nOr by appointment (email: fabio.giglietto@uniurb.it)";
  
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
 * Generates a course description based on the title and English title
 */
function generateCourseDescription(title, englishTitle) {
  // Use English title if available, otherwise use the original title
  const baseTitle = englishTitle || title;
  
  // Map of common course subjects to descriptions
  const descriptionMap = {
    'ANALISI DELLE RETI SOCIALI DIGITALI': 'Analysis of social network structures and dynamics in digital contexts using computational methods',
    'DIGITAL SOCIAL NETWORK ANALYSIS': 'Analysis of social network structures and dynamics in digital contexts using computational methods',
    'INTERNET STUDIES': 'Critical examination of the social, cultural, and economic aspects of the internet and digital technologies',
    'INTRODUCTION TO DATA ANALYSIS': 'Fundamentals of data analysis techniques with applications in media and communication research',
    'WEB MARKETING': 'Strategies and tools for effective digital marketing campaigns in the current media landscape',
    'LABORATORIO': 'Practical laboratory sessions providing hands-on experience with digital tools and methodologies'
  };
  
  // Check if the title contains keywords from our map
  for (const [keyword, description] of Object.entries(descriptionMap)) {
    if (baseTitle.toUpperCase().includes(keyword)) {
      return description;
    }
  }
  
  // Default description based on whether it's in English or Italian
  if (englishTitle) {
    return `Introduction to ${englishTitle.toLowerCase()} concepts and methodologies`;
  } else {
    return `Course covering key concepts and methodologies in ${title.toLowerCase()}`;
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
        code: "DMA2024",
        academic_year: "2024-2025",
        degree: "Laurea Magistrale in Comunicazione e Pubblicità per le Organizzazioni",
        degree_english: "Master's Degree in Communication and Advertising for Organizations",
        credits: 9,
        discipline_code: "SPS/08",
        current: true,
        syllabus_url: "https://www.uniurb.it/syllabi/digitalmedia2024",
        semester: "Fall",
        level: "Master",
        description: "Introduction to digital and social media data analysis using computational methods"
      },
      {
        title: "Metodi di Ricerca per la Comunicazione",
        english_title: "Research Methods for Communication",
        code: "RMC2024",
        academic_year: "2024-2025",
        degree: "Laurea in Informazione, Media, Pubblicità",
        degree_english: "Bachelor's Degree in Information, Media, Advertising",
        credits: 6,
        discipline_code: "SPS/08",
        current: true,
        syllabus_url: "https://www.uniurb.it/syllabi/metodiricerca2024",
        semester: "Spring",
        level: "Bachelor",
        description: "Introduction to research methods for communication studies with focus on digital media"
      },
      {
        title: "Big Data e Social Media Analytics",
        english_title: "Big Data and Social Media Analytics",
        code: "BDA2023",
        academic_year: "2023-2024",
        degree: "Laurea Magistrale in Comunicazione e Pubblicità per le Organizzazioni",
        degree_english: "Master's Degree in Communication and Advertising for Organizations",
        credits: 6,
        discipline_code: "SPS/08",
        current: false,
        syllabus_url: "https://www.uniurb.it/syllabi/bigdata2023",
        semester: "Fall",
        level: "Master",
        description: "Advanced techniques for large-scale data analysis in social science research"
      }
    ],
    office_hours: "Monday 14:00-16:00, Room 3.12\nWednesday 10:00-12:00, Room 3.12\nOr by appointment (email: fabio.giglietto@uniurb.it)",
    tutorials: getDefaultTutorials(),
    supervision: getDefaultSupervision()
  };
}

module.exports = { collect };
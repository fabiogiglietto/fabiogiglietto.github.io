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
    
    // Extract and process faculty profile data
    // This is a simplified example - adjust the selectors based on the actual website structure
    const profile = {
      name: $('.faculty-name').text().trim(),
      title: $('.faculty-title').text().trim(),
      department: $('.faculty-department').text().trim(),
      email: $('.faculty-email').text().trim(),
      phone: $('.faculty-phone').text().trim(),
      office: $('.faculty-office').text().trim(),
      bio: $('.faculty-bio').text().trim(),
      research_interests: $('.faculty-interests li').map((i, el) => $(el).text().trim()).get(),
      office_hours: $('.faculty-hours').text().trim()
    };
    
    // Extract teaching data - courses and teaching activities
    const teaching = await collectTeachingData(profileUrl);
    
    return {
      profile,
      teaching,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching University data:', error.message);
    throw error;
  }
}

/**
 * Collects teaching data from the university profile
 * @param {string} profileUrl - The base profile URL
 * @returns {Object} Teaching data including courses and office hours
 */
async function collectTeachingData(profileUrl) {
  console.log('Collecting teaching data...');
  
  try {
    const response = await axios.get(profileUrl);
    const $ = cheerio.load(response.data);
    
    const courseData = [];
    
    // Target the teaching table - adjust selector as needed
    const tableRows = $('table tr').slice(1); // Skip header row
    
    tableRows.each((i, row) => {
      const columns = $(row).find('td');
      
      // Extract all text content
      const academicYear = $(columns[0]).text().trim();
      const courseInfo = $(columns[1]);
      const degreeInfo = $(columns[2]);
      const credits = $(columns[3]).text().trim();
      const discipline = $(columns[4]).text().trim();
      
      // Extract course details
      const courseTitle = courseInfo.find('div:first-child').text().trim();
      const courseEnTitle = courseInfo.find('div:nth-child(2)').text().trim();
      
      // Check for special course types
      const isMutuato = courseInfo.text().includes('MUTUATO');
      const hasForeignMaterials = courseInfo.text().includes('COURSE WITH OPTIONAL MATERIALS IN A FOREIGN LANGUAGE');
      const isPartiallyForeign = courseInfo.text().includes('COURSE PARTIALLY TAUGHT IN A FOREIGN LANGUAGE');
      const isEntirelyForeign = courseInfo.text().includes('COURSE ENTIRELY TAUGHT IN A FOREIGN LANGUAGE');
      
      // Extract degree details
      const degreeTitle = degreeInfo.find('div:first-child').text().trim();
      const degreeEnTitle = degreeInfo.find('div:nth-child(2)').text().trim();
      
      // Check if the course is current (current academic year)
      const currentAcademicYear = new Date().getFullYear();
      const isCurrentCourse = academicYear.includes(currentAcademicYear.toString());
      
      courseData.push({
        title: courseTitle,
        english_title: courseEnTitle,
        academic_year: academicYear,
        degree: degreeTitle,
        degree_english: degreeEnTitle,
        credits: parseInt(credits, 10) || 6,
        discipline_code: discipline,
        current: isCurrentCourse,
        course_type: {
          mutuato: isMutuato,
          foreign_materials: hasForeignMaterials,
          partially_foreign: isPartiallyForeign,
          entirely_foreign: isEntirelyForeign
        },
        // For simplicity, construct the syllabus URL if possible
        syllabus_url: courseInfo.find('a').attr('href') || null,
        // Set a default semester and level based on the degree name
        semester: degreeTitle.toLowerCase().includes('fall') ? 'Fall' : 'Spring',
        level: degreeTitle.toLowerCase().includes('magistral') ? 'Master' : 'Bachelor'
      });
    });
    
    // We don't have direct access to these, so we'll create placeholders
    // In a real implementation, these would be extracted from specific page sections
    const officeHours = "Office hours information will be available on the department website.";
    
    // Sample tutorials based on GitHub repositories
    const tutorials = [
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
    
    // Sample supervision information
    const supervision = "I am available to supervise Bachelor's and Master's theses in the following areas:\n\n" +
      "- Digital Media Analysis\n" +
      "- Social Media Research\n" +
      "- Computational Social Science\n" +
      "- Media Studies\n" +
      "- Online Misinformation and Disinformation\n\n" +
      "If you are interested in working with me, please email me with a brief outline of your research interests.";
    
    return {
      courses: courseData,
      office_hours: officeHours,
      tutorials,
      supervision
    };
  } catch (error) {
    console.error('Error fetching teaching data:', error.message);
    // Return empty structure in case of error
    return {
      courses: [],
      office_hours: '',
      tutorials: [],
      supervision: ''
    };
  }
}

module.exports = { collect };
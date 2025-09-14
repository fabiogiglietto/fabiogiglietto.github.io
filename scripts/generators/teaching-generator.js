/**
 * Teaching data generator
 * 
 * Converts university teaching data from JSON to YAML format
 * and saves it to the Jekyll _data directory
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Generates the teaching.yml file from teaching data
 * @returns {boolean} Success status
 */
async function generateTeachingData() {
  try {
    console.log('Generating teaching data...');
    
    // Try to read from dedicated teaching data first
    const teachingPath = path.join(__dirname, '../../public/data/teaching.json');
    const universityPath = path.join(__dirname, '../../public/data/university.json');
    
    let teachingData;
    
    // First try to read from dedicated teaching.json
    if (fs.existsSync(teachingPath)) {
      console.log('Using dedicated teaching data file');
      const data = JSON.parse(fs.readFileSync(teachingPath, 'utf8'));
      teachingData = formatTeachingData(data);
    }
    // Fall back to university.json if teaching.json doesn't exist
    else if (fs.existsSync(universityPath)) {
      console.log('Teaching data file not found, falling back to university data');
      
      // Read and parse the university data
      const universityData = JSON.parse(fs.readFileSync(universityPath, 'utf8'));
      
      // Check if teaching data exists in university data
      if (!universityData.teaching) {
        console.error('No teaching data found in university data');
        return false;
      }
      
      // Format the teaching data
      teachingData = formatTeachingData(universityData.teaching);
    } else {
      console.error('No data files found for teaching information');
      return false;
    }
    
    // Convert data to YAML
    const yamlData = yaml.dump(teachingData, {
      lineWidth: 100,
      noRefs: true,
      quotingType: '"'
    });
    
    // Add comment header
    const yamlWithHeader = 
`# Teaching data file
# This file is generated automatically by the teaching-generator.js script
# Manual changes will be overwritten when the script runs

${yamlData}`;
    
    // Write to _data/teaching.yml
    const yamlOutputPath = path.join(__dirname, '../../_data/teaching.yml');
    fs.writeFileSync(yamlOutputPath, yamlWithHeader);
    
    // Also write to public/data/teaching.json for JavaScript loading
    const jsonOutputPath = path.join(__dirname, '../../public/data/teaching.json');
    fs.writeFileSync(jsonOutputPath, JSON.stringify(teachingData, null, 2));
    
    console.log('Teaching data generated successfully (both YAML and JSON)');
    return true;
  } catch (error) {
    console.error('Error generating teaching data:', error);
    return false;
  }
}

/**
 * Determines course level based on Italian university degree classification
 * @param {Object} course - Course data
 * @returns {string} - Course level ('Bachelor', 'Master', or 'PhD')
 */
function determineCourseLevel(course) {
  // Determine course level based on Italian university degree classification
  // LM = Laurea Magistrale (Master's degree)
  // L = Laurea (Bachelor's degree)
  
  const degreeText = course.degree || course.degree_english || '';
  
  // Look for LM- pattern which indicates Laurea Magistrale (Master's)
  if (degreeText.includes('(LM-') || degreeText.includes('LM-')) {
    return 'Master';
  }
  
  // Look for L- pattern which indicates Laurea (Bachelor's)
  if (degreeText.includes('(L-') || degreeText.includes('L-')) {
    return 'Bachelor';
  }
  
  // Manual mapping based on known degree programs
  // These mappings are based on checking the syllabus URLs for classification codes
  const masterDegreePrograms = [
    'Informatica e Innovazione Digitale', // LM-18
    'Informatics and Digital Innovation', // LM-18
    'Comunicazione e Pubblicità per le Organizzazioni', // LM-59
    'Advertising and Organizations Communication', // LM-59
  ];
  
  const phdDegreePrograms = [
    'Studi Umanistici', // PhD level
    'Humanities', // PhD level
  ];
  
  const bachelorDegreePrograms = [
    'Informazione, Media, Pubblicità', // L-20
    'Information, media and advertisement', // L-20
    'Informatica Applicata', // Typically L- level 
    'Applied Informatics', // Typically L- level
    'Scienze della Comunicazione', // L- level
    'Communication Sciences', // L- level
  ];
  
  // Check if degree program is known PhD level
  if (phdDegreePrograms.some(program => degreeText.includes(program))) {
    return 'PhD';
  }
  
  // Check if degree program is known Master's level
  if (masterDegreePrograms.some(program => degreeText.includes(program))) {
    return 'Master';
  }
  
  // Check if degree program is known Bachelor's level
  if (bachelorDegreePrograms.some(program => degreeText.includes(program))) {
    return 'Bachelor';
  }
  
  // Default to Bachelor for unknown degree programs
  return 'Bachelor';
}

/**
 * Formats the teaching data for YAML output
 * @param {Object} teachingData - Raw teaching data (from university or teaching collector)
 * @returns {Object} - Formatted teaching data
 */
function formatTeachingData(teachingData) {
  // Create a formatted object for the teaching data
  const formatted = {
    courses: [],
    office_hours: teachingData.office_hours || '',
    tutorials: teachingData.tutorials || [],
    supervision: teachingData.supervision || ''
  };
  
  // Format courses data from either source
  if (teachingData.courses && teachingData.courses.length) {
    // First, format and sort all courses
    const allCourses = teachingData.courses.map(course => ({
      title: course.title,
      code: course.code || course.discipline_code || `CRS${formatted.courses.length + 1}`,
      description: course.description || course.english_title || course.title,
      level: determineCourseLevel(course),
      academic_year: course.academic_year || '2024-2025',
      credits: course.credits || 6,
      current: typeof course.current === 'boolean' ? course.current : false,
      semester: course.semester || 'Fall',
      schedule: course.schedule || '',
      syllabus_url: course.syllabus_url || ''
    }));
    
    // Sort courses by current status (current first), then by academic year (newest first)
    allCourses.sort((a, b) => {
      // Sort by current status first
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      
      // Then by academic year (assuming format YYYY-YYYY)
      const yearA = a.academic_year ? a.academic_year.split('-')[0] : '';
      const yearB = b.academic_year ? b.academic_year.split('-')[0] : '';
      
      return yearB.localeCompare(yearA);
    });
    
    // Get all current courses and remove duplicates by title
    const currentCourses = [];
    const currentCourseTitles = new Set();
    
    // Filter current courses and remove duplicates
    allCourses.filter(course => course.current).forEach(course => {
      // Create a unique key from the title and academic year
      const courseKey = `${course.title}-${course.academic_year}`;
      
      // Only add the course if we haven't seen this title+year combination
      if (!currentCourseTitles.has(courseKey)) {
        currentCourseTitles.add(courseKey);
        currentCourses.push(course);
      }
    });
    
    // Get past courses (limit to most recent 10 courses)
    const pastCourseTitles = new Set();
    const pastCourses = [];
    
    // Filter past courses, remove duplicates, and limit to 10
    allCourses.filter(course => !course.current).forEach(course => {
      // Create a unique key from the title and academic year
      const courseKey = `${course.title}-${course.academic_year}`;
      
      // Only add the course if we haven't seen this title+year combination and we haven't reached 10 past courses
      if (!pastCourseTitles.has(courseKey) && pastCourses.length < 10) {
        pastCourseTitles.add(courseKey);
        pastCourses.push(course);
      }
    });
    
    // Combine current and past courses
    formatted.courses = [...currentCourses, ...pastCourses];
    
    // Add schedule information to current courses if missing
    // This is helpful for display purposes
    formatted.courses.forEach(course => {
      if (course.current && !course.schedule) {
        // Generate a placeholder schedule based on course name
        const hash = hashString(course.title);
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const day = days[hash % days.length];
        const hour = 9 + (hash % 8); // Classes between 9-17
        course.schedule = `${day} ${hour}:00-${hour+2}:00, Room ${Math.floor(hash % 5) + 1}.${Math.floor(hash % 10) + 1}`;
      }
    });
  }
  
  return formatted;
}

/**
 * Simple hash function for generating consistent pseudo-random values from strings
 * Used to generate placeholder schedules that remain consistent for the same course name
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Run the generator if this file is called directly
if (require.main === module) {
  (async () => {
    try {
      const result = await generateTeachingData();
      if (result) {
        console.log('Teaching data generated successfully when run directly.');
      } else {
        console.error('Failed to generate teaching data when run directly.');
        process.exit(1);
      }
    } catch (error) {
      console.error('Error running teaching generator directly:', error);
      process.exit(1);
    }
  })();
}

module.exports = { generateTeachingData };
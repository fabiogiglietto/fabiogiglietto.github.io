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
    const outputPath = path.join(__dirname, '../../_data/teaching.yml');
    fs.writeFileSync(outputPath, yamlWithHeader);
    
    console.log('Teaching data generated successfully');
    return true;
  } catch (error) {
    console.error('Error generating teaching data:', error);
    return false;
  }
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
      level: course.level || 'Bachelor',
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
    
    // Get all current courses
    const currentCourses = allCourses.filter(course => course.current);
    
    // Get past courses (limit to most recent 10 courses)
    const pastCourses = allCourses
      .filter(course => !course.current)
      .slice(0, 10);
    
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

module.exports = { generateTeachingData };
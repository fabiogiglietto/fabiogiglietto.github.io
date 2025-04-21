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
 * Generates the teaching.yml file from university data
 * @returns {boolean} Success status
 */
async function generateTeachingData() {
  try {
    console.log('Generating teaching data...');
    
    // Read university data
    const dataPath = path.join(__dirname, '../../public/data/university.json');
    
    // Check if the file exists
    if (!fs.existsSync(dataPath)) {
      console.error('University data file does not exist');
      return false;
    }
    
    // Read and parse the JSON data
    const universityData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    // Check if teaching data exists
    if (!universityData.teaching) {
      console.error('No teaching data found in university data');
      return false;
    }
    
    // Format the teaching data
    const teachingData = formatTeachingData(universityData.teaching);
    
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
 * @param {Object} teachingData - Raw teaching data from university collector
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
  
  // Format courses data
  if (teachingData.courses && teachingData.courses.length) {
    teachingData.courses.forEach(course => {
      formatted.courses.push({
        title: course.title,
        code: course.discipline_code || `CRS${formatted.courses.length + 1}`,
        description: course.english_title || course.title,
        level: course.level || 'Bachelor',
        academic_year: course.academic_year || '2024-2025',
        credits: course.credits || 6,
        current: course.current || false,
        semester: course.semester || 'Fall',
        schedule: course.schedule || '',
        syllabus_url: course.syllabus_url || ''
      });
    });
    
    // Sort courses by current status (current first), then by academic year (newest first)
    formatted.courses.sort((a, b) => {
      // Sort by current status first
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      
      // Then by academic year (assuming format YYYY-YYYY)
      const yearA = a.academic_year ? a.academic_year.split('-')[0] : '';
      const yearB = b.academic_year ? b.academic_year.split('-')[0] : '';
      
      return yearB.localeCompare(yearA);
    });
  }
  
  return formatted;
}

module.exports = { generateTeachingData };
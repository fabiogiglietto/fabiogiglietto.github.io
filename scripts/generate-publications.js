/**
 * Standalone Publications Generator
 * 
 * This script converts Google Scholar data from public/data/scholar.json
 * to Jekyll-compatible YAML in _data/publications.yml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

async function generatePublicationsData() {
  console.log('Generating publications data...');
  
  try {
    // Read Google Scholar data
    const scholarDataPath = path.join(__dirname, '../public/data/scholar.json');
    if (!fs.existsSync(scholarDataPath)) {
      console.log('Scholar data not found. Skipping publications generation.');
      return false;
    }
    
    const scholarData = JSON.parse(fs.readFileSync(scholarDataPath, 'utf8'));
    
    // Convert to publications format
    const publications = scholarData.publications.map(pub => {
      // Extract DOI from venue if available
      const doiMatch = pub.venue.match(/doi\.org\/(\S+)/i);
      const doi = doiMatch ? doiMatch[1] : null;
      
      // Format authors to APA style
      const authors = formatAuthorList(pub.authors);
      
      return {
        title: pub.title,
        authors: authors,
        venue: pub.venue.replace(/,\s*\d{4}$/, ''), // Remove year from venue if present
        year: parseInt(pub.year) || new Date().getFullYear(),
        doi: doi,
        citations: parseInt(pub.citations) || 0,
        type: determinePublicationType(pub.venue),
      };
    });
    
    // Sort by year (newest first)
    publications.sort((a, b) => b.year - a.year);
    
    // Convert to YAML and write to _data directory
    const yamlStr = yaml.dump(publications, {
      quotingType: '"',
      lineWidth: 120,
    });
    
    const outputPath = path.join(__dirname, '../_data/publications.yml');
    fs.writeFileSync(outputPath, yamlStr, 'utf8');
    
    console.log(`Generated publications data with ${publications.length} entries`);
    return true;
  } catch (error) {
    console.error('Error generating publications data:', error);
    return false;
  }
}

// Helper function to format author list to APA style
function formatAuthorList(authorStr) {
  // Split authors string by commas
  const authors = authorStr.split(',').map(author => author.trim());
  
  // Check if the first author is Fabio Giglietto
  if (authors.length > 0 && (authors[0] === 'F Giglietto' || authors[0].startsWith('F '))) {
    return authorStr; // Return the original author string for now
  }
  
  // Format each author correctly
  const formattedAuthors = authors.map(author => {
    const parts = author.split(' ');
    if (parts.length <= 1) return author;
    
    // Extract initials and surnames
    const surname = parts[0];
    const initials = parts.slice(1).map(p => p[0]).join('. ');
    
    return `${surname}, ${initials}.`;
  });
  
  return formattedAuthors.join(', ');
}

// Helper function to determine publication type based on venue
function determinePublicationType(venue) {
  const venueLC = venue.toLowerCase();
  
  if (venueLC.includes('journal') || venueLC.includes('review')) {
    return 'journal';
  } else if (venueLC.includes('conference') || venueLC.includes('proceedings')) {
    return 'conference';
  } else if (venueLC.includes('book') || venueLC.includes('chapter')) {
    return 'book';
  } else {
    return 'article';
  }
}

// Run the generator directly when this script is executed
generatePublicationsData().then(success => {
  if (success) {
    console.log('Publications generation completed successfully');
  } else {
    console.log('Publications generation failed or was skipped');
    process.exit(1);
  }
}).catch(error => {
  console.error('Error in publications generation:', error);
  process.exit(1);
});
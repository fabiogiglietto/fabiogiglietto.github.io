/**
 * Standalone Publications Generator
 * 
 * This script converts publication data from multiple sources
 * (ORCID, Google Scholar, Web of Science, Scopus) to Jekyll-compatible 
 * YAML in _data/publications.yml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

async function generatePublicationsData() {
  console.log('Generating publications data...');
  
  try {
    // Try to read aggregated publications data first
    const aggregatedDataPath = path.join(__dirname, '../public/data/aggregated-publications.json');
    const scholarDataPath = path.join(__dirname, '../public/data/scholar.json');
    
    // Check if aggregated data exists
    let publications = [];
    
    // ALWAYS use Google Scholar data directly for now, bypass aggregation
    if (fs.existsSync(scholarDataPath)) {
      console.log('Using Google Scholar data directly for all publications');
      const scholarData = JSON.parse(fs.readFileSync(scholarDataPath, 'utf8'));
      
      // Convert to publications format
      publications = scholarData.publications.map(pub => {
        // Extract DOI from venue if available
        const doiMatch = pub.venue?.match(/doi\.org\/(\S+)/i);
        const doi = doiMatch ? doiMatch[1] : null;
        
        // Format authors
        const authors = formatAuthorList(pub.authors || '');
        
        return {
          title: pub.title,
          authors: authors,
          venue: pub.venue?.replace(/,\s*\d{4}$/, '') || '', // Remove year from venue if present
          year: parseInt(pub.year) || new Date().getFullYear(),
          doi: doi,
          citations: parseInt(pub.citations) || 0,
          citation_sources: {
            scholar: parseInt(pub.citations) || 0,
            wos: null,
            scopus: null
          },
          type: determinePublicationType(pub.venue || ''),
          urls: {
            doi: doi ? `https://doi.org/${doi}` : null,
            scholar: `https://scholar.google.com/citations?user=FmenbcUAAAAJ&view_op=list_works&sortby=pubdate`
          }
        };
      });
    }
    // If Google Scholar data isn't available, try aggregated data
    else if (fs.existsSync(aggregatedDataPath)) {
      console.log('Using aggregated publications data from multiple sources');
      const aggregatedData = JSON.parse(fs.readFileSync(aggregatedDataPath, 'utf8'));
      
      // Convert aggregated data to publications format and filter out those without a valid year
      publications = aggregatedData.publications
        .map(pub => {
          if (!pub.year) {
            console.log(`Skipping publication without year: "${pub.title}"`);
            return null;
          }
          
          return {
            title: pub.title,
            authors: pub.authors || formatAuthorsFromTitle(pub.title),
            venue: pub.venue || '',
            year: pub.year, // Only use the explicitly provided year
            doi: pub.doi,
            citations: pub.metrics.total_citations || 0,
            citation_sources: {
              scholar: pub.citations.scholar,
              wos: pub.citations.wos,
              scopus: pub.citations.scopus
            },
            type: determinePublicationType(pub.venue || ''),
            urls: {
              doi: pub.doi ? `https://doi.org/${pub.doi}` : null,
              orcid: pub.source_urls.orcid,
              scholar: pub.source_urls.scholar,
              wos: pub.source_urls.wos,
              scopus: pub.source_urls.scopus
            }
          };
        })
        .filter(pub => pub !== null);
    } 
    // Fall back to Google Scholar data if aggregated data doesn't exist
    else if (fs.existsSync(scholarDataPath)) {
      console.log('Falling back to Google Scholar data');
      const scholarData = JSON.parse(fs.readFileSync(scholarDataPath, 'utf8'));
      
      // Convert to publications format and filter out those without a valid year
      publications = scholarData.publications
        .map(pub => {
          // Skip publications without a year
          if (!pub.year) {
            console.log(`Skipping Scholar publication without year: "${pub.title}"`);
            return null;
          }
          
          // Extract DOI from venue if available
          const doiMatch = pub.venue?.match(/doi\.org\/(\S+)/i);
          const doi = doiMatch ? doiMatch[1] : null;
          
          // Format authors
          const authors = formatAuthorList(pub.authors || '');
          
          return {
            title: pub.title,
            authors: authors,
            venue: pub.venue?.replace(/,\s*\d{4}$/, '') || '', // Remove year from venue if present
            year: parseInt(pub.year), // Only use the explicitly provided year
            doi: doi,
            citations: parseInt(pub.citations) || 0,
            citation_sources: {
              scholar: parseInt(pub.citations) || 0,
              wos: null,
              scopus: null
            },
            type: determinePublicationType(pub.venue || ''),
            urls: {
              doi: doi ? `https://doi.org/${doi}` : null,
              scholar: `https://scholar.google.com/citations?user=FmenbcUAAAAJ&view_op=list_works&sortby=pubdate`
            }
          };
        })
        .filter(pub => pub !== null);
    } else {
      console.log('No publication data found. Skipping publications generation.');
      return false;
    }
    
    // Sort by year (newest first), then by citations (highest first)
    publications.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.citations - a.citations;
    });
    
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

// Try to extract authors from publication title when no author data is available
function formatAuthorsFromTitle(title) {
  // This is a fallback function when we have no author information
  // It returns a default string, but in a real implementation this would
  // try to use more sophisticated methods to extract or infer author information
  
  if (title.toLowerCase().includes("giglietto")) {
    return "Giglietto, F., et al.";
  }
  
  return "Giglietto, F.";
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
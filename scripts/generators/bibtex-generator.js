/**
 * BibTeX generator
 *
 * Converts aggregated publications data to BibTeX format
 * for citation management tools.
 */

const fs = require('fs');
const path = require('path');

/**
 * Escape special LaTeX characters in a string
 */
function escapeLatex(str) {
  if (!str) return '';
  return str
    // First decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Then escape LaTeX special characters
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Convert author string to BibTeX format
 * Handles multiple input formats:
 * - "Giglietto, Fabio; Selva, Donatella" (semicolon-separated, "Last, First")
 * - "Giglietto, Fabio" (single author in "Last, First" format)
 * - "F Giglietto, D Selva" (comma-separated, "Initial Last")
 * - "Fabio Giglietto, Massimo Terenzi" (comma-separated, "First Last")
 * Output: "Giglietto, Fabio and Selva, Donatella"
 */
function formatAuthorsForBibtex(authorStr) {
  if (!authorStr) return '';

  // Already in BibTeX format
  if (authorStr.includes(' and ')) {
    return authorStr;
  }

  let authors;

  // Check if semicolon-separated (usually "Last, First" format)
  if (authorStr.includes(';')) {
    authors = authorStr.split(';').map(a => a.trim()).filter(a => a);
  } else if (authorStr.includes(',')) {
    // Comma-separated - need to determine if commas separate authors or "Last, First" parts
    const parts = authorStr.split(',').map(a => a.trim()).filter(a => a);

    // Heuristic: if we have exactly 2 parts and the second part looks like a first name
    // (single word, starts with capital, no spaces or just initials), it's "Last, First"
    if (parts.length === 2) {
      const secondPart = parts[1];
      // Check if second part is a first name (single word or initials like "F." or "F. G.")
      const looksLikeFirstName = /^[A-Z][a-z]*\.?(\s+[A-Z]\.?)*$/.test(secondPart);
      if (looksLikeFirstName) {
        // It's a single author in "Last, First" format
        return authorStr;
      }
    }

    // Check if parts alternate between surnames and first names (Last, First, Last, First)
    // by looking at pattern: if even-indexed items have no space and odd ones look like first names
    const isLastFirstFormat = parts.length >= 2 && parts.length % 2 === 0 &&
      parts.every((part, i) => {
        if (i % 2 === 0) {
          // Even index: should be a last name (single word, no initials pattern)
          return !part.includes('.') && part.split(/\s+/).length === 1;
        } else {
          // Odd index: should be a first name
          return /^[A-Z]/.test(part);
        }
      });

    if (isLastFirstFormat) {
      // Reconstruct as "Last, First" pairs
      authors = [];
      for (let i = 0; i < parts.length; i += 2) {
        authors.push(`${parts[i]}, ${parts[i + 1]}`);
      }
    } else {
      // Comma separates different authors (like "F Giglietto, D Selva")
      authors = parts;
    }
  } else {
    // Single author with no comma
    authors = [authorStr];
  }

  const formattedAuthors = authors.map(author => {
    // Already in "Last, First" format
    if (author.includes(',')) {
      return author;
    }

    // Handle "First Last" or "F. Last" or "F Last" format
    const parts = author.split(/\s+/);
    if (parts.length === 1) {
      return parts[0];
    }

    // Last part is surname, rest are first names/initials
    const lastName = parts[parts.length - 1];
    const firstNames = parts.slice(0, -1).join(' ');

    return `${lastName}, ${firstNames}`;
  });

  return formattedAuthors.join(' and ');
}

/**
 * Map publication type to BibTeX entry type
 */
function getBibtexType(pubType) {
  const typeMap = {
    'journal-article': 'article',
    'conference-proceeding': 'inproceedings',
    'proceedings-article': 'inproceedings',
    'book': 'book',
    'book-chapter': 'incollection',
    'edited-book': 'book',
    'report': 'techreport',
    'thesis': 'phdthesis',
    'dissertation': 'phdthesis',
    'working-paper': 'unpublished',
    'preprint': 'unpublished'
  };

  return typeMap[pubType] || 'misc';
}

/**
 * Generate a unique citation key
 */
function generateCitationKey(pub, usedKeys) {
  // Extract first author's last name
  let lastName = 'Unknown';
  if (pub.authors) {
    const firstAuthor = pub.authors.split(/[,;&]|(\sand\s)/)[0].trim();
    const parts = firstAuthor.split(/\s+/);
    lastName = parts[parts.length - 1].replace(/[^a-zA-Z]/g, '');
  }

  const year = pub.year || 'XXXX';
  let baseKey = `${lastName}${year}`;

  // Make key unique by adding letter suffix
  let key = baseKey;
  let suffix = 'a';
  while (usedKeys.has(key)) {
    key = `${baseKey}${suffix}`;
    suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
  }

  usedKeys.add(key);
  return key;
}

/**
 * Convert month number to BibTeX month abbreviation
 */
function formatMonth(month) {
  const months = {
    1: 'jan', 2: 'feb', 3: 'mar', 4: 'apr',
    5: 'may', 6: 'jun', 7: 'jul', 8: 'aug',
    9: 'sep', 10: 'oct', 11: 'nov', 12: 'dec'
  };
  return months[month] || null;
}

/**
 * Convert a publication to BibTeX format
 */
function publicationToBibtex(pub, citationKey) {
  const bibtexType = getBibtexType(pub.type || pub.crossref_type);
  const fields = [];

  // Author (required for most types)
  if (pub.authors) {
    fields.push(`  author = {${formatAuthorsForBibtex(pub.authors)}}`);
  }

  // Title (required)
  fields.push(`  title = {${escapeLatex(pub.title)}}`);

  // Year (required)
  if (pub.year) {
    fields.push(`  year = {${pub.year}}`);
  }

  // Month (optional)
  const month = formatMonth(pub.month);
  if (month) {
    fields.push(`  month = ${month}`);
  }

  // Venue-specific fields
  if (bibtexType === 'article' && pub.venue) {
    fields.push(`  journal = {${escapeLatex(pub.venue)}}`);
  } else if ((bibtexType === 'inproceedings' || bibtexType === 'incollection') && pub.venue) {
    fields.push(`  booktitle = {${escapeLatex(pub.venue)}}`);
  }

  // Publisher
  if (pub.publisher) {
    fields.push(`  publisher = {${escapeLatex(pub.publisher)}}`);
  }

  // DOI
  if (pub.doi) {
    fields.push(`  doi = {${pub.doi}}`);
  }

  // URL (use DOI URL or other available URL)
  if (pub.doi) {
    fields.push(`  url = {https://doi.org/${pub.doi}}`);
  } else if (pub.source_urls) {
    const url = pub.source_urls.orcid || pub.source_urls.scholar || pub.source_urls.semanticScholar;
    if (url) {
      fields.push(`  url = {${url}}`);
    }
  }

  return `@${bibtexType}{${citationKey},\n${fields.join(',\n')}\n}`;
}

/**
 * Generate BibTeX file from aggregated publications
 */
async function generateBibtex() {
  console.log('Generating BibTeX data...');

  try {
    const aggregatedDataPath = path.join(__dirname, '../../public/data/aggregated-publications.json');

    if (!fs.existsSync(aggregatedDataPath)) {
      console.log('No aggregated publications data found. Skipping BibTeX generation.');
      return false;
    }

    const aggregatedData = JSON.parse(fs.readFileSync(aggregatedDataPath, 'utf8'));
    const publications = aggregatedData.publications || [];

    if (publications.length === 0) {
      console.log('No publications found. Skipping BibTeX generation.');
      return false;
    }

    // Sort publications by year (newest first)
    publications.sort((a, b) => (b.year || 0) - (a.year || 0));

    // Generate BibTeX entries
    const usedKeys = new Set();
    const bibtexEntries = publications
      .filter(pub => pub.title && pub.year) // Only include publications with title and year
      .map(pub => {
        const key = generateCitationKey(pub, usedKeys);
        return publicationToBibtex(pub, key);
      });

    // Create header comment
    const header = `% BibTeX bibliography file
% Generated automatically from aggregated publication data
% Last updated: ${new Date().toISOString()}
% Total entries: ${bibtexEntries.length}
%
% Source: https://fabiogiglietto.github.io/public/data/publications.bib

`;

    // Write to file
    const outputPath = path.join(__dirname, '../../public/data/publications.bib');
    fs.writeFileSync(outputPath, header + bibtexEntries.join('\n\n') + '\n', 'utf8');

    console.log(`Generated BibTeX file with ${bibtexEntries.length} entries`);
    return true;
  } catch (error) {
    console.error('Error generating BibTeX data:', error);
    return false;
  }
}

// Allow running directly
if (require.main === module) {
  generateBibtex();
}

module.exports = { generateBibtex };

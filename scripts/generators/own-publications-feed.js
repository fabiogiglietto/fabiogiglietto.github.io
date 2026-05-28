/**
 * Own-publications feed generator.
 *
 * Publishes Fabio Giglietto's own publications (the ORCID-derived list this
 * site already maintains) as a JSON Feed at `public/data/own-publications.json`.
 *
 * This file is the cross-repo contract consumed downstream by:
 *  - research-radio   — generates a podcast episode for 2026+ papers
 *  - fg-zettelkasten  — generates a zettelkasten note for eligible papers
 *
 * The shape mirrors the toread JSON Feed (item `id` = `bibtex:<key>`, an
 * `_academic` object) so downstream parsers can be reused unchanged.
 */

const fs = require('fs');
const path = require('path');
const { generateBibtexKey } = require('../lib/bibtex-key');
const { resolveOaPdf } = require('../lib/unpaywall');
const { findOraPdfByDoi } = require('../lib/ora-search');
const config = require('../config');

// Venues excluded from the feed: short conference proceedings that are not
// substantial enough to warrant a zettelkasten note or a podcast episode.
// Matched as a case-insensitive substring of the publication venue.
const EXCLUDED_VENUE_PATTERNS = ['selected papers of internet research'];

/** True when a publication's venue is an excluded short-proceedings venue. */
function isExcludedVenue(venue) {
  if (!venue) return false;
  const v = venue.toLowerCase();
  return EXCLUDED_VENUE_PATTERNS.some((pattern) => v.includes(pattern));
}

/** "Last, First; Last, First" -> [{ name: "First Last" }, ...] */
function parseAuthors(authorStr) {
  if (!authorStr) return [];
  return authorStr
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      const comma = a.indexOf(',');
      if (comma === -1) return { name: a };
      const last = a.slice(0, comma).trim();
      const first = a.slice(comma + 1).trim();
      return { name: first ? `${first} ${last}` : last };
    });
}

async function generateOwnPublicationsFeed() {
  console.log('Generating own-publications feed...');

  try {
    const aggregatedDataPath = path.join(
      __dirname,
      '../../public/data/aggregated-publications.json'
    );

    if (!fs.existsSync(aggregatedDataPath)) {
      console.log('No aggregated publications data found. Skipping own-publications feed.');
      return false;
    }

    const aggregated = JSON.parse(fs.readFileSync(aggregatedDataPath, 'utf8'));
    const allPublications = (aggregated.publications || []).filter(
      (p) => p.title && p.year
    );
    const publications = allPublications.filter((p) => !isExcludedVenue(p.venue));
    const excludedCount = allPublications.length - publications.length;
    if (excludedCount > 0) {
      console.log(`Excluded ${excludedCount} short-proceedings publication(s) by venue`);
    }

    if (publications.length === 0) {
      console.log('No publications found. Skipping own-publications feed.');
      return false;
    }

    const items = publications.map((pub) => {
      const key = generateBibtexKey(pub);
      // Direct open-access PDF URL resolved from the ORA landing page by the
      // ORA collector. When ORA has nothing, an Unpaywall fallback runs below.
      // Downstream (research-radio podcasts, fg-zettelkasten notes) requires
      // this full text — a paper without it is skipped.
      const oaPdfUrl = pub.oaPdfUrl || null;
      const fallbackUrl =
        (pub.source_urls && (pub.source_urls.orcid || pub.source_urls.scholar)) || null;

      return {
        id: `bibtex:${key}`,
        title: pub.title,
        date_published: pub.publicationDate || `${pub.year}-01-01`,
        authors: parseAuthors(pub.authors),
        url: pub.doi ? `https://doi.org/${pub.doi}` : fallbackUrl,
        content_text: pub.abstract || '',
        _academic: {
          doi: pub.doi || null,
          bibtex_key: key,
          type: pub.type || pub.crossref_type || null,
          venue: pub.venue || '',
          year: pub.year,
          publisher: pub.publisher || null,
          citation_count: (pub.metrics && pub.metrics.total_citations) || 0,
          // open_access is true only when a directly-downloadable green-OA PDF
          // was resolved (from ORA) — not merely when an ORA handle exists.
          open_access: Boolean(oaPdfUrl),
          open_access_pdf_url: oaPdfUrl,
        },
      };
    });

    // Deduplicate by id: a shared BibTeX key means the same paper (e.g. an
    // aggregator duplicate with title-casing variants). Keep whichever copy
    // carries the richer abstract so downstream gets the best metadata.
    const byId = new Map();
    for (const item of items) {
      const existing = byId.get(item.id);
      if (!existing || item.content_text.length > existing.content_text.length) {
        byId.set(item.id, item);
      }
    }
    const dedupedItems = [...byId.values()];
    if (dedupedItems.length < items.length) {
      console.log(`Dropped ${items.length - dedupedItems.length} duplicate publication(s)`);
    }

    // ORA-search fallback: ORCID surfaces new papers on publication day, but
    // ORA's OAI-PMH endpoint can lag days/weeks behind the actual deposit.
    // Search ORA by DOI directly for items the OAI pass missed, so a freshly
    // deposited PDF is picked up on the next pipeline run rather than waiting
    // for OAI to catch up.
    let oraSearchHits = 0;
    for (const item of dedupedItems) {
      const academic = item._academic;
      if (academic.open_access_pdf_url || !academic.doi) continue;
      const pdfUrl = await findOraPdfByDoi(academic.doi);
      if (pdfUrl) {
        academic.open_access_pdf_url = pdfUrl;
        academic.open_access = true;
        oraSearchHits += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (oraSearchHits) {
      console.log(`ORA search resolved ${oraSearchHits} additional OA PDF(s)`);
    }

    // Unpaywall fallback: for items neither ORA-OAI nor ORA-search resolved,
    // ask Unpaywall (catches arXiv preprints and PDF-first OA journals with no
    // ORA deposit).
    let unpaywallHits = 0;
    for (const item of dedupedItems) {
      const academic = item._academic;
      if (academic.open_access_pdf_url || !academic.doi) continue;
      const pdfUrl = await resolveOaPdf(academic.doi, config.email);
      if (pdfUrl) {
        academic.open_access_pdf_url = pdfUrl;
        academic.open_access = true;
        unpaywallHits += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (unpaywallHits) {
      console.log(`Unpaywall resolved ${unpaywallHits} additional OA PDF(s)`);
    }

    // Newest first.
    dedupedItems.sort((a, b) =>
      String(b.date_published).localeCompare(String(a.date_published))
    );

    const feed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Fabio Giglietto — own publications',
      home_page_url: 'https://fabiogiglietto.github.io/publications',
      description:
        "Auto-generated feed of Fabio Giglietto's own publications, consumed " +
        'downstream by research-radio and fg-zettelkasten.',
      _updated: new Date().toISOString(),
      items: dedupedItems,
    };

    const outputPath = path.join(
      __dirname,
      '../../public/data/own-publications.json'
    );
    fs.writeFileSync(outputPath, JSON.stringify(feed, null, 2), 'utf8');

    console.log(`Generated own-publications feed with ${dedupedItems.length} items`);
    return true;
  } catch (error) {
    console.error('Error generating own-publications feed:', error);
    return false;
  }
}

// Allow running directly
if (require.main === module) {
  generateOwnPublicationsFeed();
}

module.exports = { generateOwnPublicationsFeed };

/**
 * Google Scholar data collector
 * 
 * Scrapes publication data from Google Scholar profile
 */

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

// Scholar's profile page accepts pagesize up to 100; we paginate via cstart.
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // safety cap (1000 publications)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect() {
  console.log('Collecting Google Scholar data...');

  // Scholar ID from centralized config
  const scholarId = config.scholarId;

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const publications = [];
    let profile = null;

    // Paginate through the full publication list. Default Scholar pages only
    // show the top 20 by citations, so without this we miss the mid/long tail.
    for (let page = 0; page < MAX_PAGES; page++) {
      const cstart = page * PAGE_SIZE;
      const url = `https://scholar.google.com/citations?user=${scholarId}&cstart=${cstart}&pagesize=${PAGE_SIZE}`;
      const response = await axios.get(url, { headers });
      const $ = cheerio.load(response.data);

      const rows = $('.gsc_a_tr');

      // A 200 response with zero parsed rows on the first page means Scholar
      // served a robot-check / blocked page. Abort rather than persist a
      // degraded result that would wipe out existing citation data.
      if (rows.length === 0) {
        if (page === 0) {
          console.error('Scholar returned no publication rows (likely blocked) — aborting.');
          return null;
        }
        break; // normal end of list
      }

      // Capture profile/stats once, from the first page.
      if (page === 0) {
        profile = {
          name: $('#gsc_prf_in').text(),
          affiliation: $('.gsc_prf_il').first().text(),
          interests: $('.gsc_prf_inta').map((i, el) => $(el).text()).get(),
          // The "All" column of the stats table holds the totals
          // (citations, h-index, i10-index); .gsc_rsb_sc1 holds the labels.
          citations: $('#gsc_rsb_st td.gsc_rsb_std')
            .filter((i) => i % 2 === 0)
            .map((i, el) => $(el).text())
            .get()
        };
      }

      rows.each((i, element) => {
        // The title link carries citation_for_view=USER:CITID — the CITID is
        // the per-publication id used to build a stable Scholar URL.
        const href = $(element).find('.gsc_a_at').attr('href') || '';
        const match = href.match(/citation_for_view=[^:]+:([^&]+)/);
        publications.push({
          id: match ? match[1] : null,
          title: $(element).find('.gsc_a_at').text(),
          authors: $(element).find('.gs_gray').first().text(),
          venue: $(element).find('.gs_gray').eq(1).text(),
          year: $(element).find('.gsc_a_y').text(),
          citations: $(element).find('.gsc_a_c').text()
        });
      });

      // Fewer rows than a full page means we've reached the end.
      if (rows.length < PAGE_SIZE) break;

      // Be gentle between requests to reduce the chance of being blocked.
      await delay(1500);
    }

    console.log(`Collected ${publications.length} Scholar publications across pages.`);

    return {
      profile,
      publications,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching Scholar data:', error.message);
    return null;
  }
}

module.exports = {
  collect,
  name: 'scholar'
};
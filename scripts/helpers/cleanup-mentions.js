#!/usr/bin/env node
/**
 * Cleanup script to deduplicate existing web mentions archive
 * This removes duplicate entries based on normalized URL and title matching
 *
 * Run with: node scripts/helpers/cleanup-mentions.js
 */

const fs = require('fs');
const path = require('path');

const historyPath = path.join(__dirname, '../../public/data/websearch-history.json');
const backupPath = path.join(__dirname, '../../public/data/websearch-history.backup.json');

/**
 * Normalize a URL for deduplication purposes
 */
function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);

    const paramsToRemove = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'ucbcb', 'oc', 'hl', 'gl', 'ceid',
      'ref', 'source', 'fbclid', 'gclid',
      '_ga', '_gid', 'mc_cid', 'mc_eid'
    ];

    paramsToRemove.forEach(param => url.searchParams.delete(param));

    let hostname = url.hostname.replace(/^www\./, '');

    if (hostname === 'news.google.com' && url.pathname.includes('/rss/articles/')) {
      const articleId = url.pathname.split('/').pop();
      return `news.google.com:${articleId}`;
    }

    if (hostname === 'vertexaisearch.cloud.google.com') {
      return urlString;
    }

    let pathname = url.pathname.replace(/\/$/, '');
    const sortedParams = [...url.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const queryString = sortedParams.length > 0
      ? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&')
      : '';

    return `${hostname}${pathname}${queryString}`.toLowerCase();
  } catch (e) {
    return urlString.toLowerCase();
  }
}

/**
 * Normalize a title for deduplication purposes
 */
function normalizeTitle(title) {
  if (!title) return '';

  return title
    .replace(/\s*[-–—|]\s*(EURACTIV\.ro|ResearchGate|il Ducato|lapiazzarimini\.it|Radio Radicale|vera\.ai.*|Sociologica|Mastodon|Uniurb|arXiv)$/i, '')
    .replace(/\s*\|\s*Request PDF$/i, '')
    .replace(/[„""'']/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Check if two mentions are duplicates
 */
function areDuplicateMentions(mention1, mention2) {
  const normalizedUrl1 = normalizeUrl(mention1.url);
  const normalizedUrl2 = normalizeUrl(mention2.url);

  if (normalizedUrl1 === normalizedUrl2) {
    return true;
  }

  const normalizedTitle1 = normalizeTitle(mention1.title);
  const normalizedTitle2 = normalizeTitle(mention2.title);

  if (normalizedTitle1 && normalizedTitle2 && normalizedTitle1 === normalizedTitle2) {
    return true;
  }

  if (normalizedTitle1.length > 20 && normalizedTitle2.length > 20) {
    if (normalizedTitle1.startsWith(normalizedTitle2.substring(0, 30)) ||
        normalizedTitle2.startsWith(normalizedTitle1.substring(0, 30))) {
      const source1 = (mention1.source || '').toLowerCase();
      const source2 = (mention2.source || '').toLowerCase();
      if (source1 === source2 ||
          normalizeUrl(mention1.url).split('/')[0] === normalizeUrl(mention2.url).split('/')[0]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Deduplicate mentions, keeping the one with highest relevance score
 * or the most recent one if scores are equal
 */
function deduplicateMentions(mentions) {
  const uniqueMentions = [];

  for (const mention of mentions) {
    const duplicateIndex = uniqueMentions.findIndex(existing => areDuplicateMentions(existing, mention));

    if (duplicateIndex === -1) {
      uniqueMentions.push(mention);
    } else {
      // Keep the one with higher relevance score, or more recent date
      const existing = uniqueMentions[duplicateIndex];
      const existingScore = existing.relevanceScore || 0;
      const mentionScore = mention.relevanceScore || 0;

      if (mentionScore > existingScore ||
          (mentionScore === existingScore && mention.collectedAt > existing.collectedAt)) {
        uniqueMentions[duplicateIndex] = mention;
      }
    }
  }

  return uniqueMentions;
}

// Main execution
console.log('Web Mentions Archive Cleanup');
console.log('============================\n');

if (!fs.existsSync(historyPath)) {
  console.log('No history file found at:', historyPath);
  process.exit(1);
}

// Read current history
const historyData = fs.readFileSync(historyPath, 'utf8');
const mentions = JSON.parse(historyData);

console.log(`Original count: ${mentions.length} mentions`);

// Create backup
fs.writeFileSync(backupPath, historyData);
console.log(`Backup created at: ${backupPath}`);

// Deduplicate
const uniqueMentions = deduplicateMentions(mentions);
const removedCount = mentions.length - uniqueMentions.length;

console.log(`Unique count: ${uniqueMentions.length} mentions`);
console.log(`Removed: ${removedCount} duplicates`);

// Sort by collection date (newest first)
uniqueMentions.sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));

// Save cleaned data
fs.writeFileSync(historyPath, JSON.stringify(uniqueMentions, null, 2));
console.log(`\nCleaned data saved to: ${historyPath}`);

// Report on removed duplicates
if (removedCount > 0) {
  console.log('\n--- Removed duplicates summary ---');

  // Find what was removed
  const removedMentions = mentions.filter(m =>
    !uniqueMentions.some(u => u.url === m.url && u.collectedAt === m.collectedAt)
  );

  // Group by normalized title
  const byTitle = {};
  removedMentions.forEach(m => {
    const normTitle = normalizeTitle(m.title).substring(0, 50);
    if (!byTitle[normTitle]) byTitle[normTitle] = 0;
    byTitle[normTitle]++;
  });

  Object.entries(byTitle)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .forEach(([title, count]) => {
      console.log(`  ${count}x: ${title}...`);
    });
}

console.log('\nCleanup complete!');

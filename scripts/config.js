/**
 * Centralized Configuration
 *
 * All hardcoded IDs, usernames, and constants used across collectors and generators.
 * This file serves as the single source of truth for personal identifiers.
 */

// Load environment variables
require('dotenv').config();

const config = {
  // Personal Identifiers
  name: 'Fabio Giglietto',
  title: 'Professor of Internet Studies',
  institution: 'University of Urbino Carlo Bo',
  department: 'Department of Communication Sciences, Humanities and International Studies',
  email: 'fabio.giglietto@uniurb.it',

  // Academic Profile IDs
  orcidId: process.env.ORCID_ID || '0000-0001-8019-1035',
  scholarId: process.env.SCHOLAR_ID || 'FmenbcUAAAAJ',

  // Social Media Handles
  social: {
    github: {
      username: 'fabiogiglietto',
      url: 'https://github.com/fabiogiglietto'
    },
    bluesky: {
      handle: 'fabiogiglietto.bsky.social',
      url: 'https://bsky.app/profile/fabiogiglietto.bsky.social'
    },
    mastodon: {
      username: 'fabiogiglietto',
      instance: 'aoir.social',
      url: 'https://aoir.social/@fabiogiglietto'
    },
    linkedin: {
      username: 'fabiogiglietto',
      url: 'https://www.linkedin.com/in/fabiogiglietto'
    },
    threads: {
      username: 'fabiogiglietto',
      url: 'https://www.threads.net/@fabiogiglietto'
    }
  },

  // External Resource URLs
  urls: {
    toreadFeed: 'https://raw.githubusercontent.com/fabiogiglietto/toread/main/output/feed.json',
    toreadRepo: 'https://github.com/fabiogiglietto/toread',
    rForCommResearch: 'https://github.com/fabiogiglietto/R-for-communication-research',
    socialMediaPython: 'https://github.com/fabiogiglietto/social-media-python'
  },

  // URL builders
  buildScholarUrl: function (publicationId) {
    return `https://scholar.google.com/citations?user=${this.scholarId}&citation_for_view=${this.scholarId}:${publicationId}`;
  },

  buildScholarProfileUrl: function () {
    return `https://scholar.google.com/citations?user=${this.scholarId}&view_op=list_works&sortby=pubdate`;
  },

  buildLinkedInPostUrl: function (activityId) {
    if (activityId) {
      return `https://linkedin.com/posts/${this.social.linkedin.username}_${activityId}`;
    }
    return this.social.linkedin.url;
  },

  buildBlueskyPostUrl: function (postId) {
    return `https://bsky.app/profile/${this.social.bluesky.handle}/post/${postId}`;
  },

  buildMastodonPostUrl: function (postId) {
    return `https://${this.social.mastodon.instance}/@${this.social.mastodon.username}/${postId}`;
  }
};

module.exports = config;

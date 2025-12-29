# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is a Jekyll-based GitHub Pages academic website that integrates automated data collection from multiple APIs. The site features dynamic content generation using AI and aggregates publications, social media, and academic data.

## Essential Commands
- **Local development**: `bundle exec jekyll serve` or `npm run serve`
- **Build site**: `bundle exec jekyll build` or `npm run build`
- **Data collection**: `node scripts/collect-all.js` or `npm run collect`
- **Install dependencies**: `npm install` (for Node.js) and `bundle install` (for Ruby/Jekyll)
- **Generate specific content**:
  - About section: `npm run generate-about`
  - Teaching data: `npm run generate-teaching`
  - Social insights: `npm run generate-social-insights`

## API Setup Requirements
Before running data collection, set up `.env` file with required API keys:
- `GEMINI_API_KEY`: Required for AI content generation (Google Gemini API with Search grounding)
- `WOS_API_KEY`: Web of Science publication data
- `SCOPUS_API_KEY`: Scopus publication data
- `GOOGLE_SITE_VERIFICATION`: Your Google Search Console verification code (optional)
- Optional social media APIs (LinkedIn, Mastodon)

Use `node scripts/helpers/setup-linkedin.js` for LinkedIn OAuth setup.

## Security Notes for Forks/Clones
If someone forks this repository to create their own academic website:
- **Site verification files** (`google*.html`, `bing*.html`) are gitignored to prevent domain ownership conflicts
- **Meta tag verification removed** - Only local HTML file verification supported to prevent security issues
- **Personal data protection** - All API keys and personal identifiers must be updated in `_config.yml`
- **Environment variables** - The `.env` file contains sensitive data and is never committed

## Site Verification Setup
To set up Google Search Console verification:
1. Create your verification HTML file (e.g., `google123abc.html`) in the site root
2. The file will be ignored by git but served by GitHub Pages
3. This prevents forks from inheriting your domain verification while keeping it functional

## Architecture Overview
The site uses a multi-stage data pipeline:
1. **Collectors** (`scripts/collectors/`): Fetch data from external APIs (ORCID, Google Scholar, GitHub, social media)
2. **Aggregators**: Combine and deduplicate data from multiple sources
3. **Generators** (`scripts/generators/`): Use Google Gemini API to create content summaries and insights with real-time web search
4. **Jekyll**: Renders static site from aggregated data in `public/data/`

## Data Flow
- External APIs → `scripts/collectors/` → `public/data/*.json` → Jekyll `_includes/` → Site pages
- Social media posts → aggregated into `_data/news.yml` for News & Updates section
- Publications from multiple sources → aggregated into unified format
- AI-generated content stored in `_includes/generated-*.html`

## Key Conventions
- All data collectors handle missing API keys gracefully
- Error handling uses try/catch with fallbacks to continue processing
- Generated content files prefixed with `generated-`
- Social media content automatically deduplicates using Gemini API or fallback logic
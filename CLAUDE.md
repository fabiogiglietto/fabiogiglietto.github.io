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
- `OPENAI_API_KEY`: Required for AI content generation
- `WOS_API_KEY`: Web of Science publication data
- `SCOPUS_API_KEY`: Scopus publication data
- Optional social media APIs (LinkedIn, Mastodon)

Use `node scripts/helpers/setup-linkedin.js` for LinkedIn OAuth setup.

## Architecture Overview
The site uses a multi-stage data pipeline:
1. **Collectors** (`scripts/collectors/`): Fetch data from external APIs (ORCID, Google Scholar, GitHub, social media)
2. **Aggregators**: Combine and deduplicate data from multiple sources
3. **Generators** (`scripts/generators/`): Use OpenAI to create content summaries and insights
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
- Social media content automatically deduplicates using OpenAI or fallback logic
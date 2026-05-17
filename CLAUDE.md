# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Jekyll-based GitHub Pages academic website for Fabio Giglietto. Integrates automated data collection from external APIs (ORCID, Google Scholar, Scopus, Web of Science, GitHub, social media) with AI-generated content via Google Gemini API. A daily GitHub Actions workflow runs data collection and commits updated JSON/HTML.

## Essential Commands
- **Local development**: `bundle exec jekyll serve` (or `npm run serve`)
- **Build site**: `bundle exec jekyll build` (or `npm run build`)
- **Full data collection + generation**: `npm run collect` (runs all collectors then all generators sequentially)
- **Install dependencies**: `npm install` && `bundle install`
- **Tests**: `npm test` (Jest, tests in `tests/`), `npm run test:watch`, `npm run test:coverage`
- **Lint**: `npm run lint` (ESLint on `scripts/` and `tests/`), `npm run lint:fix`
- **Format**: `npm run format:check` (Prettier), `npm run format`
- **Individual generators**: `npm run generate-about`, `npm run generate-teaching`, `npm run generate-social-insights`, `npm run generate-bibtex`

## API Keys (`.env` file)
- `GEMINI_API_KEY`: Required for AI content generation and web search grounding (Gemini 2.0 Flash)
- `WOS_API_KEY`, `SCOPUS_API_KEY`, `S2_API_KEY`: Publication citation sources
- `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_PERSON_ID`, `MASTODON_ACCESS_TOKEN`: Social media collection
- All collectors handle missing keys gracefully (return `null`, don't throw)

## Pipeline position

This site is the **third stage** of a four-repo research pipeline:
`toread` → `research-radio` → **fabiogiglietto.github.io** → `fg-zettelkasten`.
The `toread.js` and `research-radio.js` collectors fetch the upstream
`feed.json` and `episodes.json` artifacts at build time. Full DAG and
orchestration model: https://github.com/fabiogiglietto/toread/blob/main/PIPELINE.md

## Architecture

### Data Pipeline (`scripts/collect-all.js`)
The pipeline runs in phases:
1. **Phase 1 — Parallel collection**: All collectors in `scripts/collectors/` run via `Promise.all`, each fetching from an external API. Output saved to `public/data/*.json`.
2. **Phase 2 — Publications aggregation**: `publications-aggregator.js` merges and deduplicates publications from ORCID, Scholar, WoS, Scopus, Semantic Scholar, Crossref, and ORA into `aggregated-publications.json`.
3. **Phase 3 — Social media aggregation**: Merges social posts into `_data/news.yml` with AI-powered deduplication.
4. **Phase 4 — AI generation**: Generators produce HTML/JSON using Gemini API with Google Search grounding. Output goes to `_includes/generated-*.html` and `public/data/`.

### Collector Interface
All collectors export `{ collect: async () => data | null }`. See `scripts/collectors/README.md` for the full standard and how to add new collectors. Register new collectors in `collect-all.js`.

### Centralized Config
`scripts/config.js` is the single source of truth for all personal identifiers (ORCID ID, Scholar ID, social handles, institutional URLs). Collectors import from here rather than hardcoding values.

### Data Locations
- `public/data/*.json` — Raw and aggregated collector output (committed, used by Jekyll)
- `_data/*.yml` and `_data/*.json` — Jekyll data files (some copied from `public/data/` during collection)
- `_includes/generated-*.html` — AI-generated HTML fragments included by pages
- `_layouts/` — Jekyll page layouts (`default`, `page`, `publication`, `publications`, `project`, `projects`, `teaching`)

### Jekyll Site Structure
`index.html` composes the homepage from includes: `profile-card`, `generated-about`, `recent-publications`, `research-projects`, `toread-papers`, `news-updates`, `social-feed`, `web-mentions`, `social-media-insights`. Top-level pages: `publications.html`, `projects.html`, `teaching.html`.

### CI/CD
GitHub Actions workflow (`.github/workflows/`) runs daily at 06:00 UTC:
- Core data collection runs every day
- About/bio generation runs weekly (Mondays only)
- Teaching generation runs monthly (1st of month only)
- Environment variables `SKIP_ABOUT_GENERATION` and `SKIP_TEACHING_GENERATION` control skipping in `collect-all.js`

## Key Conventions
- Collectors return `null` on failure — never throw from the top-level `collect()` function
- Generated content files are prefixed with `generated-`
- Social media deduplication uses Gemini API with fallback to string-similarity
- `sanitize-html` is used to clean AI-generated HTML before writing to includes

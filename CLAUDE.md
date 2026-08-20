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
- `GEMINI_API_KEY`: Required for AI content generation and web search grounding. Model IDs live in `scripts/helpers/gemini-client.js` (`MODELS.FLASH`, `MODELS.FLASH_LATEST`) — reference those rather than hardcoding a version here.
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
4. **Phase 4 — AI generation**: Generators produce HTML/JSON using the Gemini API, ungrounded — recency comes from the mentions `websearch.js` collected in Phase 1; see [Gemini cost controls](#gemini-cost-controls). Output goes to `_includes/generated-*.html` and `public/data/`.

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

## AI cost controls

### Gemini
Google Search grounding is billed **per search query** (~€0.012 each) and one
grounded call runs an agentic multi-query loop, so it dominates the API bill.
Thinking tokens are billed as **output** (~6x the input rate) on every call.

- **Only `websearch.js` may enable `googleSearch`** — one call site, TTL-cached
  (below). Every other call site, including every retry, runs ungrounded. Google
  News RSS and Crossref Event Data cover fresh mentions for free. Generators that
  need recency read the validated mentions in `public/data/websearch.json` rather
  than issuing a grounded call of their own; `about-generator.js` is the worked
  example.
- Grounded discovery runs at most once per `WEBSEARCH_DISCOVERY_TTL_HOURS`
  (default 72), cached in `public/data/websearch-discovery-cache.json`. Set
  `FORCE_WEBSEARCH_DISCOVERY=1` to bypass the cache.
- Every `generateContent` call must pass a `config` with `maxOutputTokens` and a
  `thinkingConfig` (`thinkingBudget: 0` for extraction/classification,
  `thinkingLevel: 'low'` for generation). `tests/websearch.test.js` asserts this.
- Retries must not re-issue grounding — the failed call may already have been
  billed for its searches (see `about-generator.js`).
- The collector logs a `[cost]` line per grounded call (grounding chunks + token
  counts); check it in the Actions log rather than waiting for the monthly bill.
  Its `search queries reported` figure is usually 0 — the API often omits
  `webSearchQueries` even when searches *were* billed. Treat token counts and
  grounding chunks as the reliable signals; the query count only ever confirms
  searches happened, never that they didn't.

### Anthropic (bio reviewer)
`scripts/generators/bio-reviewer.js` runs a second-model pass over the generated
biography before it is published — a **source-consistency check, not a
fact-check**: the call is ungrounded, so it can only verify the bio against the
sources it is handed, never against the world.

- Thinking bills as **output** here too, and on Fable 5 it is always on:
  omitting `output_config.effort` silently defaults to `high`. **Every Anthropic
  call must pass explicit `max_tokens` and `output_config.effort`**;
  `tests/bio-reviewer.test.js` asserts it. Drop `effort` to `low` to roughly
  halve the per-call cost.
- The reviewer **fails open** in every path — no credentials, refusal, cap hit,
  malformed revision — and publishes the Gemini output unchanged. A rewriter in
  a publish path must never make the result worse than not running. Look for one
  of `reviewer skipped` / `reviewer ran` / `reviewer failed` in the Actions log.
- Flags are written to `public/data/bio-review.json` as well as the log, since
  Actions logs age out and the flags are the half a human needs to read.

### Anthropic auth (Workload Identity Federation)
CI holds **no `ANTHROPIC_API_KEY`**. The workflow mints a GitHub OIDC token and
the SDK exchanges it for a short-lived access token. Configure via the Claude
Console (Settings → Workload identity → Connect workload → GitHub Actions); it
creates a service account, federation issuer and federation rule. Put the three
resulting IDs in repository **variables** (not secrets — they are identifiers,
not credentials): `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`,
`ANTHROPIC_SERVICE_ACCOUNT_ID`.

- **Never set `ANTHROPIC_API_KEY` anywhere the workflow can see it** — including
  `.env`, which the collectors load. It outranks federation in the SDK's
  credential precedence and shadows it silently.
- Scope the federation rule to `refs/heads/main` on this repo specifically. A
  loose `subject_prefix` without a `ref` constraint also matches `pull_request`
  runs from forks, and this repository is public.
- The workflow's `permissions:` block must keep `contents: write` enumerated
  alongside `id-token: write` — declaring the block drops every scope not listed,
  and the auto-commit step needs write access.
- The OIDC token is fetched inside the Monday bio step, not at job start: it
  expires ~5 minutes after issuance and `npm run collect` runs long before it.

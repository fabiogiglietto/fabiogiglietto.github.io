# fabiogiglietto.github.io

Personal academic website for Fabio Giglietto.

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in the required API keys
4. Run data collection: `node scripts/collect-all.js`
5. Preview the site: `bundle exec jekyll serve`

## API Keys

This project uses several API keys for data collection:

- **OpenAI API Key**: Used for generating AI-based summaries and content
- **Scopus API Key**: For retrieving publication data from Scopus
- **Web of Science API Key**: For retrieving publication data from Web of Science

### Setting Up API Keys

#### For Local Development

Add your API keys to the `.env` file:

```
OPENAI_API_KEY=your-openai-api-key
SCOPUS_API_KEY=your-scopus-api-key
WOS_API_KEY=your-wos-api-key
```

#### For GitHub Actions

Add these secrets to your GitHub repository:

1. Go to your GitHub repository
2. Navigate to Settings > Secrets and variables > Actions
3. Click "New repository secret"
4. Add each API key as a secret with the corresponding name:
   - `OPENAI_API_KEY`
   - `SCOPUS_API_KEY`
   - `WOS_API_KEY`

## Automated Data Collection

The site uses GitHub Actions to automatically update data from various sources. The workflow runs daily and updates:

- Publication data from ORCID, Google Scholar, Scopus, and Web of Science
- Teaching information from the university's database
- News and social media updates
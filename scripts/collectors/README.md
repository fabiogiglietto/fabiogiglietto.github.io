# Data Collectors

This directory contains all data collection modules for the academic website.

## Collector Interface Standard

All collectors MUST export a `collect` function with the following signature:

```javascript
module.exports = {
  collect: async function() {
    // Collect data from the source
    // Return collected data or null on failure
    return data;
  },
  // Optional: name for logging
  name: 'collector-name'
};
```

## Available Collectors

| Collector | Source | API Key Required | Description |
|-----------|--------|------------------|-------------|
| `orcid.js` | ORCID API | No | Publication and profile data |
| `scholar.js` | Google Scholar | No | Citation data via scraping |
| `github.js` | GitHub API | Optional | Repository and activity data |
| `wos.js` | Web of Science | Yes (`WOS_API_KEY`) | Citation metrics |
| `scopus.js` | Scopus | Yes (`SCOPUS_API_KEY`) | Citation metrics |
| `semantic-scholar.js` | Semantic Scholar | Optional (`S2_API_KEY`) | Citation and influence data |
| `crossref.js` | Crossref API | No | DOI metadata |
| `university.js` | University website | No | Teaching and profile data |
| `social-media.js` | Various | Yes | Social media profiles |
| `social-media-aggregator.js` | Various | Yes | Aggregated social posts |
| `websearch.js` | Gemini | Yes (`GEMINI_API_KEY`) | Web mentions |
| `toread.js` | GitHub | No | Reading list |
| `news.js` | Static | No | News and updates |

## Adding a New Collector

1. Create a new file in this directory (e.g., `my-source.js`)
2. Implement the standard interface:

```javascript
const config = require('../config');

async function collect() {
  console.log('Collecting data from MySource...');

  try {
    // Your collection logic here
    const data = await fetchData();
    return data;
  } catch (error) {
    console.error('MySource collection error:', error.message);
    return null;
  }
}

module.exports = {
  collect,
  name: 'my-source'
};
```

3. Register in `collect-all.js`:
```javascript
const mySourceCollector = require('./collectors/my-source');

// In the Promise.all array:
mySourceCollector.collect().catch(err => {
  console.error('MySource error:', err.message);
  return null;
})
```

4. Add output handling for the collected data

## Data Flow

```
External APIs → Collectors → public/data/*.json → Jekyll → Static HTML
```

## Error Handling

All collectors should:
- Return `null` on failure (not throw)
- Log errors with context
- Handle missing API keys gracefully
- Support both local development and CI environments

# API Setup Guide

This document explains how to set up API access for the various data collection services used in this website.

## Required Environment Variables

Create a `.env` file in the root directory with the following variables:

### Essential APIs

```env
# OpenAI API (Required for AI-powered content generation and analysis)
OPENAI_API_KEY=sk-your-openai-api-key

# Academic APIs (for publication data)
WOS_API_KEY=your-web-of-science-api-key
SCOPUS_API_KEY=your-scopus-api-key
S2_API_KEY=your-semantic-scholar-api-key
```

### Social Media APIs (For News & Updates section)

```env
# LinkedIn API (Optional)
LINKEDIN_ACCESS_TOKEN=your-linkedin-access-token
LINKEDIN_PERSON_ID=your-linkedin-person-id

# Mastodon API (Optional, for enhanced access)
MASTODON_ACCESS_TOKEN=your-mastodon-access-token
```

## API Setup Instructions

### LinkedIn API

LinkedIn integration requires several steps to set up properly. 

#### Quick Start (Recommended)
Run the guided setup helper:
```bash
node scripts/helpers/setup-linkedin.js
```

This script will guide you through the entire process and check your setup status.

#### Manual Setup Guide
If you prefer to set up manually, follow this complete guide:

#### Step 1: Create LinkedIn Developer Application
1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
2. Sign in with your LinkedIn account
3. Click "Create app"
4. Fill out the application form:
   - **App name**: Your website name (e.g., "Fabio Giglietto Academic Website")
   - **LinkedIn Page**: Your LinkedIn company/personal page
   - **Privacy policy URL**: Your website privacy policy
   - **App logo**: Upload a logo (optional)
5. Click "Create app"

#### Step 2: Configure App Settings
1. In your app dashboard, go to the "Auth" tab
2. Add authorized redirect URLs:
   ```
   http://localhost:3000/callback
   ```
3. In the "Products" tab, request access to:
   - **Sign In with LinkedIn using OpenID Connect**
   - **Share on LinkedIn** (if available)
4. Note your Client ID and Client Secret from the "Auth" tab

#### Step 3: Set Up Environment Variables
Add these to your `.env` file:
```env
LINKEDIN_CLIENT_ID=your_client_id_from_step_2
LINKEDIN_CLIENT_SECRET=your_client_secret_from_step_2
```

#### Step 4: Generate Access Token and Person ID
Run the automated setup script:
```bash
# Install dependencies if needed
npm install express axios dotenv

# Run the OAuth helper
node scripts/helpers/linkedin-oauth.js
```

This will:
1. Start a local server on http://localhost:3000
2. Open your browser to authorize the application
3. Automatically generate both your access token AND Person ID
4. Display both values for you to copy to your `.env` file

#### Step 5: Verify Setup
Test your LinkedIn integration:
```bash
# Test Person ID retrieval (if you need to get it separately)
node scripts/helpers/get-linkedin-person-id.js

# Test the full social media collection
node scripts/collectors/social-media-aggregator.js
```

#### LinkedIn API Limitations
- **Rate Limits**: LinkedIn API has strict rate limits
- **Token Expiration**: Access tokens expire (usually 60 days)
- **Scope Limitations**: Some APIs require special approval
- **Testing**: Use LinkedIn's testing tools for development

#### Troubleshooting LinkedIn Setup
- **"Invalid redirect URI"**: Make sure `http://localhost:3000/callback` is added to your app
- **"Invalid client"**: Check your Client ID and Secret are correct
- **"Insufficient permissions"**: Request additional products in your app dashboard
- **Token expired**: Re-run the OAuth flow to get a new token

### Mastodon API
1. Go to your Mastodon instance (aoir.social) 
2. Navigate to Preferences > Development
3. Create a new application with read permissions
4. Copy the access token

### BlueSky API
- No authentication required for public posts
- Uses the AT Protocol public endpoints

## API Usage Notes

- **LinkedIn**: Requires proper OAuth flow and has rate limits
- **BlueSky**: Public API, no authentication needed for public posts
- **Mastodon**: Public posts accessible without token, token provides enhanced access
- **OpenAI**: Required for content deduplication and summarization

## Fallback Behavior

The system will work with partial API availability:
- Without OpenAI: Uses basic deduplication instead of AI summarization
- Without LinkedIn: Skips LinkedIn posts
- Without Mastodon token: Uses public API (limited)
- Without any social APIs: Falls back to manual news entries in `_data/news.yml`

## Testing

Test the social media aggregator:
```bash
node scripts/collectors/social-media-aggregator.js
```

Check the generated news:
```bash
cat _data/news.yml
```
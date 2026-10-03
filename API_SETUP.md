# API Setup Guide

This document explains how to set up API access for the various data collection services used in this website.

## Required Environment Variables

Create a `.env` file in the root directory with the following variables:

### Essential APIs

```env
# Google Gemini API (Required for AI-powered content generation and web search grounding)
GEMINI_API_KEY=your-gemini-api-key

# Academic APIs (for publication data)
WOS_API_KEY=your-web-of-science-api-key
SCOPUS_API_KEY=your-scopus-api-key
S2_API_KEY=your-semantic-scholar-api-key
```

### Social Media APIs (For News & Updates section)

```env
# LinkedIn Member Data Portability API (Optional)
LINKEDIN_ACCESS_TOKEN=your-linkedin-access-token
# Optional: lets a run warn before the token above expires
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret

# Mastodon API (Optional, for enhanced access)
MASTODON_ACCESS_TOKEN=your-mastodon-access-token
```

## API Setup Instructions

### LinkedIn API

LinkedIn posts are read through the **Member Data Portability API**, the
self-serve product LinkedIn offers under the EU Digital Markets Act. It is
available only to members located in the EEA or Switzerland.

The ordinary post endpoints (`/v2/posts`, `/v2/ugcPosts`, `/v2/shares`) are not
an option: they require `r_member_social`, which LinkedIn grants to approved
partners only. An app with "Sign In with LinkedIn" and "Share on LinkedIn" can
write posts but never read them back.

#### Step 1: Create the developer app
1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps/) and click "Create app".
2. For **LinkedIn Page**, select
   [Member Data Portability (Member) Default Company](https://www.linkedin.com/company/member-data-portability-member-default-company).
   The product in step 2 is offered only to apps attached to this page — an app
   attached to any other page (including the one created for the old
   integration) cannot request it.
3. Fill in the remaining fields and create the app.

#### Step 2: Request the product
In the app's **Products** tab, request access to **Member Data Portability API
(Member)** and accept the terms. Access is granted immediately.

#### Step 3: Generate an access token
1. Open [OAuth Token Tools](https://www.linkedin.com/developers/tools/oauth)
   (Developer Portal → Docs and tools) and click "Create token".
2. Select the app from step 1 and the scope `r_dma_portability_self_serve`.
3. Click "Request access token", sign in and allow access.
4. Copy the token.

#### Step 4: Store the credentials
- `LINKEDIN_ACCESS_TOKEN`: the token from step 3.
- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (optional): from the app's
  **Auth** tab. They are used only to ask LinkedIn when the token expires. They
  must belong to the same app as the token.

Put them in `.env` for local runs and in the repository secrets for the daily
workflow (`gh secret set LINKEDIN_ACCESS_TOKEN`).

#### Token renewal
The token lasts one year (issued 2026-10-01, expires 2027-10-01) and is renewed
by repeating step 3 and updating the secret. Collection never fails the run, so
watch for the **LinkedIn** warning annotation on the Actions run summary:
- `access token expires in N day(s)` — raised from 14 days before expiry, if
  the client ID and secret are set.
- `posts not collected: access token expired or revoked` — the token is dead
  and LinkedIn posts have stopped appearing.

#### What gets published
Only feed posts with visibility `MEMBER_NETWORK` or `PUBLIC` that carry a date
and text of their own. `MEMBER_NETWORK` is the snapshot's label for an ordinary
"Anyone" post. Posts made inside a group, bare reshares and any other visibility
value are dropped.

The visibility label for a connections-only post has not been observed. Each
run logs the values it saw (`LinkedIn visibility values: {...}`); if a new value
appears, check what it means before adding it to `PUBLIC_VISIBILITIES` in
`scripts/helpers/linkedin-portability.js`.

#### Troubleshooting
- **401**: token expired or revoked — generate a new one.
- **403**: the app lacks the Member Data Portability API (Member) product, or
  the token was generated without the `r_dma_portability_self_serve` scope.
- **`no post data available` right after the first token**: LinkedIn builds the
  snapshot after consent is given, one domain at a time. Profile data was served
  within minutes; `MEMBER_SHARE_INFO` took between 7 and 24 hours.

### Mastodon API
1. Go to your Mastodon instance (aoir.social) 
2. Navigate to Preferences > Development
3. Create a new application with read permissions
4. Copy the access token

### BlueSky API
- No authentication required for public posts
- Uses the AT Protocol public endpoints

## API Usage Notes

- **LinkedIn**: Member Data Portability API (EEA/Switzerland only); token renewed by hand
- **BlueSky**: Public API, no authentication needed for public posts
- **Mastodon**: Public posts accessible without token, token provides enhanced access
- **Gemini**: Required for AI content generation, web search grounding, and smart summarization

## Fallback Behavior

The system will work with partial API availability:
- Without Gemini: Uses basic deduplication instead of AI summarization
- Without LinkedIn (no token, or an expired one): Skips LinkedIn posts and raises a warning
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
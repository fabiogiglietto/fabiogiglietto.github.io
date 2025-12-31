# URGENT: API Key Rotation Required

**Date:** 2025-11-08
**Severity:** CRITICAL
**Action Required:** Immediate

## Summary

Your `.env` file contains exposed API credentials. While the file is properly gitignored and not in git history, these keys should be rotated immediately as a security best practice.

## Exposed Credentials

The following credentials are currently in your `.env` file and should be rotated:

1. ✅ **OpenAI API Key** - `sk-proj-CqPjeTDAqY2Nt8X...`
2. ✅ **Web of Science API Key** - `e13946c5fc88...`
3. ✅ **Scopus API Key** - `fcf4fee636e1...`
4. ✅ **Semantic Scholar API Key** - `igLzlRjWMo7o...`
5. ✅ **LinkedIn Credentials** - Client ID, Secret, Access Token
6. ✅ **Mastodon Access Token** - `MpOQrcEf0YEq...`

## Step-by-Step Rotation Guide

### 1. OpenAI API Key (HIGHEST PRIORITY)

**Why:** Active billing account, can incur charges if misused.

**Steps:**
1. Go to: https://platform.openai.com/api-keys
2. Click on the exposed key (starts with `sk-proj-CqPjeTDA...`)
3. Click "Delete" or "Revoke"
4. Click "Create new secret key"
5. Give it a name like "Academic Website - Nov 2025"
6. Copy the new key
7. Update your `.env` file:
   ```
   OPENAI_API_KEY=<new-key-here>
   ```
8. **Check usage:** Go to https://platform.openai.com/usage to verify no suspicious activity

### 2. Web of Science API Key

**Steps:**
1. Go to: https://developer.clarivate.com/
2. Sign in with your account
3. Navigate to "My Apps" or "API Keys"
4. Revoke the existing key: `e13946c5fc887...`
5. Generate a new API key
6. Update your `.env` file:
   ```
   WOS_API_KEY=<new-key-here>
   ```

### 3. Scopus API Key

**Steps:**
1. Go to: https://dev.elsevier.com/
2. Sign in with your Elsevier account
3. Navigate to "My API Key" section
4. Revoke the existing key: `fcf4fee636e1...`
5. Request a new API key
6. Update your `.env` file:
   ```
   SCOPUS_API_KEY=<new-key-here>
   ```

### 4. Semantic Scholar API Key

**Steps:**
1. Go to: https://www.semanticscholar.org/product/api
2. Sign in to your account
3. Navigate to API credentials
4. Revoke the existing key: `igLzlRjWMo7o...`
5. Generate a new API key
6. Update your `.env` file:
   ```
   S2_API_KEY=<new-key-here>
   ```

### 5. LinkedIn Credentials

**Steps:**
1. Go to: https://www.linkedin.com/developers/apps
2. Find your app (Client ID: `77fxu01v6wem3x`)
3. Click on the app to manage it
4. Navigate to "Auth" tab
5. Click "Regenerate client secret"
6. Copy the new secret
7. For access token, you'll need to re-authenticate:
   ```bash
   node scripts/helpers/setup-linkedin.js
   ```
8. Update your `.env` file with new credentials

### 6. Mastodon Access Token

**Steps:**
1. Go to: https://aoir.social/settings/applications
2. Find the application that generated token `MpOQrcEf0YEq...`
3. Click "Revoke" or "Delete"
4. Create a new application:
   - Name: "Academic Website Collector"
   - Scopes: `read`
5. Copy the new access token
6. Update your `.env` file:
   ```
   MASTODON_ACCESS_TOKEN=<new-token-here>
   ```

## Post-Rotation Checklist

After rotating all keys:

- [ ] Test data collection still works:
  ```bash
  npm run collect
  ```

- [ ] Verify no errors in collection process

- [ ] Check GitHub Actions workflow still works (uses GitHub Secrets, not .env)

- [ ] Update GitHub Secrets if needed:
  1. Go to: https://github.com/fabiogiglietto/fabiogiglietto.github.io/settings/secrets/actions
  2. Update each secret with new values

- [ ] Run a test build:
  ```bash
  npm run build
  ```

- [ ] Delete this incident response file (or move to private notes):
  ```bash
  rm SECURITY_INCIDENT_RESPONSE.md
  ```

## Audit API Usage

Check for any suspicious activity during the exposure period:

1. **OpenAI:** https://platform.openai.com/usage
2. **Web of Science:** Check your account dashboard
3. **Scopus:** Review API usage metrics
4. **LinkedIn:** Check https://www.linkedin.com/mypreferences/d/accounts-logins for unusual login activity

## Prevention

Going forward:

1. ✅ `.env` is already in `.gitignore` (good!)
2. ✅ GitHub Actions uses encrypted secrets (good!)
3. 🔄 Consider using encrypted env file with tool like `dotenv-vault`
4. 🔄 Set up API key rotation schedule (every 90 days)
5. 🔄 Enable API usage alerts for all services

## Questions?

If you need help with any of these steps, consult:
- API_SETUP.md for detailed API setup instructions
- Individual API provider documentation
- GitHub Secrets documentation: https://docs.github.com/en/actions/security-guides/encrypted-secrets

---

**Status:** 🔴 Action Required
**Updated:** 2025-11-08

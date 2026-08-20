/**
 * Shared Anthropic (@anthropic-ai/sdk) client.
 *
 * Lazily constructs a singleton Anthropic instance and returns null when no
 * credential source is present, so callers can degrade gracefully.
 *
 * IMPORTANT — this deliberately does NOT mirror gemini-client.js's
 * `if (!process.env.ANTHROPIC_API_KEY) return null`. In CI the credentials come
 * from Workload Identity Federation: the workflow writes a short-lived GitHub
 * OIDC token to a file and the SDK exchanges it for an access token. There is no
 * API key at all in that path, so gating on one would silently disable every
 * Anthropic call in production while still working locally.
 */

const MODELS = {
  // Fable 5: thinking is always on and bills as output, so every call site must
  // pass an explicit output_config.effort — see REVIEW_CALL_CONFIG.
  REVIEWER: 'claude-fable-5',
};

/**
 * Which credential source the SDK will find, or null when it will find none.
 * Federation needs the whole quartet; a partial set is a misconfiguration, not
 * a usable credential.
 * @return {'api-key'|'federation'|null}
 */
function credentialSource() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'api-key';
  const federated =
    process.env.ANTHROPIC_FEDERATION_RULE_ID &&
    process.env.ANTHROPIC_ORGANIZATION_ID &&
    process.env.ANTHROPIC_SERVICE_ACCOUNT_ID &&
    (process.env.ANTHROPIC_IDENTITY_TOKEN_FILE || process.env.ANTHROPIC_IDENTITY_TOKEN);
  return federated ? 'federation' : null;
}

let client = null;
let initialized = false;

function getAnthropicClient() {
  if (initialized) return client;
  initialized = true;

  const source = credentialSource();
  if (!source) return null;

  try {
    // Required lazily so a missing optional dependency degrades to "no reviewer"
    // rather than breaking the generator at import time.
    const mod = require('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod.Anthropic || mod;
    // Zero-arg: the SDK resolves the API key or performs the WIF token exchange
    // itself, and refreshes the federated token before it expires.
    client = new Anthropic();
    console.log(`Anthropic client initialized (credentials: ${source})`);
  } catch (error) {
    console.warn('Failed to initialize Anthropic client:', error.message);
    client = null;
  }
  return client;
}

module.exports = { getAnthropicClient, credentialSource, MODELS };

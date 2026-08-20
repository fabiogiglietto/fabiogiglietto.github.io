/**
 * Tests for the bio reviewer's cost controls, output validation, and the
 * credential detection that Workload Identity Federation depends on.
 */

const { _testing } = require('../scripts/generators/bio-reviewer');
const { isUsableRevision, buildPrompt, REVIEW_CALL_CONFIG, REVIEW_SCHEMA } = _testing;

const para = (n, filler = 'word ') => Array.from({ length: n }, (_, i) => `<p>${filler.repeat(20)}${i}</p>`).join('\n');

describe('Anthropic call cost controls', () => {
  // Thinking bills as output and is always on for Fable 5; omitting `effort`
  // defaults to 'high'. This is the same failure mode as an unset Gemini
  // thinkingConfig — invisible until the monthly bill arrives.
  test('declares an explicit output token cap', () => {
    expect(typeof REVIEW_CALL_CONFIG.maxTokens).toBe('number');
    expect(REVIEW_CALL_CONFIG.maxTokens).toBeGreaterThan(0);
    expect(REVIEW_CALL_CONFIG.maxTokens).toBeLessThanOrEqual(8000);
  });

  test('declares an explicit, non-default effort level', () => {
    expect(['low', 'medium']).toContain(REVIEW_CALL_CONFIG.effort);
  });
});

describe('REVIEW_SCHEMA', () => {
  test('is a strict object schema', () => {
    expect(REVIEW_SCHEMA.additionalProperties).toBe(false);
    expect(REVIEW_SCHEMA.required).toEqual(
      expect.arrayContaining(['revised_html', 'flags', 'summary'])
    );
  });

  test('constrains flag severities to the documented set', () => {
    const severity = REVIEW_SCHEMA.properties.flags.items.properties.severity;
    expect(severity.enum).toEqual(['unsupported', 'overstated', 'omission', 'style']);
  });
});

describe('isUsableRevision (publish-path guard)', () => {
  const original = para(4);

  test('accepts a well-formed revision of similar length', () => {
    expect(isUsableRevision(para(4), original)).toBe(true);
  });

  test('rejects empty, missing and non-string revisions', () => {
    expect(isUsableRevision('', original)).toBe(false);
    expect(isUsableRevision('   ', original)).toBe(false);
    expect(isUsableRevision(undefined, original)).toBe(false);
    expect(isUsableRevision(null, original)).toBe(false);
    expect(isUsableRevision({ html: para(4) }, original)).toBe(false);
  });

  test('rejects a revision with too few paragraphs', () => {
    expect(isUsableRevision(para(2), original)).toBe(false);
  });

  test('rejects a truncated revision', () => {
    expect(isUsableRevision(para(1), original)).toBe(false);
  });

  test('rejects a revision that balloons in length', () => {
    expect(isUsableRevision(para(12), original)).toBe(false);
  });

  test('accepts <p> written with attributes', () => {
    const withAttrs = Array.from({ length: 4 }, () => `<p class="x">${'word '.repeat(20)}</p>`).join('\n');
    expect(isUsableRevision(withAttrs, original)).toBe(true);
  });
});

describe('buildPrompt', () => {
  test('includes both the sources and the biography under review', () => {
    const prompt = buildPrompt('<p>the bio</p>', 'THE SOURCES');
    expect(prompt).toContain('THE SOURCES');
    expect(prompt).toContain('<p>the bio</p>');
  });

  test('states that the reviewer has no web access', () => {
    expect(buildPrompt('<p>x</p>', 'y')).toMatch(/no web access/i);
  });
});

describe('credentialSource (Workload Identity Federation detection)', () => {
  const FEDERATION_VARS = [
    'ANTHROPIC_FEDERATION_RULE_ID',
    'ANTHROPIC_ORGANIZATION_ID',
    'ANTHROPIC_SERVICE_ACCOUNT_ID',
    'ANTHROPIC_IDENTITY_TOKEN_FILE',
  ];
  const ALL_VARS = [...FEDERATION_VARS, 'ANTHROPIC_IDENTITY_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
  let saved;
  let credentialSource;

  beforeEach(() => {
    saved = {};
    for (const v of ALL_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    jest.resetModules();
    ({ credentialSource } = require('../scripts/helpers/anthropic-client'));
  });

  afterEach(() => {
    for (const v of ALL_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  test('reports null when nothing is configured', () => {
    expect(credentialSource()).toBeNull();
  });

  test('detects the full federation quartet', () => {
    FEDERATION_VARS.forEach(v => { process.env[v] = 'x'; });
    expect(credentialSource()).toBe('federation');
  });

  test('accepts an inline identity token in place of a token file', () => {
    FEDERATION_VARS.forEach(v => { process.env[v] = 'x'; });
    delete process.env.ANTHROPIC_IDENTITY_TOKEN_FILE;
    process.env.ANTHROPIC_IDENTITY_TOKEN = 'jwt';
    expect(credentialSource()).toBe('federation');
  });

  test('treats a partial federation set as no credentials', () => {
    // A half-configured workflow must not look usable — the SDK would fall
    // through and fail at call time instead of skipping cleanly.
    process.env.ANTHROPIC_FEDERATION_RULE_ID = 'fdrl_x';
    process.env.ANTHROPIC_ORGANIZATION_ID = 'org';
    expect(credentialSource()).toBeNull();
  });

  test('reports api-key when one is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    expect(credentialSource()).toBe('api-key');
  });

  test('an API key shadows federation, matching SDK credential precedence', () => {
    FEDERATION_VARS.forEach(v => { process.env[v] = 'x'; });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    expect(credentialSource()).toBe('api-key');
  });
});

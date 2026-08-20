/**
 * Bio reviewer — a second-model pass over the Gemini-generated biography.
 *
 * This is a SOURCE-CONSISTENCY check, not a fact-check. The call is ungrounded
 * and has no web access, so it can only verify that the bio is supported by the
 * sources handed to it (authoritative bio seed, validated web mentions, Scholar
 * figures). That is the right check for the actual failure mode here: the
 * generator overreaching beyond its evidence. It cannot catch an error that is
 * already present in the bio seed.
 *
 * Fails open in every failure mode — a null return means "publish the original
 * unchanged". A rewriter sitting in a publish path must never be able to make
 * the output worse than not running at all.
 */

const fs = require('fs');
const path = require('path');
const { getAnthropicClient, credentialSource, MODELS } = require('../helpers/anthropic-client');

// Thinking bills as output at ~6x the input rate on every Anthropic model, and
// on Fable 5 it is always on — omitting `effort` silently defaults to 'high'.
// Both fields are mandatory at every call site; tests/bio-reviewer.test.js
// asserts it. Drop effort to 'low' to roughly halve the per-call cost.
const REVIEW_CALL_CONFIG = {
  maxTokens: 8000,
  effort: 'medium',
};

// Only <p> and <em> survive about-generator.js's sanitize-html allowlist in a
// form that matches the existing bio, so constrain the model rather than letting
// sanitization silently strip tags after the fact.
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    revised_html: {
      type: 'string',
      description: 'The full revised biography as <p> paragraphs. Use <em> for emphasis. No other tags, no markdown, no commentary.',
    },
    flags: {
      type: 'array',
      description: 'Claims that are not fully supported by the sources, or editorial risks. Empty if none.',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'The exact phrase from the biography.' },
          issue: { type: 'string', description: 'Why it is a problem, naming the source that does or does not support it.' },
          severity: {
            type: 'string',
            enum: ['unsupported', 'overstated', 'omission', 'style'],
          },
        },
        required: ['claim', 'issue', 'severity'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', description: 'One sentence on what changed.' },
  },
  required: ['revised_html', 'flags', 'summary'],
  additionalProperties: false,
};

const REVIEW_OUTPUT_PATH = path.join(__dirname, '../../public/data/bio-review.json');

function buildPrompt(html, sources) {
  return `You are reviewing a biography generated for an academic's personal website before it is published. You have no web access: the SOURCES below are the complete evidence base.

Do two things.

1. REVISE for style. Tighten the prose, cut filler and empty abstraction, vary sentence structure, and keep a professional but readable register. Preserve every well-supported fact. Do not add facts. Keep it to 3-4 paragraphs of a similar total length to the original.

2. CHECK every claim against the SOURCES and flag:
   - "unsupported": the claim appears in no source.
   - "overstated": a source supports something weaker or narrower than what the biography asserts. Journalists' causal framing restated in the subject's own voice belongs here.
   - "omission": the AUTHORITATIVE BIOGRAPHY contains a relevant fact the biography dropped.
   - "style": prose problems worth a human's attention.

Rules:
- The AUTHORITATIVE BIOGRAPHY section is ground truth. Never let another source override it on status, dates, roles, or tool authorship.
- Do not remove a claim just because you would not have written it; flag it and leave it in, unless it is outright unsupported by any source.
- Fix factual problems you are certain of directly in revised_html, and still flag what you changed.
- revised_html must contain only <p> and <em> tags.

--- SOURCES ---
${sources}

--- BIOGRAPHY UNDER REVIEW ---
${html}`;
}

/**
 * Validate the revision before it is allowed anywhere near the publish path.
 * A truncated or malformed rewrite is worse than no reviewer at all.
 */
function isUsableRevision(revised, original) {
  if (typeof revised !== 'string') return false;
  const trimmed = revised.trim();
  if (!trimmed) return false;
  const paragraphs = (trimmed.match(/<p[\s>]/gi) || []).length;
  if (paragraphs < 3) return false;
  const ratio = trimmed.length / original.length;
  return ratio >= 0.5 && ratio <= 1.5;
}

/**
 * Review a generated biography.
 * @param {String} html The generated biography HTML.
 * @param {String} sources The formatted source block (bio seed, mentions, etc.).
 * @return {Object|null} { html, flags, summary } or null to publish the original.
 */
async function reviewBio(html, sources) {
  if (!html || !sources) return null;

  const client = getAnthropicClient();
  if (!client) {
    console.log(`Bio reviewer skipped: no Anthropic credentials (checked ANTHROPIC_API_KEY and the federation variables)`);
    return null;
  }

  try {
    console.log(`Bio reviewer: calling ${MODELS.REVIEWER} (effort: ${REVIEW_CALL_CONFIG.effort}, credentials: ${credentialSource()})`);
    const response = await client.messages.create({
      model: MODELS.REVIEWER,
      max_tokens: REVIEW_CALL_CONFIG.maxTokens,
      output_config: {
        effort: REVIEW_CALL_CONFIG.effort,
        format: { type: 'json_schema', schema: REVIEW_SCHEMA },
      },
      messages: [{ role: 'user', content: buildPrompt(html, sources) }],
    });

    // A policy decline is HTTP 200 with stop_reason 'refusal'; a cap hit is
    // 'max_tokens'. Either way the content is not a usable revision.
    if (response.stop_reason !== 'end_turn') {
      console.warn(`Bio reviewer failed: stop_reason=${response.stop_reason}${response.stop_details ? ` (${response.stop_details.category})` : ''} — publishing the original`);
      return null;
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) {
      console.warn('Bio reviewer failed: no text block in response — publishing the original');
      return null;
    }

    const parsed = JSON.parse(textBlock.text);
    if (!isUsableRevision(parsed.revised_html, html)) {
      console.warn('Bio reviewer failed: revision did not pass shape checks — publishing the original');
      return null;
    }

    const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
    const usage = response.usage || {};
    console.log(`Bio reviewer ran: ${flags.length} flag(s). ${parsed.summary || ''}`);
    console.log(`  [cost] ${usage.input_tokens || 0} input, ${usage.output_tokens || 0} output (thinking included)`);
    for (const flag of flags) {
      console.log(`  [${flag.severity}] ${flag.claim} — ${flag.issue}`);
    }

    // Actions logs age out and the flags are the half a human needs to read.
    // public/data/ is committed by the workflow, so this persists for free.
    try {
      fs.writeFileSync(REVIEW_OUTPUT_PATH, JSON.stringify({
        reviewedAt: new Date().toISOString(),
        model: MODELS.REVIEWER,
        effort: REVIEW_CALL_CONFIG.effort,
        summary: parsed.summary || '',
        flags,
      }, null, 2));
    } catch (writeError) {
      console.warn(`Could not write bio-review.json: ${writeError.message}`);
    }

    return { html: parsed.revised_html.trim(), flags, summary: parsed.summary || '' };
  } catch (error) {
    console.warn(`Bio reviewer failed: ${error.message} — publishing the original`);
    return null;
  }
}

module.exports = {
  reviewBio,
  _testing: { isUsableRevision, buildPrompt, REVIEW_CALL_CONFIG, REVIEW_SCHEMA },
};

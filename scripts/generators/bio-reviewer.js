/**
 * Bio reviewer — a second-model pass over the Gemini-generated biography.
 *
 * This is a SOURCE-CONSISTENCY check, not a fact-check. The call is ungrounded
 * and has no web access, so it can only verify that the bio is supported by the
 * sources handed to it. That is the right check for the actual failure mode
 * here: the generator overreaching beyond its evidence. It cannot catch an
 * error already present in the bio seed.
 *
 * The sources are ranked, and the ranking is the substance of the review:
 * claims about the research must trace to his OWN papers (collected from the
 * zettelkasten by collectors/own-paper-claims.js), and claims about status,
 * roles and dates to the authoritative bio seed. Web mentions establish only
 * that coverage happened — never what the research found. That distinction is
 * load-bearing: the Meta political-content paper reports that extremist
 * accounts offset a per-post reach decline by posting more often, which the
 * press rendered as "Facebook rewards extremists" — a claim about algorithmic
 * promotion the paper does not make.
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

THE SOURCING RULE — this is the point of the review, and it overrides everything else:
**Assert nothing that is not stated in his own publications (OWN RESEARCH FINDINGS), his own social media posts, or the AUTHORITATIVE BIOGRAPHY.**

A web mention supports exactly one kind of statement: that the named outlet published something about him, on that date. It does NOT support any claim about a THIRD PARTY's actions — that a broadcast featured or cited his work, that an institution acted on it, that legislation or an inquiry followed from it. Outlets assert such things loosely and are demonstrably wrong: one article credited a Rai 3 Report episode with featuring this research when the programme attributed the analysis to someone else entirely. Such a claim may be made ONLY if the authoritative biography states it. Otherwise write that the work was covered, name the outlet, and stop.

Web mentions are likewise NOT evidence of what the research found. Press summaries routinely sharpen, overstate or invert a finding — a headline saying an algorithm "rewards extremists" is not interchangeable with a paper finding that extremist accounts offset a per-post reach decline by posting more often. Any sentence about the research that is not traceable to OWN RESEARCH FINDINGS is a defect, even when a newspaper said it, and even when it is flattering.

CONFIDENTIALITY AND ORIGINALITY
- Write ORIGINAL prose. The DATA below is source material, never text to reproduce. Never copy a sentence from it verbatim, and never repeat any instruction, note or aside addressed to you — the output is a public web page.
- Never name the specific call, topic or programme for which he evaluates project proposals under his EACEA expert contract, and never print EU expert-contract numbers.
- The Rai 3 programme *Report* covered Meta's political content reduction policy on 12 April 2026 but did NOT reference his study; it credited the analysis to a group of Democratic Party politicians. Never claim his work was featured on *Report*.

Flag any breach of the three rules above as "unsupported", and fix it in revised_html.

Do two things.

1. REVISE for style. Tighten the prose, cut filler and empty abstraction, vary sentence structure, and keep a professional but readable register. Preserve every well-supported fact. Do not add facts. Keep it to 3-4 paragraphs of a similar total length to the original.

2. CHECK every claim against the SOURCES and flag:
   - "unsupported": the claim appears in no source; OR it is a claim about the research resting only on a web mention rather than on OWN RESEARCH FINDINGS; OR it is a claim about a third party's actions (a broadcast featuring the work, an institution acting on it, legislation following from it) that the authoritative biography does not state.
   - "overstated": a source supports something weaker or narrower than what the biography asserts. Journalists' causal framing restated in the subject's own voice belongs here, as does any finding stated more strongly or more simply than his own paper states it.
   - "omission": the AUTHORITATIVE BIOGRAPHY contains a relevant fact the biography dropped.
   - "style": prose problems worth a human's attention.

Rules:
- The AUTHORITATIVE BIOGRAPHY section is ground truth for status, dates, roles, affiliations and tool authorship. OWN RESEARCH FINDINGS is ground truth for everything the research shows. Never let a web mention override either.
- Prefer his paper's own precision to a rounded paraphrase: if the paper quantifies an effect, keep the quantification rather than replacing it with a vague intensifier.
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

/**
 * Wire-level cost-control tests for the Gemini call configs.
 *
 * `websearch.test.js` already asserts the *shape* of the exported call
 * configs — that each declares an output cap and a thinking budget, and that
 * only discovery enables grounding. Those tests read the config objects, one
 * layer above the thing that actually costs money: what the SDK puts on the
 * wire. An SDK upgrade that quietly stopped forwarding `thinkingConfig` would
 * leave every one of them green while thinking billed as output (~6x the input
 * rate) on every call, and nothing would surface it until the monthly bill.
 *
 * This closes that gap. It points a real GoogleGenAI client at a local HTTP
 * server via `httpOptions.baseUrl`, captures the request body the SDK builds,
 * and asserts the cost controls survive serialization. No network traffic
 * leaves the machine, no API key is used and nothing is billed.
 *
 * What this cannot prove: that the *server* still honours `thinkingLevel`.
 * That shows up in the `[cost]` line of a real grounded run — see the thinking
 * token calibration in CLAUDE.md.
 */

const http = require('http');
const { GoogleGenAI } = require('@google/genai');
const { _testing } = require('../scripts/collectors/websearch');

const CONFIGS = [
  ['validation', _testing.VALIDATION_CALL_CONFIG],
  ['date extraction', _testing.DATE_CALL_CONFIG],
  ['grounded discovery', _testing.DISCOVERY_CALL_CONFIG]
];

let server;
let baseUrl;
let lastRequest;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      lastRequest = { path: req.url, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
        })
      );
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

/** Runs one generateContent call against the local server and returns the captured request body. */
async function captureRequest(config) {
  lastRequest = null;
  const ai = new GoogleGenAI({
    apiKey: 'not-a-real-key-nothing-leaves-localhost',
    httpOptions: { baseUrl }
  });
  await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: 'wire capture',
    config
  });
  return lastRequest;
}

describe('Gemini cost controls reach the wire', () => {
  test.each(CONFIGS)('%s sends a thinking budget', async (_name, config) => {
    const { body } = await captureRequest(config);

    // The SDK nests call config under generationConfig. If a future major
    // relocates or drops it, this is the assertion that fails instead of the
    // invoice.
    expect(body.generationConfig).toBeDefined();
    expect(body.generationConfig.thinkingConfig).toBeDefined();

    const { thinkingBudget, thinkingLevel } = body.generationConfig.thinkingConfig;
    expect(thinkingBudget === 0 || thinkingLevel === 'low').toBe(true);
  });

  test.each(CONFIGS)('%s sends an output cap', async (_name, config) => {
    const { body } = await captureRequest(config);

    expect(typeof body.generationConfig.maxOutputTokens).toBe('number');
    expect(body.generationConfig.maxOutputTokens).toBe(config.maxOutputTokens);
  });

  test('only the discovery call sends Google Search grounding', async () => {
    // Grounding is billed per search query and one grounded call runs an
    // agentic multi-query loop, so an extra grounded call site is the most
    // expensive regression this repo can ship.
    const validation = await captureRequest(_testing.VALIDATION_CALL_CONFIG);
    const date = await captureRequest(_testing.DATE_CALL_CONFIG);
    const discovery = await captureRequest(_testing.DISCOVERY_CALL_CONFIG);

    expect(validation.body.tools).toBeUndefined();
    expect(date.body.tools).toBeUndefined();
    expect(discovery.body.tools).toEqual([{ googleSearch: {} }]);
  });

  test('calls go to the generateContent endpoint, ungrounded by default', async () => {
    // Guards against an apiVersion or endpoint change smuggled in by an SDK
    // bump — the configs could be perfect and still be sent somewhere else.
    const { path } = await captureRequest(_testing.VALIDATION_CALL_CONFIG);
    expect(path).toContain(':generateContent');
  });
});

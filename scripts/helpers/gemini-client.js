/**
 * Shared Gemini (@google/genai) client.
 *
 * Lazily constructs a singleton GoogleGenAI instance on first use and returns
 * null if GEMINI_API_KEY is missing or initialization fails, so callers can
 * fall back gracefully without throwing.
 */

const { GoogleGenAI } = require('@google/genai');

const MODELS = {
  FLASH: 'gemini-2.5-flash',
  FLASH_LATEST: 'gemini-flash-latest',
};

let client = null;
let initialized = false;

function getGeminiClient() {
  if (initialized) return client;
  initialized = true;
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } catch (error) {
    console.warn('Failed to initialize Gemini client:', error.message);
    client = null;
  }
  return client;
}

module.exports = { getGeminiClient, MODELS };

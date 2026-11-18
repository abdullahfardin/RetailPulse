require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Candidate models for automatic fallback during high demand or API outages
const CANDIDATE_MODELS = [
  GEMINI_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-flash-latest'
].filter((m, idx, arr) => arr.indexOf(m) === idx);

/**
 * Call Gemini REST API with contents, system instructions, and optional tools.
 * Includes automatic model fallback for high-demand spikes (HTTP 503 / 429).
 *
 * @param {Array} contents - Array of content objects: [{ role: 'user', parts: [{ text: '...' }] }]
 * @param {string} systemInstruction - Optional system prompt guiding retail assistant behavior
 * @param {Array} tools - Optional function calling tool declarations
 * @param {number} timeoutMs - Timeout in milliseconds (default 20000)
 */
async function generateContent({ contents, systemInstruction = null, tools = null, timeoutMs = 20000 }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  const payload = {
    contents
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || `HTTP ${response.status}: Failed to generate content from Gemini API (${model})`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.details = data.error;
        err.model = model;

        // If the model is experiencing high demand (503), quota limits (429), or deprecated (404), try fallback model
        if ((response.status === 503 || response.status === 429 || response.status === 404) && CANDIDATE_MODELS.length > 1) {
          console.warn(`[Gemini Model Fallback]: Model ${model} returned HTTP ${response.status} (${errorMsg.slice(0, 60)}...). Trying next candidate model.`);
          lastError = err;
          continue;
        }

        throw err;
      }

      return data;
    } catch (error) {
      clearTimeout(timer);
      if (error.name === 'AbortError') {
        lastError = new Error(`Gemini API request timed out after ${timeoutMs}ms (${model})`);
        continue;
      }
      lastError = error;
      // If error is not a transient model error, continue to next candidate if available
      if (CANDIDATE_MODELS.indexOf(model) < CANDIDATE_MODELS.length - 1) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('All Gemini candidate models failed to respond.');
}

/**
 * Health check diagnostics for Gemini connectivity
 */
async function testGeminiConnection() {
  try {
    const res = await generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Respond with the exact word: "READY"' }]
        }
      ],
      timeoutMs: 10000
    });

    const reply = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return {
      success: true,
      model: GEMINI_MODEL,
      status: 'CONNECTED',
      reply
    };
  } catch (err) {
    return {
      success: false,
      model: GEMINI_MODEL,
      status: 'UNAVAILABLE',
      error: err.message
    };
  }
}

module.exports = {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  generateContent,
  testGeminiConnection
};

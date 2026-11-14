require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Call Gemini REST API with contents, system instructions, and optional tools
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(GEMINI_API_URL, {
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
      const errorMsg = data.error?.message || `HTTP ${response.status}: Failed to generate content from Gemini API`;
      const err = new Error(errorMsg);
      err.status = response.status;
      err.details = data.error;
      throw err;
    }

    return data;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new Error(`Gemini API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
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

const { generateContent, testGeminiConnection, GEMINI_MODEL } = require('../config/gemini');
const { db } = require('../config/database');

/**
 * System prompt setting the persona, domain boundaries, and language support
 */
function buildSystemInstruction(user, shop) {
  const shopName = shop?.name || 'RetailPulse Store';
  const currency = shop?.currency || 'BDT';
  const userName = user?.name || 'Store Owner';

  return `You are RetailPulse Agent, an intelligent retail operations assistant specifically built for small retail shops in Bangladesh.
Current Store: "${shopName}" (Currency: ${currency})
Current User: ${userName} (${user?.role || 'owner'})

Your Core Capabilities:
1. Answering questions about retail inventory, stock levels, product categories, and pricing.
2. Explaining sales trends, revenue performance, and top-selling items.
3. Suggesting reorders for depleted products with practical safety stock buffers.
4. Assisting cashiers and shop owners in both English and Bengali (Bangla), depending on the user's language.

Guidelines:
- Be concise, direct, professional, and helpful.
- When answering numbers or stock counts, only use provided context or facts; never hallucinate or invent false store data.
- If the user asks to modify sensitive data (e.g. deleting items or changing prices), remind them that confirmation is required.
- You can explain business concepts like markup, gross profit, inventory turnover, and reorder points in simple terms for shop managers.`;
}

/**
 * GET /api/agent/status
 * Check AI Agent service health and connectivity
 */
async function getAgentStatus(req, res) {
  try {
    const shouldVerify = req.query.verify === 'true';
    let connectivity = { success: true, status: 'CONFIGURED' };

    if (shouldVerify) {
      connectivity = await testGeminiConnection();
    }

    res.json({
      success: true,
      service: 'RetailPulse Agentic AI Engine',
      version: '1.0.0',
      model: GEMINI_MODEL,
      provider: 'Google Gemini Flash API',
      status: connectivity.status || 'READY',
      connectivity,
      capabilities: [
        'Natural Language Inventory Search',
        'Sales and Revenue Conversational Q&A',
        'Stock Depletion & Reorder Advice',
        'Bilingual Support (English & Bangla)'
      ]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to inspect agent service status',
      details: error.message
    });
  }
}

/**
 * POST /api/agent/chat
 * Conversational endpoint for retail assistance
 */
async function processChat(req, res) {
  try {
    const { message, history = [] } = req.body;
    const shopId = req.user.shop_id;
    const user = req.user;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message text is required.'
      });
    }

    // Retrieve shop details for personalized context
    const shop = await db.getAsync('SELECT * FROM shops WHERE id = ?', [shopId]);

    // Retrieve summary of shop catalog for contextual grounding
    const catalogSummary = await db.getAsync(
      `SELECT COUNT(*) as total_products,
              COALESCE(SUM(stock_quantity), 0) as total_units,
              COALESCE(SUM(CASE WHEN stock_quantity <= min_stock_threshold THEN 1 ELSE 0 END), 0) as low_stock_items
       FROM products
       WHERE shop_id = ?`,
      [shopId]
    );

    const systemInstruction = buildSystemInstruction(user, shop) + 
      `\nCurrent Live Store Snapshot: Total Catalog Items: ${catalogSummary?.total_products || 0}, On-Hand Physical Units: ${catalogSummary?.total_units || 0}, Items Low in Stock: ${catalogSummary?.low_stock_items || 0}.`;

    // Format chat contents according to Gemini API specs
    const contents = [];

    // Append up to last 6 messages from conversation history for context
    if (Array.isArray(history)) {
      const recentHistory = history.slice(-6);
      for (const entry of recentHistory) {
        if (entry.role && entry.text) {
          contents.push({
            role: entry.role === 'model' ? 'model' : 'user',
            parts: [{ text: entry.text }]
          });
        }
      }
    }

    // Append current user message
    contents.push({
      role: 'user',
      parts: [{ text: message.trim() }]
    });

    let aiReply = '';
    try {
      const response = await generateContent({
        contents,
        systemInstruction,
        timeoutMs: 25000
      });

      aiReply = response.candidates?.[0]?.content?.parts?.[0]?.text || 'No response returned by AI agent.';
    } catch (apiError) {
      console.warn('[Agent AI Fallback]:', apiError.message);
      // Graceful AI Outage Fallback (FR 18)
      aiReply = `[Notice: Offline Fallback Mode] The AI reasoning service is currently experiencing network latency or rate limit restrictions (${apiError.message}). 

You can continue managing your store directly through:
- Product & Stock: Open the "Products" tab to add, edit or adjust inventory.
- Billing / POS: Open the "Sales" tab to record customer orders with full atomic database transactions.
- Analytics: Open the "Dashboard" tab to view real-time KPIs and download CSV reports.`;
    }

    res.json({
      success: true,
      message: aiReply,
      model: GEMINI_MODEL,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Agent Controller Error]:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while communicating with the AI Agent.',
      details: error.message
    });
  }
}

module.exports = {
  getAgentStatus,
  processChat,
  buildSystemInstruction
};

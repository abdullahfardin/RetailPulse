const { generateContent, testGeminiConnection, GEMINI_MODEL } = require('../config/gemini');
const { db } = require('../config/database');
const { retailToolDeclarations, executeRetailTool } = require('../services/aiTools');

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
1. You have access to connected retail tools to query the store database. ALWAYS use connected tools when the user asks about stock, products, sales, top sellers, or reorders.
2. Explaining sales trends, revenue performance, and top-selling items.
3. Suggesting reorders for depleted products with practical safety stock buffers.
4. Assisting cashiers and shop owners in both English and Bengali (Bangla), depending on the user's language.

Guidelines:
- When a tool is available, invoke it rather than guessing.
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
      version: '1.1.0',
      model: GEMINI_MODEL,
      provider: 'Google Gemini Flash API',
      status: connectivity.status || 'READY',
      connectivity,
      capabilities: [
        'Natural Language Inventory Search',
        'Sales and Revenue Conversational Q&A',
        'Stock Depletion & Reorder Advice',
        'Bilingual Support (English & Bangla)',
        'Autonomous Database Tool Calling'
      ],
      tools: retailToolDeclarations.map(t => ({
        name: t.name,
        description: t.description
      }))
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
 * Offline Intent Resolver (FR 18 Outage Fallback)
 * Parses basic retail intents if external AI network is unavailable
 */
async function resolveOfflineIntent(message, shopId) {
  const lower = (message || '').toLowerCase();

  if (lower.includes('low stock') || lower.includes('alert') || lower.includes('reorder') || lower.includes('কম স্টক')) {
    const res = await executeRetailTool('getLowStockProducts', { limit: 5 }, shopId);
    return {
      toolName: 'getLowStockProducts',
      toolArgs: { limit: 5 },
      result: res,
      text: res.alert_count > 0 
        ? `Found ${res.alert_count} items below safety threshold. Suggested replenishment: ${res.items.map(i => `${i.name} (Need +${i.suggested_reorder})`).join(', ')}.`
        : 'All inventory items are currently above minimum safety thresholds.'
    };
  }

  if (lower.includes('sales') || lower.includes('revenue') || lower.includes('বিক্রি') || lower.includes('টাকা')) {
    const res = await executeRetailTool('getSalesSummary', { period: 'today' }, shopId);
    return {
      toolName: 'getSalesSummary',
      toolArgs: { period: 'today' },
      result: res,
      text: `Today's total sales: ${res.total_revenue} across ${res.total_orders} customer orders.`
    };
  }

  if (lower.includes('top') || lower.includes('best') || lower.includes('জনপ্রিয়')) {
    const res = await executeRetailTool('getTopSellingProducts', { limit: 5 }, shopId);
    return {
      toolName: 'getTopSellingProducts',
      toolArgs: { limit: 5 },
      result: res,
      text: res.top_sellers.length > 0
        ? `Top selling product: #${res.top_sellers[0].rank} ${res.top_sellers[0].name} (${res.top_sellers[0].units_sold} sold, ${res.top_sellers[0].gross_revenue}).`
        : 'No sales records found yet to compute top products.'
    };
  }

  if (lower.includes('stock') || lower.includes('search') || lower.includes('find') || lower.includes('খুঁজ') || lower.includes('আসে')) {
    // Extract likely search term or default
    const words = message.replace(/(search|find|stock of|check stock|what is|how many|do we have)/gi, '').trim();
    const query = words || 'Cola';
    const res = await executeRetailTool('searchProduct', { query }, shopId);
    return {
      toolName: 'searchProduct',
      toolArgs: { query },
      result: res,
      text: res.found_count > 0
        ? `Found ${res.found_count} matching products. Top match: ${res.products[0].name} (${res.products[0].stock}, ${res.products[0].price}).`
        : `No items found matching "${query}".`
    };
  }

  return null;
}

/**
 * POST /api/agent/chat
 * Conversational endpoint for retail assistance with autonomous tool calling
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
    const toolsExecuted = [];

    try {
      // 1. Initial call with tools declarations enabled
      const response = await generateContent({
        contents,
        systemInstruction,
        tools: [{ functionDeclarations: retailToolDeclarations }],
        timeoutMs: 25000
      });

      const firstCandidate = response.candidates?.[0];
      const functionCallPart = firstCandidate?.content?.parts?.find(p => p.functionCall);

      if (functionCallPart?.functionCall) {
        // Autonomous Tool Execution requested by Gemini!
        const { name, args } = functionCallPart.functionCall;
        const toolResult = await executeRetailTool(name, args || {}, shopId);
        toolsExecuted.push({ name, args, result: toolResult });

        // 2. Multi-turn synthesis: send tool output back to model for final customer explanation
        try {
          const functionFollowupContents = [
            ...contents,
            firstCandidate.content,
            {
              role: 'function',
              parts: [
                {
                  functionResponse: {
                    name,
                    response: {
                      output: toolResult
                    }
                  }
                }
              ]
            }
          ];

          const synthResponse = await generateContent({
            contents: functionFollowupContents,
            systemInstruction,
            timeoutMs: 25000
          });

          aiReply = synthResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (synthErr) {
          console.warn('[Tool Synthesis Warning]:', synthErr.message);
          aiReply = `I ran the store tool **${name}** on live database records.\n\nResult:\n${JSON.stringify(toolResult, null, 2)}`;
        }
      } else {
        aiReply = firstCandidate?.content?.parts?.[0]?.text || 'No response returned by AI agent.';
      }
    } catch (apiError) {
      console.warn('[Agent Tool Calling Fallback]:', apiError.message);
      
      // FR 18 Graceful Outage Fallback: Attempt local tool resolution from intent keywords
      const offlineResolved = await resolveOfflineIntent(message, shopId);
      if (offlineResolved) {
        toolsExecuted.push({
          name: offlineResolved.toolName,
          args: offlineResolved.toolArgs,
          result: offlineResolved.result
        });
        aiReply = `[Live Database Query]: ${offlineResolved.text}`;
      } else {
        aiReply = `[Notice: Offline Mode] The AI reasoning service is temporarily operating in local fallback mode. 

You can continue managing your store directly through:
- Product & Stock: Open the "Products" tab to add, edit or adjust inventory.
- Billing / POS: Open the "Sales" tab to record customer orders with full atomic database transactions.
- Analytics: Open the "Dashboard" tab to view real-time KPIs and download CSV reports.`;
      }
    }

    res.json({
      success: true,
      message: aiReply,
      tools_executed: toolsExecuted,
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
  buildSystemInstruction,
  resolveOfflineIntent
};

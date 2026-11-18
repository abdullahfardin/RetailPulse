const { generateContent, testGeminiConnection, GEMINI_MODEL } = require('../config/gemini');
const { db } = require('../config/database');
const {
  retailToolDeclarations,
  sensitiveToolDeclarations,
  allToolDeclarations,
  executeRetailTool
} = require('../services/aiTools');
const {
  createPendingConfirmation,
  getPendingConfirmation,
  listPendingConfirmations,
  cancelPendingConfirmation,
  executeConfirmedAction
} = require('../services/confirmationManager');
const {
  logAiAction,
  updateConfirmationStatus,
  getAuditLogs,
  getAuditLogById,
  getAuditSummary
} = require('../services/aiAuditLogger');

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
5. Explicit Confirmation Safety Gate: For destructive actions like deleting products or manual stock adjustments, you MUST trigger the confirmation tool. Inform the user that the action requires their explicit confirmation before changes take effect.

Guidelines:
- When a tool is available, invoke it rather than guessing.
- Be concise, direct, professional, and helpful.
- When answering numbers or stock counts, only use provided context or facts; never hallucinate or invent false store data.
- If the user asks to modify sensitive data (e.g. deleting items or changing stock), invoke the corresponding tool which will generate a confirmation token (e.g., CONF-XXXX). Explain the pending change clearly to the user.
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
      version: '1.4.0',
      model: GEMINI_MODEL,
      provider: 'Google Gemini Flash API',
      status: connectivity.status || 'READY',
      connectivity,
      capabilities: [
        'Natural Language Inventory Search',
        'Sales and Revenue Conversational Q&A',
        'Stock Depletion & Reorder Advice',
        'Bilingual Support (English & Bangla)',
        'Autonomous Database Tool Calling',
        'Two-Phase Explicit Confirmation Safety Gate (FR 13 & FR 14)',
        'Audit Trail & Observability Logging (Task T-1.4)'
      ],
      tools: retailToolDeclarations.map(t => ({
        name: t.name,
        description: t.description
      })),
      safety_tools: sensitiveToolDeclarations.map(t => ({
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
async function resolveOfflineIntent(message, shopId, userId = null) {
  const lower = (message || '').toLowerCase();

  // 1. Check for sensitive deletion intent
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('ডিলিট') || lower.includes('মুছে')) {
    const cleanIdentifier = message
      .replace(/(delete|remove|product|item|permanently|please|ডিলিট|করুন|মুছে|ফেলুন)/gi, '')
      .trim();

    if (cleanIdentifier) {
      const res = await executeRetailTool('deleteProduct', { identifier: cleanIdentifier, reason: 'Requested via chat command' }, shopId, userId);
      if (res.requires_confirmation) {
        return {
          toolName: 'deleteProduct',
          toolArgs: { identifier: cleanIdentifier },
          result: res,
          requires_confirmation: true,
          confirmation: res,
          text: `⚠️ **Explicit Confirmation Required**\n\nI have staged the deletion for: **${res.summary}**\n\nConfirmation Token: \`${res.token}\` (Expires in ${Math.floor(res.expires_in_seconds / 60)} minutes).\n\nTo execute, reply: **"confirm ${res.token}"** or use the Confirm button.`
        };
      }
    }
  }

  // 2. Check for sensitive stock adjustment intent (Restock or Deduct)
  if (lower.includes('restock') || lower.includes('deduct') || lower.includes('adjust stock') || lower.includes('damage') || lower.includes('নষ্ট') || lower.includes('স্টক')) {
    const isDeduct = lower.includes('deduct') || lower.includes('damage') || lower.includes('নষ্ট') || lower.includes('কম');
    const numbers = message.match(/\d+/g);
    const qty = numbers ? parseInt(numbers[0], 10) : null;

    if (qty && qty > 0) {
      const cleanIdentifier = message
        .replace(/(restock|deduct|adjust|stock|of|units|items|pcs|damage|নষ্ট|কমান|যোগ|করুন|\d+)/gi, '')
        .trim();

      if (cleanIdentifier) {
        const res = await executeRetailTool('updateStock', {
          identifier: cleanIdentifier,
          actionType: isDeduct ? 'DEDUCT' : 'RESTOCK',
          quantity: qty,
          reason: isDeduct ? 'Reported damaged/expired stock' : 'Stock replenishment'
        }, shopId, userId);

        if (res.requires_confirmation) {
          return {
            toolName: 'updateStock',
            toolArgs: { identifier: cleanIdentifier, actionType: isDeduct ? 'DEDUCT' : 'RESTOCK', quantity: qty },
            result: res,
            requires_confirmation: true,
            confirmation: res,
            text: `⚠️ **Explicit Confirmation Required**\n\nI have staged the stock change: **${res.summary}**\n\nConfirmation Token: \`${res.token}\` (Expires in ${Math.floor(res.expires_in_seconds / 60)} minutes).\n\nTo execute, reply: **"confirm ${res.token}"** or use the Confirm button.`
          };
        }
      }
    }
  }

  // 3. Low stock alert intent
  if (lower.includes('low stock') || lower.includes('alert') || lower.includes('reorder') || lower.includes('কম স্টক')) {
    const res = await executeRetailTool('getLowStockProducts', { limit: 5 }, shopId, userId);
    return {
      toolName: 'getLowStockProducts',
      toolArgs: { limit: 5 },
      result: res,
      text: res.alert_count > 0 
        ? `Found ${res.alert_count} items below safety threshold. Suggested replenishment: ${res.items.map(i => `${i.name} (Need +${i.suggested_reorder})`).join(', ')}.`
        : 'All inventory items are currently above minimum safety thresholds.'
    };
  }

  // 4. Sales and revenue intent
  if (lower.includes('sales') || lower.includes('revenue') || lower.includes('বিক্রি') || lower.includes('টাকা')) {
    const res = await executeRetailTool('getSalesSummary', { period: 'today' }, shopId, userId);
    return {
      toolName: 'getSalesSummary',
      toolArgs: { period: 'today' },
      result: res,
      text: `Today's total sales: ${res.total_revenue} across ${res.total_orders} customer orders.`
    };
  }

  // 5. Top selling intent
  if (lower.includes('top') || lower.includes('best') || lower.includes('জনপ্রিয়')) {
    const res = await executeRetailTool('getTopSellingProducts', { limit: 5 }, shopId, userId);
    return {
      toolName: 'getTopSellingProducts',
      toolArgs: { limit: 5 },
      result: res,
      text: res.top_sellers.length > 0
        ? `Top selling product: #${res.top_sellers[0].rank} ${res.top_sellers[0].name} (${res.top_sellers[0].units_sold} sold, ${res.top_sellers[0].gross_revenue}).`
        : 'No sales records found yet to compute top products.'
    };
  }

  // 6. Stock check or inventory search
  if (lower.includes('stock') || lower.includes('search') || lower.includes('find') || lower.includes('খুঁজ') || lower.includes('আসে')) {
    const words = message.replace(/(search|find|stock of|check stock|what is|how many|do we have)/gi, '').trim();
    const query = words || 'Cola';
    const res = await executeRetailTool('searchProduct', { query }, shopId, userId);
    return {
      toolName: 'searchProduct',
      toolArgs: { query },
      result: res,
      text: res.found_count > 0
        ? `Found ${res.found_count} matching products. Top match: ${res.products[0].name} (${res.products[0].stock}, ${res.products[0].price}).`
        : `No items found matching "${query}".`
    };
  }

  // 7. Latest sales receipt / invoice intent
  if (lower.includes('receipt') || lower.includes('invoice') || lower.includes('recipt') || lower.includes('memo') || lower.includes('রিসিপ্ট') || lower.includes('মেমো') || lower.includes('চালান')) {
    const res = await executeRetailTool('getLatestReceipt', {}, shopId, userId);
    if (!res.found) {
      return {
        toolName: 'getLatestReceipt',
        toolArgs: {},
        result: res,
        text: 'No sales receipts recorded yet in the store.'
      };
    }
    const itemList = (res.items || []).map(i => `${i.product} x${i.quantity} (${i.line_total})`).join(', ');
    return {
      toolName: 'getLatestReceipt',
      toolArgs: {},
      result: res,
      text: `📄 **Latest Sales Invoice: ${res.invoice_number}**\n- Date: ${new Date(res.created_at).toLocaleString()}\n- Customer: ${res.customer_name}\n- Items: ${itemList}\n- Total Payable: **${res.total_amount}** (${res.payment_method.toUpperCase()})`
    };
  }

  // 8. Conversational greeting & help fallback intent
  const trimmed = message.trim().toLowerCase();
  if (/^(hi|hello|hey|assalamu\s?alaikum|salam|hola|হাই|হ্যালো|সালাম|কেমন|হেল্প|help)/i.test(trimmed)) {
    return {
      toolName: 'offlineGreeting',
      toolArgs: {},
      result: { status: 'ready' },
      text: `👋 **Hello! Welcome to RetailPulse AI.**\nI can help you check live inventory, query stock deficits, aggregate sales totals, and execute safe store operations.\n\nQuick questions you can ask me:\n- 📊 *"Today's sales summary"*\n- ⚠️ *"Check low stock products"*\n- 📄 *"Show last receipt"*\n- 🏆 *"What are the top 3 selling products?"*`
    };
  }

  return null;
}

/**
 * Format raw tool output into clean, user-friendly markdown if model synthesis is unavailable
 */
function formatToolResultToHumanReadable(toolName, result) {
  if (!result) return 'Action completed with live store database.';

  if (result.requires_confirmation) {
    return `⚠️ **Explicit Confirmation Required**\n${result.summary}\n\nToken: \`${result.token}\` (Expires in ${result.expires_in_minutes || 5} minutes)`;
  }

  if (toolName === 'getLowStockProducts') {
    if (!result.items || result.items.length === 0) {
      return '✅ All inventory items are currently well-stocked above their minimum safety thresholds.';
    }
    const lines = result.items.map(it =>
      `• **${it.name}** (${it.sku}): Current stock is **${it.current_stock}** (threshold: ${it.threshold}). Suggested reorder: **${it.suggested_reorder}** (~${it.estimated_cost})`
    );
    return `⚠️ **Low Stock Alert (${result.alert_count} items need attention):**\n\n${lines.join('\n')}\n\nWould you like me to help restock or record a supplier purchase?`;
  }

  if (toolName === 'getSalesSummary') {
    return `📊 **Sales Summary (${(result.period || 'today').toUpperCase()}):**\n` +
      `• Total Revenue: **${result.gross_revenue}**\n` +
      `• Total Orders: **${result.total_orders}**\n` +
      `• Cash: **${result.cash_total}** | Digital/Card: **${result.card_total}**\n` +
      `• Average Order Value: **${result.avg_order_value}**`;
  }

  if (toolName === 'getTopSellingProducts') {
    if (!result.top_sellers || result.top_sellers.length === 0) {
      return 'No sales records found for this period.';
    }
    const lines = result.top_sellers.map(s =>
      `#${s.rank} **${s.name}** — ${s.units_sold} units sold (${s.gross_revenue})`
    );
    return `🏆 **Top Selling Products (${result.period}):**\n\n${lines.join('\n')}`;
  }

  if (toolName === 'getLatestReceipt') {
    if (!result.found) return 'No sales transactions recorded yet in the store.';
    const items = (result.items || []).map(i => `• ${i.product} x${i.quantity} (${i.line_total})`).join('\n');
    return `📄 **Latest Sales Invoice: ${result.invoice_number}**\n` +
      `• Customer: **${result.customer_name}** | Cashier: **${result.cashier}**\n` +
      `• Date: ${new Date(result.created_at).toLocaleString()}\n` +
      `• Items:\n${items}\n` +
      `• **Total: ${result.total_amount}** (${(result.payment_method || 'CASH').toUpperCase()})`;
  }

  if (toolName === 'searchProduct') {
    if (!result.products || result.products.length === 0) {
      return `No products found matching your search.`;
    }
    const items = result.products.map(p => `• **${p.name}** (${p.sku}) — Stock: **${p.stock}**, Price: **${p.price}**`).join('\n');
    return `🔍 **Found ${result.found_count} matching product(s):**\n\n${items}`;
  }

  if (toolName === 'checkStock') {
    if (!result.found) return `Product not found in store inventory.`;
    return `📦 **${result.name}** (${result.sku})\n• Current Stock: **${result.current_stock}**\n• Price: **${result.price}**\n• Status: **${(result.status || 'in_stock').toUpperCase()}**`;
  }

  return `I ran the store tool **${toolName}** on live database records successfully.`;
}

/**
 * POST /api/agent/chat
 * Conversational endpoint for retail assistance with autonomous tool calling, safety confirmation gate & audit logging
 */
async function processChat(req, res) {
  const startTime = Date.now();
  try {
    const { message, history = [], session_id = null } = req.body;
    const shopId = req.user.shop_id;
    const user = req.user;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message text is required.'
      });
    }

    const trimmedMessage = message.trim();

    // Check for direct chat cancellation: e.g. "cancel CONF-12345678" or "reject CONF-12345678"
    const cancelMatch = trimmedMessage.match(/(?:cancel|reject|abort|no)\s+(CONF-[A-F0-9]{8})/i);
    if (cancelMatch) {
      const token = cancelMatch[1].toUpperCase();
      const cancelled = cancelPendingConfirmation(token, shopId);
      if (cancelled) {
        await updateConfirmationStatus(token, 'CANCELLED');
      }

      const replyText = cancelled 
        ? `[Action Cancelled] The pending operation with token ${token} was safely cancelled.`
        : `No active pending operation found with token ${token}.`;

      const latencyMs = Date.now() - startTime;
      await logAiAction({
        shopId,
        userId: user.id,
        sessionId: session_id,
        userPrompt: trimmedMessage,
        modelResponse: replyText,
        requiresConfirmation: 0,
        confirmationToken: token,
        confirmationStatus: cancelled ? 'CANCELLED' : 'NONE',
        tokensUsed: Math.ceil((trimmedMessage.length + replyText.length) / 4),
        latencyMs
      });

      return res.json({
        success: true,
        message: replyText,
        status: cancelled ? 'CANCELLED' : 'NOT_FOUND',
        token,
        timestamp: new Date().toISOString()
      });
    }

    // Check for direct chat confirmation: e.g. "confirm CONF-12345678" or "yes CONF-12345678" or standalone "CONF-12345678"
    const confirmMatch = trimmedMessage.match(/(?:confirm|approve|execute|yes)?\s*(CONF-[A-F0-9]{8})\b/i);
    if (confirmMatch && (trimmedMessage.toLowerCase().includes('confirm') || trimmedMessage.toLowerCase().includes('approve') || trimmedMessage.toUpperCase().startsWith('CONF-'))) {
      const token = confirmMatch[1].toUpperCase();
      try {
        const executionResult = await executeConfirmedAction(token, shopId, user.id);
        await updateConfirmationStatus(token, 'CONFIRMED');

        const replyText = `[Action Confirmed & Executed] ✅ ${executionResult.result}`;
        const latencyMs = Date.now() - startTime;
        await logAiAction({
          shopId,
          userId: user.id,
          sessionId: session_id,
          userPrompt: trimmedMessage,
          modelResponse: replyText,
          toolResults: [executionResult],
          requiresConfirmation: 0,
          confirmationToken: token,
          confirmationStatus: 'CONFIRMED',
          tokensUsed: Math.ceil((trimmedMessage.length + replyText.length) / 4),
          latencyMs
        });

        return res.json({
          success: true,
          message: replyText,
          status: 'EXECUTED',
          action_executed: executionResult,
          tools_executed: [],
          model: GEMINI_MODEL,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        return res.json({
          success: false,
          message: `[Confirmation Failed] ❌ ${err.message}`,
          status: 'ERROR',
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
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
      parts: [{ text: trimmedMessage }]
    });

    let aiReply = '';
    const toolsExecuted = [];
    let activeConfirmation = null;
    let tokensEstimate = Math.ceil((trimmedMessage.length + 100) / 4);

    try {
      // 1. Initial call with tools declarations enabled
      const response = await generateContent({
        contents,
        systemInstruction,
        tools: [{ functionDeclarations: allToolDeclarations }],
        timeoutMs: 25000
      });

      const firstCandidate = response.candidates?.[0];
      const functionCallPart = firstCandidate?.content?.parts?.find(p => p.functionCall);

      if (functionCallPart?.functionCall) {
        // Autonomous Tool Execution requested by Gemini!
        const { name, args } = functionCallPart.functionCall;
        const toolResult = await executeRetailTool(name, args || {}, shopId, user.id);
        toolsExecuted.push({ name, args, result: toolResult });

        if (toolResult?.requires_confirmation) {
          activeConfirmation = toolResult;
        }

        // 2. Multi-turn synthesis: send tool output back to model for final customer explanation
        try {
          const functionFollowupContents = [
            ...contents,
            firstCandidate.content,
            {
              role: 'user',
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
            tools: [{ functionDeclarations: allToolDeclarations }],
            timeoutMs: 25000
          });

          aiReply = synthResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
          tokensEstimate = (response?.usageMetadata?.totalTokenCount || 0) + (synthResponse?.usageMetadata?.totalTokenCount || 0);
          
          if (!aiReply || !aiReply.trim()) {
            aiReply = formatToolResultToHumanReadable(name, toolResult);
          }
        } catch (synthErr) {
          console.warn('[Tool Synthesis Fallback]:', synthErr.message);
          aiReply = formatToolResultToHumanReadable(name, toolResult);
        }
      } else {
        aiReply = firstCandidate?.content?.parts?.[0]?.text || 'No response returned by AI agent.';
        tokensEstimate = response?.usageMetadata?.totalTokenCount || tokensEstimate;
      }
    } catch (apiError) {
      console.warn('[Agent Tool Calling Fallback]:', apiError.message);
      
      // FR 18 Graceful Outage Fallback: Attempt local tool resolution from intent keywords
      const offlineResolved = await resolveOfflineIntent(trimmedMessage, shopId, user.id);
      if (offlineResolved) {
        toolsExecuted.push({
          name: offlineResolved.toolName,
          args: offlineResolved.toolArgs,
          result: offlineResolved.result
        });
        if (offlineResolved.requires_confirmation) {
          activeConfirmation = offlineResolved.confirmation;
        }
        aiReply = offlineResolved.text;
      } else {
        aiReply = `[Notice: Offline Mode] The AI reasoning service is temporarily operating in local fallback mode. 

You can continue managing your store directly through:
- Product & Stock: Open the "Products" tab to add, edit or adjust inventory.
- Billing / POS: Open the "Sales" tab to record customer orders with full atomic database transactions.
- Analytics: Open the "Dashboard" tab to view real-time KPIs and download CSV reports.`;
      }
    }

    const latencyMs = Date.now() - startTime;
    if (!tokensEstimate || tokensEstimate === 0) {
      tokensEstimate = Math.ceil((trimmedMessage.length + aiReply.length) / 4);
    }

    // Persist AI Action Log to database (Task T-1.4)
    const logResult = await logAiAction({
      shopId,
      userId: user.id,
      sessionId: session_id,
      userPrompt: trimmedMessage,
      modelResponse: aiReply,
      toolsCalled: toolsExecuted.length > 0 ? toolsExecuted.map(t => ({ name: t.name, args: t.args })) : null,
      toolResults: toolsExecuted.length > 0 ? toolsExecuted.map(t => t.result) : null,
      requiresConfirmation: activeConfirmation ? 1 : 0,
      confirmationToken: activeConfirmation ? activeConfirmation.token : null,
      confirmationStatus: activeConfirmation ? 'PENDING' : 'NONE',
      tokensUsed: tokensEstimate,
      latencyMs
    });

    const responsePayload = {
      success: true,
      message: aiReply,
      reply: aiReply,
      tools_executed: toolsExecuted,
      tools_used: toolsExecuted,
      model: GEMINI_MODEL,
      latency_ms: latencyMs,
      log_id: logResult ? logResult.id : null,
      timestamp: new Date().toISOString()
    };

    if (activeConfirmation) {
      responsePayload.requires_confirmation = true;
      responsePayload.confirmation = activeConfirmation;
    }

    res.json(responsePayload);
  } catch (error) {
    console.error('[Agent Controller Error]:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while communicating with the AI Agent.',
      details: error.message
    });
  }
}

/**
 * POST /api/agent/confirm
 * Dedicated endpoint to explicitly confirm or reject a pending sensitive action
 */
async function confirmAction(req, res) {
  try {
    const shopId = req.user.shop_id;
    const userId = req.user.id;
    const { token, confirm = true } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation token is required.'
      });
    }

    const cleanToken = token.trim().toUpperCase();

    // Check if client wishes to cancel/reject
    if (confirm === false || confirm === 'false' || confirm === 'reject' || confirm === 'cancel') {
      const cancelled = cancelPendingConfirmation(cleanToken, shopId);
      if (!cancelled) {
        return res.status(404).json({
          success: false,
          error: 'Invalid, already handled, or expired confirmation token.'
        });
      }
      await updateConfirmationStatus(cleanToken, 'CANCELLED');
      return res.json({
        success: true,
        message: `Action with token ${cleanToken} was safely cancelled.`,
        token: cleanToken,
        status: 'CANCELLED'
      });
    }

    // Execute confirmed action inside atomic transaction
    const result = await executeConfirmedAction(cleanToken, shopId, userId);
    await updateConfirmationStatus(cleanToken, 'CONFIRMED');

    return res.json({
      success: true,
      message: 'Sensitive action successfully confirmed and executed.',
      status: 'EXECUTED',
      result
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/agent/confirmations
 * List all active pending confirmations for the current shop
 */
async function listConfirmations(req, res) {
  try {
    const shopId = req.user.shop_id;
    const pendingList = listPendingConfirmations(shopId);

    res.json({
      success: true,
      count: pendingList.length,
      confirmations: pendingList
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve active confirmations.',
      details: error.message
    });
  }
}

/**
 * GET /api/agent/confirm/:token
 * Retrieve details of a specific pending confirmation token
 */
async function getConfirmation(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { token } = req.params;

    const pending = getPendingConfirmation(token, shopId);
    if (!pending) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired confirmation token.'
      });
    }

    res.json({
      success: true,
      confirmation: {
        token: pending.token,
        action: pending.action,
        summary: pending.summary,
        created_at: new Date(pending.created_at).toISOString(),
        expires_at: new Date(pending.expires_at).toISOString(),
        expires_in_seconds: Math.max(0, Math.floor((pending.expires_at - Date.now()) / 1000))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to inspect confirmation token.',
      details: error.message
    });
  }
}

/**
 * GET /api/agent/logs
 * Retrieve paginated AI action audit logs (Task T-1.4)
 */
async function getAgentLogs(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { limit, offset, status, userId, requiresConfirmation } = req.query;

    const logsData = await getAuditLogs(shopId, {
      limit,
      offset,
      status,
      userId,
      requiresConfirmationOnly: requiresConfirmation
    });

    res.json({
      success: true,
      ...logsData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve AI audit logs.',
      details: error.message
    });
  }
}

/**
 * GET /api/agent/logs/:id
 * Retrieve single AI action audit log entry
 */
async function getAgentLogDetails(req, res) {
  try {
    const shopId = req.user.shop_id;
    const logId = parseInt(req.params.id, 10);

    const log = await getAuditLogById(logId, shopId);
    if (!log) {
      return res.status(404).json({
        success: false,
        error: 'AI audit log not found.'
      });
    }

    res.json({
      success: true,
      log
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to inspect AI audit log.',
      details: error.message
    });
  }
}

/**
 * GET /api/agent/analytics
 * Retrieve high-level summary KPIs of AI assistant activity
 */
async function getAgentAnalytics(req, res) {
  try {
    const shopId = req.user.shop_id;
    const summary = await getAuditSummary(shopId);

    res.json({
      success: true,
      summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate AI analytics summary.',
      details: error.message
    });
  }
}

module.exports = {
  getAgentStatus,
  processChat,
  confirmAction,
  listConfirmations,
  getConfirmation,
  getAgentLogs,
  getAgentLogDetails,
  getAgentAnalytics,
  buildSystemInstruction,
  resolveOfflineIntent
};

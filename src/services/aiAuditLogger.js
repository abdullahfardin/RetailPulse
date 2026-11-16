const { db } = require('../config/database');

/**
 * Service to record and query AI assistant operations, tool executions,
 * and explicit safety confirmation events in the ai_action_logs table.
 */

/**
 * Insert a new AI action log entry
 * @param {Object} entryData
 */
async function logAiAction({
  shopId,
  userId = null,
  sessionId = null,
  userPrompt,
  modelResponse = null,
  toolsCalled = null,
  toolResults = null,
  requiresConfirmation = 0,
  confirmationToken = null,
  confirmationStatus = 'NONE',
  tokensUsed = 0,
  latencyMs = 0
}) {
  try {
    const serializedTools = toolsCalled ? JSON.stringify(toolsCalled) : null;
    const serializedResults = toolResults ? JSON.stringify(toolResults) : null;
    const isConfirmation = requiresConfirmation ? 1 : 0;

    const result = await db.runAsync(
      `INSERT INTO ai_action_logs (
        shop_id, user_id, session_id, user_prompt, model_response,
        tools_called, tool_results, requires_confirmation, confirmation_token,
        confirmation_status, tokens_used, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        userId,
        sessionId,
        userPrompt,
        modelResponse,
        serializedTools,
        serializedResults,
        isConfirmation,
        confirmationToken,
        confirmationStatus,
        tokensUsed || 0,
        latencyMs || 0
      ]
    );

    return {
      id: result.lastID,
      shop_id: shopId,
      user_id: userId,
      session_id: sessionId,
      user_prompt: userPrompt,
      requires_confirmation: isConfirmation === 1,
      confirmation_token: confirmationToken,
      confirmation_status: confirmationStatus,
      tokens_used: tokensUsed,
      latency_ms: latencyMs
    };
  } catch (error) {
    console.error('[AI Audit Logger] Failed to log AI action:', error.message);
    // Return null without throwing to prevent logging errors from failing user chat
    return null;
  }
}

/**
 * Update confirmation status when user confirms or cancels an action
 * @param {string} token - Confirmation token (e.g. CONF-XXXX)
 * @param {string} status - 'CONFIRMED' or 'CANCELLED'
 */
async function updateConfirmationStatus(token, status) {
  try {
    if (!token) return false;
    const cleanToken = token.trim().toUpperCase();
    await db.runAsync(
      `UPDATE ai_action_logs
       SET confirmation_status = ?
       WHERE confirmation_token = ?`,
      [status, cleanToken]
    );
    return true;
  } catch (error) {
    console.error('[AI Audit Logger] Failed to update confirmation status:', error.message);
    return false;
  }
}

/**
 * Query paginated AI audit logs scoped to authenticated shopId
 * @param {number} shopId
 * @param {Object} options - { limit, offset, status, requiresConfirmationOnly, userId }
 */
async function getAuditLogs(shopId, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(options.offset, 10) || 0, 0);

  const conditions = ['l.shop_id = ?'];
  const params = [shopId];

  if (options.userId) {
    conditions.push('l.user_id = ?');
    params.push(parseInt(options.userId, 10));
  }

  if (options.status) {
    conditions.push('l.confirmation_status = ?');
    params.push(options.status.toUpperCase());
  }

  if (options.requiresConfirmationOnly === true || options.requiresConfirmationOnly === 'true') {
    conditions.push('l.requires_confirmation = 1');
  }

  const whereClause = conditions.join(' AND ');

  const totalRow = await db.getAsync(
    `SELECT COUNT(*) as total FROM ai_action_logs l WHERE ${whereClause}`,
    params
  );

  const rows = await db.allAsync(
    `SELECT l.*, u.name as user_name, u.role as user_role
     FROM ai_action_logs l
     LEFT JOIN users u ON l.user_id = u.id
     WHERE ${whereClause}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const formattedLogs = rows.map(r => {
    let parsedTools = null;
    let parsedResults = null;
    try {
      if (r.tools_called) parsedTools = JSON.parse(r.tools_called);
    } catch (_) {}
    try {
      if (r.tool_results) parsedResults = JSON.parse(r.tool_results);
    } catch (_) {}

    return {
      id: r.id,
      shop_id: r.shop_id,
      user: r.user_id ? { id: r.user_id, name: r.user_name, role: r.user_role } : null,
      session_id: r.session_id,
      user_prompt: r.user_prompt,
      model_response: r.model_response,
      tools_called: parsedTools,
      tool_results: parsedResults,
      requires_confirmation: r.requires_confirmation === 1,
      confirmation_token: r.confirmation_token,
      confirmation_status: r.confirmation_status,
      tokens_used: r.tokens_used,
      latency_ms: r.latency_ms,
      created_at: r.created_at
    };
  });

  return {
    total: totalRow ? totalRow.total : 0,
    count: formattedLogs.length,
    offset,
    limit,
    logs: formattedLogs
  };
}

/**
 * Get detailed view of single AI audit log
 */
async function getAuditLogById(logId, shopId) {
  const r = await db.getAsync(
    `SELECT l.*, u.name as user_name, u.role as user_role
     FROM ai_action_logs l
     LEFT JOIN users u ON l.user_id = u.id
     WHERE l.id = ? AND l.shop_id = ?`,
    [logId, shopId]
  );

  if (!r) return null;

  let parsedTools = null;
  let parsedResults = null;
  try {
    if (r.tools_called) parsedTools = JSON.parse(r.tools_called);
  } catch (_) {}
  try {
    if (r.tool_results) parsedResults = JSON.parse(r.tool_results);
  } catch (_) {}

  return {
    id: r.id,
    shop_id: r.shop_id,
    user: r.user_id ? { id: r.user_id, name: r.user_name, role: r.user_role } : null,
    session_id: r.session_id,
    user_prompt: r.user_prompt,
    model_response: r.model_response,
    tools_called: parsedTools,
    tool_results: parsedResults,
    requires_confirmation: r.requires_confirmation === 1,
    confirmation_token: r.confirmation_token,
    confirmation_status: r.confirmation_status,
    tokens_used: r.tokens_used,
    latency_ms: r.latency_ms,
    created_at: r.created_at
  };
}

/**
 * Get aggregate statistics on AI usage
 */
async function getAuditSummary(shopId) {
  const summary = await db.getAsync(
    `SELECT 
       COUNT(*) as total_interactions,
       COALESCE(SUM(tokens_used), 0) as total_tokens,
       COALESCE(SUM(CASE WHEN requires_confirmation = 1 THEN 1 ELSE 0 END), 0) as safety_gated_actions,
       COALESCE(SUM(CASE WHEN confirmation_status = 'CONFIRMED' THEN 1 ELSE 0 END), 0) as confirmed_actions,
       COALESCE(SUM(CASE WHEN confirmation_status = 'CANCELLED' THEN 1 ELSE 0 END), 0) as cancelled_actions,
       COALESCE(ROUND(AVG(latency_ms), 1), 0) as avg_latency_ms
     FROM ai_action_logs
     WHERE shop_id = ?`,
    [shopId]
  );

  return summary || {
    total_interactions: 0,
    total_tokens: 0,
    safety_gated_actions: 0,
    confirmed_actions: 0,
    cancelled_actions: 0,
    avg_latency_ms: 0
  };
}

module.exports = {
  logAiAction,
  updateConfirmationStatus,
  getAuditLogs,
  getAuditLogById,
  getAuditSummary
};

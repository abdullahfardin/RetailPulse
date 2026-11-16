const { initDatabase, db } = require('../src/config/database');
const aiAuditLogger = require('../src/services/aiAuditLogger');
const agentController = require('../src/controllers/agentController');

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    }
  };
}

async function runAiLogsTestSuite() {
  console.log('=== Running AI Action & Audit Logging Unit Tests (Task T-1.4) ===');
  await initDatabase();

  let passed = 0;
  let total = 0;

  function assert(testName, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] ${testName}`);
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
    }
  }

  const shopId = 1;
  const otherShopId = 2;
  const userId = 1;

  // 1. Schema check: ai_action_logs table exists
  const tableCheck = await db.getAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_action_logs'"
  );
  assert(
    '1. ai_action_logs relational table exists in SQLite database',
    tableCheck !== undefined && tableCheck.name === 'ai_action_logs',
    JSON.stringify(tableCheck)
  );

  // 2. Direct log creation
  const logEntry = await aiAuditLogger.logAiAction({
    shopId,
    userId,
    sessionId: 'sess-unit-test-1',
    userPrompt: 'What are today sales?',
    modelResponse: 'Total sales are ৳1,500 across 8 orders.',
    tokensUsed: 45,
    latencyMs: 120
  });

  assert(
    '2. logAiAction writes user prompt, model response, and latency to database',
    logEntry !== null && typeof logEntry.id === 'number' && logEntry.user_prompt === 'What are today sales?',
    JSON.stringify(logEntry)
  );

  // 3. Tool call serialization check
  const toolLog = await aiAuditLogger.logAiAction({
    shopId,
    userId,
    sessionId: 'sess-unit-test-2',
    userPrompt: 'Check stock of BEV-001',
    modelResponse: 'Coca-Cola has 48 bottles in stock.',
    toolsCalled: [{ name: 'checkStock', args: { identifier: 'BEV-001' } }],
    toolResults: [{ found: true, sku: 'BEV-001', stock_quantity: 48 }],
    tokensUsed: 60,
    latencyMs: 250
  });

  const toolRow = await db.getAsync('SELECT * FROM ai_action_logs WHERE id = ?', [toolLog.id]);
  assert(
    '3. Tools called and results are serialized as JSON strings in database',
    typeof toolRow.tools_called === 'string' && toolRow.tools_called.includes('checkStock') &&
    typeof toolRow.tool_results === 'string' && toolRow.tool_results.includes('48'),
    JSON.stringify(toolRow)
  );

  // 4. Safety gate confirmation logging
  const safetyToken = 'CONF-99AABBCC';
  const safetyLog = await aiAuditLogger.logAiAction({
    shopId,
    userId,
    sessionId: 'sess-unit-test-3',
    userPrompt: 'Delete product BEV-001',
    modelResponse: 'Permanent deletion requires explicit confirmation.',
    requiresConfirmation: 1,
    confirmationToken: safetyToken,
    confirmationStatus: 'PENDING',
    tokensUsed: 80,
    latencyMs: 180
  });

  const safetyRow = await db.getAsync('SELECT * FROM ai_action_logs WHERE id = ?', [safetyLog.id]);
  assert(
    '4. Explicit confirmation safety gate sets requires_confirmation=1 and confirmation_status=PENDING',
    safetyRow.requires_confirmation === 1 && safetyRow.confirmation_token === safetyToken && safetyRow.confirmation_status === 'PENDING',
    JSON.stringify(safetyRow)
  );

  // 5. Update confirmation status to CONFIRMED
  const updateRes1 = await aiAuditLogger.updateConfirmationStatus(safetyToken, 'CONFIRMED');
  const confirmedRow = await db.getAsync('SELECT confirmation_status FROM ai_action_logs WHERE id = ?', [safetyLog.id]);
  assert(
    '5. updateConfirmationStatus marks token as CONFIRMED upon execution',
    updateRes1 === true && confirmedRow.confirmation_status === 'CONFIRMED',
    JSON.stringify(confirmedRow)
  );

  // 6. Update confirmation status to CANCELLED
  const cancelToken = 'CONF-11223344';
  const cancelLog = await aiAuditLogger.logAiAction({
    shopId,
    userId,
    userPrompt: 'Deduct 50 items',
    requiresConfirmation: 1,
    confirmationToken: cancelToken,
    confirmationStatus: 'PENDING'
  });
  await aiAuditLogger.updateConfirmationStatus(cancelToken, 'CANCELLED');
  const cancelledRow = await db.getAsync('SELECT confirmation_status FROM ai_action_logs WHERE id = ?', [cancelLog.id]);
  assert(
    '6. updateConfirmationStatus marks token as CANCELLED upon rejection',
    cancelledRow.confirmation_status === 'CANCELLED',
    JSON.stringify(cancelledRow)
  );

  // 7. Multi-tenant isolation: Shop 2 log creation
  let shop2 = await db.getAsync('SELECT id FROM shops WHERE id = ?', [otherShopId]);
  if (!shop2) {
    await db.runAsync("INSERT INTO shops (id, name, currency) VALUES (?, 'Shop 2 Test', 'BDT')", [otherShopId]);
  }

  const shop2Log = await aiAuditLogger.logAiAction({
    shopId: otherShopId,
    userId: null,
    userPrompt: 'Shop 2 secret prompt',
    modelResponse: 'Shop 2 private answer'
  });

  const shop1Logs = await aiAuditLogger.getAuditLogs(shopId, { limit: 100 });
  const containsShop2 = shop1Logs.logs.some(l => l.shop_id === otherShopId || l.user_prompt === 'Shop 2 secret prompt');
  assert(
    '7. Multi-tenant isolation strictly blocks cross-shop log leakage',
    containsShop2 === false && shop1Logs.total >= 4,
    `Leak detected: ${containsShop2}, Shop 1 Total: ${shop1Logs.total}`
  );

  // 8. Filter by status in getAuditLogs
  const filteredLogs = await aiAuditLogger.getAuditLogs(shopId, { status: 'CONFIRMED' });
  const allMatchStatus = filteredLogs.logs.every(l => l.confirmation_status === 'CONFIRMED');
  assert(
    '8. getAuditLogs filters accurately by confirmation status',
    filteredLogs.count >= 1 && allMatchStatus === true,
    JSON.stringify(filteredLogs)
  );

  // 9. getAuditLogById with parsed JSON
  const singleLog = await aiAuditLogger.getAuditLogById(toolLog.id, shopId);
  assert(
    '9. getAuditLogById parses tools_called and tool_results into JSON objects',
    singleLog !== null && Array.isArray(singleLog.tools_called) && singleLog.tools_called[0].name === 'checkStock',
    JSON.stringify(singleLog)
  );

  // 10. getAuditSummary aggregates metrics
  const summary = await aiAuditLogger.getAuditSummary(shopId);
  assert(
    '10. getAuditSummary computes interactions, total tokens, and average latency',
    summary.total_interactions >= 4 && summary.total_tokens > 0 && typeof summary.avg_latency_ms === 'number',
    JSON.stringify(summary)
  );

  // 11. Controller GET /api/agent/logs endpoint
  const reqControllerLogs = {
    user: { id: userId, shop_id: shopId },
    query: { limit: 10, offset: 0 }
  };
  const resControllerLogs = createMockRes();
  await agentController.getAgentLogs(reqControllerLogs, resControllerLogs);
  assert(
    '11. getAgentLogs controller endpoint returns HTTP 200 with paginated array',
    resControllerLogs.statusCode === 200 && resControllerLogs.data.success === true && Array.isArray(resControllerLogs.data.logs),
    JSON.stringify(resControllerLogs.data)
  );

  // 12. Controller GET /api/agent/logs/:id endpoint
  const reqSingle = {
    user: { id: userId, shop_id: shopId },
    params: { id: logEntry.id }
  };
  const resSingle = createMockRes();
  await agentController.getAgentLogDetails(reqSingle, resSingle);
  assert(
    '12. getAgentLogDetails controller endpoint returns HTTP 200 with log record',
    resSingle.statusCode === 200 && resSingle.data.success === true && resSingle.data.log.id === logEntry.id,
    JSON.stringify(resSingle.data)
  );

  // 13. Controller GET /api/agent/analytics endpoint
  const reqAnalytics = {
    user: { id: userId, shop_id: shopId }
  };
  const resAnalytics = createMockRes();
  await agentController.getAgentAnalytics(reqAnalytics, resAnalytics);
  assert(
    '13. getAgentAnalytics controller endpoint returns aggregated usage KPIs',
    resAnalytics.statusCode === 200 && resAnalytics.data.success === true && resAnalytics.data.summary.total_interactions >= 4,
    JSON.stringify(resAnalytics.data)
  );

  // 14. Conversational Chat E2E: processChat automatically logs interaction
  const reqE2E = {
    user: { id: userId, shop_id: shopId, name: 'Abdullah' },
    body: { message: 'What is the stock of Cola?', session_id: 'e2e-session-1' }
  };
  const resE2E = createMockRes();
  await agentController.processChat(reqE2E, resE2E);

  const e2eLogged = await db.getAsync(
    "SELECT * FROM ai_action_logs WHERE session_id = 'e2e-session-1' ORDER BY id DESC LIMIT 1"
  );
  assert(
    '14. processChat automatically records interaction in ai_action_logs with latency',
    e2eLogged !== undefined && e2eLogged.user_prompt === 'What is the stock of Cola?' && typeof e2eLogged.latency_ms === 'number',
    JSON.stringify(e2eLogged)
  );

  // Cleanup test entries created for Shop 2
  await db.runAsync('DELETE FROM ai_action_logs WHERE shop_id = ?', [otherShopId]);

  console.log('\n===============================================================');
  if (passed === total) {
    console.log(` ALL ${passed}/${total} AI ACTION & AUDIT LOG TESTS PASSED (100%)!`);
    console.log(' Abdullah Al Junaed Akond - Task T-1.4 Complete and Verified.');
  } else {
    console.error(` TEST SUITE FAILED: ${passed}/${total} passed.`);
  }
  console.log('===============================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runAiLogsTestSuite().catch(err => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});

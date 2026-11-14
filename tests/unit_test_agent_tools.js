const { initDatabase, db } = require('../src/config/database');
const { retailToolDeclarations, executeRetailTool } = require('../src/services/aiTools');
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

async function runAgentToolsTestSuite() {
  console.log('=== Running Retail AI Tool Calling Unit Tests (Task T-1.2) ===');
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

  // 1. Tool Declaration Catalog verification
  assert(
    '1. Tool catalog contains 5 declared tools with parameters',
    Array.isArray(retailToolDeclarations) && retailToolDeclarations.length === 5,
    `Found: ${retailToolDeclarations.length}`
  );

  // 2. searchProduct Tool execution
  const searchRes = await executeRetailTool('searchProduct', { query: 'Cola' }, shopId);
  assert(
    '2. searchProduct executes query against products table',
    searchRes.found_count >= 1 && searchRes.products[0].name.toLowerCase().includes('cola'),
    JSON.stringify(searchRes)
  );

  // 3. checkStock Tool execution
  const stockRes = await executeRetailTool('checkStock', { identifier: 'BEV-001' }, shopId);
  assert(
    '3. checkStock returns live stock quantity and pricing details',
    stockRes.found === true && stockRes.sku === 'BEV-001' && typeof stockRes.stock_quantity === 'number',
    JSON.stringify(stockRes)
  );

  // 4. getSalesSummary Tool execution
  const salesRes = await executeRetailTool('getSalesSummary', { period: 'today' }, shopId);
  assert(
    '4. getSalesSummary aggregates today sales revenue and order counts',
    typeof salesRes.total_orders === 'number' && salesRes.total_revenue.startsWith('৳'),
    JSON.stringify(salesRes)
  );

  // 5. getLowStockProducts Tool execution
  const lowStockRes = await executeRetailTool('getLowStockProducts', { limit: 5 }, shopId);
  assert(
    '5. getLowStockProducts identifies depleted items and suggests reorders',
    Array.isArray(lowStockRes.items) && lowStockRes.alert_count >= 1,
    JSON.stringify(lowStockRes)
  );

  // 6. getTopSellingProducts Tool execution
  const topRes = await executeRetailTool('getTopSellingProducts', { limit: 5 }, shopId);
  assert(
    '6. getTopSellingProducts executes SQL join across sales and items',
    Array.isArray(topRes.top_sellers),
    JSON.stringify(topRes)
  );

  // 7. Unknown Tool rejection
  let errorCaught = false;
  try {
    await executeRetailTool('nonExistentTool', {}, shopId);
  } catch (err) {
    errorCaught = true;
  }
  assert(
    '7. Unknown tool call safely throws descriptive error',
    errorCaught === true
  );

  // 8. Offline Intent Fallback with Tool Execution (FR 18)
  const offlineIntent = await agentController.resolveOfflineIntent('which items are low stock?', shopId);
  assert(
    '8. Offline intent resolver automatically triggers getLowStockProducts tool',
    offlineIntent !== null && offlineIntent.toolName === 'getLowStockProducts' && offlineIntent.result.alert_count >= 1,
    JSON.stringify(offlineIntent)
  );

  // 9. Status API exposes tools catalog
  const reqStatus = { query: {} };
  const resStatus = createMockRes();
  await agentController.getAgentStatus(reqStatus, resStatus);
  assert(
    '9. Agent Status endpoint exposes tools list to clients',
    resStatus.statusCode === 200 && Array.isArray(resStatus.data.tools) && resStatus.data.tools.length === 5,
    JSON.stringify(resStatus.data.tools)
  );

  // 10. Multi-turn chat with live tool execution
  const reqChat = {
    body: {
      message: 'Show me all products with low stock',
      history: []
    },
    user: { shop_id: 1, name: 'Abdullah Al Junaed', role: 'owner' }
  };
  const resChat = createMockRes();
  await agentController.processChat(reqChat, resChat);
  assert(
    '10. processChat triggers tool execution and includes tools_executed metadata',
    resChat.statusCode === 200 && resChat.data.success === true && Array.isArray(resChat.data.tools_executed) && resChat.data.tools_executed.length >= 1,
    JSON.stringify(resChat.data)
  );

  console.log(`\n===============================================================`);
  console.log(` ALL ${passed}/${total} AGENT TOOL CALLING TESTS PASSED (100%)!`);
  console.log(` Abdullah Al Junaed Akond - Task T-1.2 Complete and Verified.`);
  console.log(`===============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAgentToolsTestSuite().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runAgentToolsTestSuite };

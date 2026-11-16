const { initDatabase, db } = require('../src/config/database');
const confirmationManager = require('../src/services/confirmationManager');
const agentController = require('../src/controllers/agentController');
const { executeRetailTool } = require('../src/services/aiTools');

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

async function runConfirmationTestSuite() {
  console.log('=== Running Explicit Confirmation Protocol Unit Tests (Task T-1.3) ===');
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

  // 1. Token generation format and metadata
  const pending1 = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'deleteProduct',
    { productId: 999, sku: 'TEST-DEL-1' },
    'Delete test item'
  );
  assert(
    '1. createPendingConfirmation generates CONF- token with 5-minute TTL',
    typeof pending1.token === 'string' &&
    /^CONF-[A-F0-9]{8}$/.test(pending1.token) &&
    pending1.expires_in_seconds === 300,
    JSON.stringify(pending1)
  );

  // 2. Token retrieval for valid shop
  const fetched = confirmationManager.getPendingConfirmation(pending1.token, shopId);
  assert(
    '2. getPendingConfirmation retrieves valid confirmation entry',
    fetched !== null && fetched.token === pending1.token && fetched.action === 'deleteProduct',
    JSON.stringify(fetched)
  );

  // 3. Multi-tenant security isolation
  const crossTenantCheck = confirmationManager.getPendingConfirmation(pending1.token, otherShopId);
  assert(
    '3. Cross-tenant access is blocked (Shop 2 cannot read Shop 1 token)',
    crossTenantCheck === null,
    `Expected null, got: ${JSON.stringify(crossTenantCheck)}`
  );

  // 4. Token expiration TTL
  const expiredPending = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'updateStock',
    { productId: 1, quantity: 5 },
    'Expired test'
  );
  const entry = confirmationManager._pendingConfirmations.get(expiredPending.token);
  entry.expires_at = Date.now() - 1000; // Force expired
  const expiredCheck = confirmationManager.getPendingConfirmation(expiredPending.token, shopId);
  assert(
    '4. Expired token is purged and returns null',
    expiredCheck === null,
    `Expected null, got: ${JSON.stringify(expiredCheck)}`
  );

  // 5. Explicit cancellation
  const toCancel = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'deleteProduct',
    { productId: 1 },
    'To be cancelled'
  );
  const cancelResult = confirmationManager.cancelPendingConfirmation(toCancel.token, shopId);
  const afterCancel = confirmationManager.getPendingConfirmation(toCancel.token, shopId);
  assert(
    '5. cancelPendingConfirmation safely removes token',
    cancelResult === true && afterCancel === null,
    `Cancel: ${cancelResult}, After: ${afterCancel}`
  );

  // 6. Execute confirmed deleteProduct with ACID transaction and anti-replay
  await db.runAsync(
    `INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold)
     VALUES (?, 'TEST-CONF-DEL', 'Confirm Delete Product', 'Beverages', 20, 30, 10, 5)`,
    [shopId]
  );
  const createdProd = await db.getAsync("SELECT * FROM products WHERE sku = 'TEST-CONF-DEL' AND shop_id = ?", [shopId]);

  const delConfirmation = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'deleteProduct',
    { productId: createdProd.id, sku: createdProd.sku },
    `Permanently delete ${createdProd.name}`
  );

  const delExecResult = await confirmationManager.executeConfirmedAction(delConfirmation.token, shopId, userId);
  const prodAfterDel = await db.getAsync("SELECT * FROM products WHERE id = ? AND shop_id = ?", [createdProd.id, shopId]);
  
  // Anti-replay check
  let replayBlocked = false;
  try {
    await confirmationManager.executeConfirmedAction(delConfirmation.token, shopId, userId);
  } catch (e) {
    replayBlocked = true;
  }

  assert(
    '6. executeConfirmedAction (deleteProduct) removes row and enforces anti-replay',
    delExecResult.action === 'deleteProduct' && prodAfterDel === undefined && replayBlocked === true,
    `Result: ${JSON.stringify(delExecResult)}, Found: ${prodAfterDel}, ReplayBlocked: ${replayBlocked}`
  );

  // 7. Execute confirmed updateStock (RESTOCK) with audit log
  await db.runAsync(
    `INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold)
     VALUES (?, 'TEST-CONF-STOCK', 'Confirm Stock Product', 'Beverages', 50, 75, 20, 5)`,
    [shopId]
  );
  const stockProd = await db.getAsync("SELECT * FROM products WHERE sku = 'TEST-CONF-STOCK' AND shop_id = ?", [shopId]);

  const restockConf = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'updateStock',
    { productId: stockProd.id, sku: stockProd.sku, actionType: 'ADD', quantity: 15, reason: 'Test Restock' },
    'Restock 15 units'
  );
  const restockRes = await confirmationManager.executeConfirmedAction(restockConf.token, shopId, userId);
  const stockAfterAdd = await db.getAsync("SELECT stock_quantity FROM products WHERE id = ?", [stockProd.id]);
  const logAdd = await db.getAsync("SELECT * FROM inventory_logs WHERE product_id = ? AND change_type = 'ADD' ORDER BY id DESC LIMIT 1", [stockProd.id]);

  assert(
    '7. executeConfirmedAction (updateStock RESTOCK) updates quantity and creates inventory_log',
    stockAfterAdd.stock_quantity === 35 && logAdd !== undefined && logAdd.quantity_change === 15,
    `New stock: ${stockAfterAdd?.stock_quantity}, Log: ${JSON.stringify(logAdd)}`
  );

  // 8. Execute confirmed updateStock (DEDUCT)
  const deductConf = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'updateStock',
    { productId: stockProd.id, sku: stockProd.sku, actionType: 'DEDUCT', quantity: 10, reason: 'Damaged bottles' },
    'Deduct 10 units'
  );
  const deductRes = await confirmationManager.executeConfirmedAction(deductConf.token, shopId, userId);
  const stockAfterDeduct = await db.getAsync("SELECT stock_quantity FROM products WHERE id = ?", [stockProd.id]);
  const logDeduct = await db.getAsync("SELECT * FROM inventory_logs WHERE product_id = ? AND change_type = 'DEDUCT' ORDER BY id DESC LIMIT 1", [stockProd.id]);

  assert(
    '8. executeConfirmedAction (updateStock DEDUCT) decrements quantity and writes audit trail',
    stockAfterDeduct.stock_quantity === 25 && logDeduct !== undefined && logDeduct.quantity_change === -10,
    `New stock: ${stockAfterDeduct?.stock_quantity}, Log: ${JSON.stringify(logDeduct)}`
  );

  // 9. Negative stock guard on DEDUCT
  const excessiveDeductConf = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'updateStock',
    { productId: stockProd.id, sku: stockProd.sku, actionType: 'DEDUCT', quantity: 9999, reason: 'Too much' },
    'Excessive deduct'
  );
  let deductPrevented = false;
  try {
    await confirmationManager.executeConfirmedAction(excessiveDeductConf.token, shopId, userId);
  } catch (err) {
    deductPrevented = err.message.includes('Only 25 units currently available');
  }
  assert(
    '9. DEDUCT action strictly blocks negative inventory',
    deductPrevented === true,
    `Failed to block over-deduction`
  );

  // 10. Dedicated POST /api/agent/confirm controller endpoint
  const testTokenApi = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'updateStock',
    { productId: stockProd.id, sku: stockProd.sku, actionType: 'ADD', quantity: 5 },
    'API confirm test'
  );

  const reqConfirm = {
    user: { id: userId, shop_id: shopId },
    body: { token: testTokenApi.token, confirm: true }
  };
  const resConfirm = createMockRes();
  await agentController.confirmAction(reqConfirm, resConfirm);

  assert(
    '10. confirmAction controller endpoint approves and executes pending token',
    resConfirm.statusCode === 200 && resConfirm.data.success && resConfirm.data.status === 'EXECUTED',
    JSON.stringify(resConfirm.data)
  );

  // 11. Dedicated POST /api/agent/confirm rejection flow
  const testRejectApi = confirmationManager.createPendingConfirmation(
    shopId,
    userId,
    'deleteProduct',
    { productId: stockProd.id, sku: stockProd.sku },
    'API reject test'
  );

  const reqReject = {
    user: { id: userId, shop_id: shopId },
    body: { token: testRejectApi.token, confirm: false }
  };
  const resReject = createMockRes();
  await agentController.confirmAction(reqReject, resReject);

  assert(
    '11. confirmAction controller endpoint cancels token when confirm is false',
    resReject.statusCode === 200 && resReject.data.status === 'CANCELLED',
    JSON.stringify(resReject.data)
  );

  // 12. List pending confirmations endpoint
  const reqList = { user: { id: userId, shop_id: shopId } };
  const resList = createMockRes();
  confirmationManager.createPendingConfirmation(shopId, userId, 'updateStock', { productId: stockProd.id, quantity: 1 }, 'Pending 1');
  confirmationManager.createPendingConfirmation(shopId, userId, 'updateStock', { productId: stockProd.id, quantity: 2 }, 'Pending 2');
  await agentController.listConfirmations(reqList, resList);

  assert(
    '12. listConfirmations returns active confirmation entries for current shop',
    resList.statusCode === 200 && resList.data.count >= 2 && Array.isArray(resList.data.confirmations),
    JSON.stringify(resList.data)
  );

  // 13. Conversational Chat safety gate trigger (Offline Intent Fallback)
  const reqChat = {
    user: { id: userId, shop_id: shopId, name: 'Abdullah' },
    body: { message: `delete product ${stockProd.sku}` }
  };
  const resChat = createMockRes();
  await agentController.processChat(reqChat, resChat);

  assert(
    '13. processChat automatically flags sensitive intent with requires_confirmation: true',
    resChat.data.success && resChat.data.requires_confirmation === true && typeof resChat.data.confirmation?.token === 'string',
    JSON.stringify(resChat.data)
  );

  // 14. Conversational Chat direct in-chat confirmation execution
  const tokenToChatConfirm = resChat.data.confirmation.token;
  const reqChatConfirm = {
    user: { id: userId, shop_id: shopId, name: 'Abdullah' },
    body: { message: `confirm ${tokenToChatConfirm}` }
  };
  const resChatConfirm = createMockRes();
  await agentController.processChat(reqChatConfirm, resChatConfirm);

  assert(
    '14. processChat executes confirmed action when user replies "confirm <token>"',
    resChatConfirm.data.success && resChatConfirm.data.status === 'EXECUTED' && resChatConfirm.data.action_executed !== undefined,
    JSON.stringify(resChatConfirm.data)
  );

  // Clean up any remaining test products
  await db.runAsync("DELETE FROM products WHERE sku LIKE 'TEST-%' AND shop_id = ?", [shopId]);

  console.log('\n===============================================================');
  if (passed === total) {
    console.log(` ALL ${passed}/${total} EXPLICIT CONFIRMATION TESTS PASSED (100%)!`);
    console.log(' Abdullah Al Junaed Akond - Task T-1.3 Complete and Verified.');
  } else {
    console.error(` TEST SUITE FAILED: ${passed}/${total} passed.`);
  }
  console.log('===============================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runConfirmationTestSuite().catch(err => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});

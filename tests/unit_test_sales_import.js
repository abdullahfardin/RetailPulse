const { initDatabase, db } = require('../src/config/database');
const importController = require('../src/controllers/importController');

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

async function runSalesImportTestSuite() {
  console.log('=== Running Historical Sales Batch Import Tests (Task T-2.3) ===');
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
  const userId = 1;

  // Ensure test products exist
  await db.runAsync(
    `INSERT OR IGNORE INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
     VALUES (?, 'TEST-SALES-1', 'Test Cola 500ml', 'Beverages', 30.0, 40.0, 50, 10, 'bottle')`,
    [shopId]
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
     VALUES (?, 'TEST-SALES-2', 'Test Chips 40g', 'Snacks', 15.0, 20.0, 40, 10, 'pack')`,
    [shopId]
  );

  const prod1 = await db.getAsync("SELECT * FROM products WHERE sku = 'TEST-SALES-1' AND shop_id = ?", [shopId]);
  const prod2 = await db.getAsync("SELECT * FROM products WHERE sku = 'TEST-SALES-2' AND shop_id = ?", [shopId]);

  // 1. Rejection of empty request body
  const reqEmpty = { user: { id: userId, shop_id: shopId }, body: {} };
  const resEmpty = createMockRes();
  await importController.bulkImportSales(reqEmpty, resEmpty);
  assert(
    '1. Empty request body rejected with HTTP 400',
    resEmpty.statusCode === 400 && resEmpty.data.success === false,
    JSON.stringify(resEmpty.data)
  );

  // 2. CSV validation error rejection (malformed date)
  const invalidCsv = [
    'date,sku,quantity,unit_price',
    'not-a-date,TEST-SALES-1,5,40.0'
  ].join('\n');
  const reqInvalid = { user: { id: userId, shop_id: shopId }, body: { csv_data: invalidCsv } };
  const resInvalid = createMockRes();
  await importController.bulkImportSales(reqInvalid, resInvalid);
  assert(
    '2. Malformed CSV rejected with validation_errors array',
    resInvalid.statusCode === 400 && Array.isArray(resInvalid.data.validation_errors),
    JSON.stringify(resInvalid.data)
  );

  // 3. Rejection of unknown SKU (referential catalog integrity)
  const unknownSkuCsv = [
    'date,sku,quantity,unit_price',
    '2026-10-15,NON-EXISTENT-SKU,2,100.0'
  ].join('\n');
  const reqMissingSku = { user: { id: userId, shop_id: shopId }, body: { csv_data: unknownSkuCsv } };
  const resMissingSku = createMockRes();
  await importController.bulkImportSales(reqMissingSku, resMissingSku);
  assert(
    '3. Non-existent SKU rejected with missing_skus list and HTTP 400',
    resMissingSku.statusCode === 400 && resMissingSku.data.missing_skus.includes('NON-EXISTENT-SKU'),
    JSON.stringify(resMissingSku.data)
  );

  // 4. Successful batch import of historical sales CSV
  const validCsv = [
    'date,sku,quantity,unit_price,payment_method,customer_name',
    '2026-10-01,TEST-SALES-1,3,40.0,cash,Rahim Uddin',
    '2026-10-02,TEST-SALES-2,5,20.0,bkash,Karim Sheikh',
    '2026-10-03,TEST-SALES-1,2,40.0,card,Nasreen Akhter'
  ].join('\n');

  const reqValid = { user: { id: userId, shop_id: shopId }, body: { csv_data: validCsv } };
  const resValid = createMockRes();
  await importController.bulkImportSales(reqValid, resValid);

  assert(
    '4. Clean historical sales CSV imported with HTTP 201',
    resValid.statusCode === 201 && resValid.data.total_orders === 3 && resValid.data.total_items === 3,
    JSON.stringify(resValid.data)
  );

  // 5. Multi-item order grouping using shared invoice_number
  const multiItemCsv = [
    'invoice_number,date,sku,quantity,unit_price,payment_method,customer_name',
    'INV-HIST-M1,2026-10-05,TEST-SALES-1,2,40.0,cash,Sultana Begum',
    'INV-HIST-M1,2026-10-05,TEST-SALES-2,4,20.0,cash,Sultana Begum'
  ].join('\n');

  const reqMulti = { user: { id: userId, shop_id: shopId }, body: { csv_data: multiItemCsv } };
  const resMulti = createMockRes();
  await importController.bulkImportSales(reqMulti, resMulti);

  const groupedSale = await db.getAsync("SELECT * FROM sales WHERE invoice_number = 'INV-HIST-M1' AND shop_id = ?", [shopId]);
  const groupedItems = await db.allAsync('SELECT * FROM sale_items WHERE sale_id = ?', [groupedSale?.id]);

  assert(
    '5. Rows sharing invoice_number grouped into 1 order with 2 line items',
    resMulti.statusCode === 201 && groupedSale !== undefined && groupedSale.total_amount === 160 && groupedItems.length === 2,
    `Sale: ${JSON.stringify(groupedSale)}, Items: ${groupedItems.length}`
  );

  // 6. Verification of date and revenue calculation in sales table
  assert(
    '6. Historical date and grand total correctly persisted in sales record',
    groupedSale && groupedSale.created_at.startsWith('2026-10-05') && groupedSale.subtotal === 160,
    JSON.stringify(groupedSale)
  );

  // 7. Default behavior: on-hand physical stock is NOT deducted
  const prod1After = await db.getAsync('SELECT stock_quantity FROM products WHERE id = ?', [prod1.id]);
  assert(
    '7. Default historical import preserves current physical inventory levels (deduct_stock=false)',
    prod1After.stock_quantity === 50,
    `Stock was: ${prod1After.stock_quantity}, Expected: 50`
  );

  // 8. Optional deduct_stock: true deducts inventory and writes audit logs
  const deductCsv = [
    'invoice_number,date,sku,quantity,unit_price,payment_method,customer_name',
    'INV-HIST-DED-1,2026-10-08,TEST-SALES-1,5,40.0,cash,Test Customer'
  ].join('\n');

  const reqDeduct = {
    user: { id: userId, shop_id: shopId },
    body: { csv_data: deductCsv, options: { deduct_stock: true } }
  };
  const resDeduct = createMockRes();
  await importController.bulkImportSales(reqDeduct, resDeduct);

  const prod1Deducted = await db.getAsync('SELECT stock_quantity FROM products WHERE id = ?', [prod1.id]);
  const deductLog = await db.getAsync(
    "SELECT * FROM inventory_logs WHERE product_id = ? AND change_type = 'SALE' ORDER BY id DESC LIMIT 1",
    [prod1.id]
  );

  assert(
    '8. Optional deduct_stock: true decrements stock and writes inventory_log',
    resDeduct.statusCode === 201 && prod1Deducted.stock_quantity === 45 && deductLog !== undefined && deductLog.quantity_change === -5,
    `New Stock: ${prod1Deducted.stock_quantity}, Log: ${JSON.stringify(deductLog)}`
  );

  // 9. Multi-tenant isolation: Shop 2 cannot view Shop 1 sales
  const otherShopSales = await db.allAsync('SELECT * FROM sales WHERE shop_id = 2');
  const leakedSale = otherShopSales.find(s => s.invoice_number === 'INV-HIST-M1');
  assert(
    '9. Multi-tenant isolation strictly hides imported sales from Shop 2',
    leakedSale === undefined,
    `Found leaked sale: ${JSON.stringify(leakedSale)}`
  );

  // Clean up test data
  await db.runAsync("DELETE FROM sales WHERE invoice_number LIKE 'INV-HIST%' AND shop_id = ?", [shopId]);
  await db.runAsync("DELETE FROM products WHERE sku LIKE 'TEST-SALES%' AND shop_id = ?", [shopId]);

  console.log('\n===============================================================');
  if (passed === total) {
    console.log(` ALL ${passed}/${total} HISTORICAL SALES IMPORT TESTS PASSED (100%)!`);
    console.log(' Nazrin Sultana Omi - Task T-2.3 Complete and Verified.');
  } else {
    console.error(` TEST SUITE FAILED: ${passed}/${total} passed.`);
  }
  console.log('===============================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runSalesImportTestSuite().catch(err => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});

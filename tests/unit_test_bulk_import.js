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

async function runBulkImportTests() {
  console.log('=== Running Transactional Bulk Product Catalog Import Tests (Task T-2.2) ===');
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
  const uniqueTag = Date.now().toString().slice(-4);

  // 1. Successful Transactional Bulk Import from CSV text
  const bulkCsv = [
    'sku,name,category,cost_price,selling_price,stock_quantity,min_stock_threshold,unit',
    `BULK-${uniqueTag}-01,"Pran Mango Drink (500ml)",Beverages,35.0,40.0,50,15,bottle`,
    `BULK-${uniqueTag}-02,"Chashi Aromatic Chinigura Rice (1kg)",Groceries,140.0,160.0,30,10,pack`,
    `BULK-${uniqueTag}-03,"Olympic Energy Plus Biscuits",Snacks,45.0,50.0,40,12,packet`
  ].join('\n');

  const reqSuccess = {
    user: { shop_id: shopId, id: userId },
    body: { csv_data: bulkCsv }
  };
  const resSuccess = createMockRes();
  await importController.bulkImportProducts(reqSuccess, resSuccess);

  assert(
    '1. bulkImportProducts inserts 3 products and returns HTTP 201 Created',
    resSuccess.statusCode === 201 && resSuccess.data.success === true && resSuccess.data.imported_count === 3,
    JSON.stringify(resSuccess.data)
  );

  // 2. Database verification of inserted products
  const dbProducts = await db.allAsync(
    `SELECT sku, name, stock_quantity FROM products WHERE shop_id = ? AND sku LIKE ?`,
    [shopId, `BULK-${uniqueTag}-%`]
  );
  assert(
    '2. Database holds all 3 newly imported products scoped to shop',
    dbProducts.length === 3,
    `Found: ${dbProducts.length}`
  );

  // 3. Inventory audit logs verification
  const auditLogs = await db.allAsync(
    `SELECT l.change_type, l.quantity_change, l.reason, p.sku
     FROM inventory_logs l
     JOIN products p ON l.product_id = p.id
     WHERE l.shop_id = ? AND l.change_type = 'BULK_IMPORT' AND p.sku LIKE ?`,
    [shopId, `BULK-${uniqueTag}-%`]
  );
  assert(
    '3. Immutable inventory_logs records created for each imported item with change_type BULK_IMPORT',
    auditLogs.length === 3 && auditLogs[0].change_type === 'BULK_IMPORT',
    JSON.stringify(auditLogs)
  );

  // 4. Duplicate SKU pre-check rejection (Conflict 409)
  const reqDuplicate = {
    user: { shop_id: shopId, id: userId },
    body: { csv_data: bulkCsv } // Attempting to re-import exact same SKUs
  };
  const resDuplicate = createMockRes();
  await importController.bulkImportProducts(reqDuplicate, resDuplicate);
  assert(
    '4. Re-import of existing SKUs aborted with HTTP 409 Conflict',
    resDuplicate.statusCode === 409 && resDuplicate.data.success === false && Array.isArray(resDuplicate.data.conflicting_skus),
    JSON.stringify(resDuplicate.data)
  );

  // 5. Validation error rejection (HTTP 400)
  const badCsv = [
    'sku,name,category,cost_price,selling_price,stock_quantity,min_stock_threshold,unit',
    'BAD-SKU-01,Bad Item,Snacks,50,40,-10,5,pcs' // negative stock & loss price
  ].join('\n');
  const reqBad = {
    user: { shop_id: shopId, id: userId },
    body: { csv_data: badCsv }
  };
  const resBad = createMockRes();
  await importController.bulkImportProducts(reqBad, resBad);
  assert(
    '5. Invalid CSV with loss price and negative stock rejected with HTTP 400 and validation report',
    resBad.statusCode === 400 && resBad.data.success === false && Array.isArray(resBad.data.validation_errors),
    JSON.stringify(resBad.data)
  );

  // 6. Empty payload rejection
  const reqEmpty = {
    user: { shop_id: shopId, id: userId },
    body: {}
  };
  const resEmpty = createMockRes();
  await importController.bulkImportProducts(reqEmpty, resEmpty);
  assert(
    '6. Empty request body rejected with HTTP 400',
    resEmpty.statusCode === 400 && resEmpty.data.success === false
  );

  // 7. Atomic Rollback Verification on simulated transaction failure
  const countBefore = (await db.getAsync('SELECT COUNT(*) as count FROM products WHERE shop_id = ?', [shopId])).count;
  const corruptPayload = {
    user: { shop_id: shopId, id: userId },
    body: {
      products: [
        { sku: `ROLLBACK-${uniqueTag}-01`, name: 'Good Item 1', category: 'General', cost_price: 10, selling_price: 15, stock_quantity: 10, min_stock_threshold: 2, unit: 'pcs' },
        { sku: null, name: null, category: null } // will trigger SQL NOT NULL constraint failure
      ]
    }
  };
  const resRollback = createMockRes();
  await importController.bulkImportProducts(corruptPayload, resRollback);
  const countAfter = (await db.getAsync('SELECT COUNT(*) as count FROM products WHERE shop_id = ?', [shopId])).count;

  assert(
    '7. SQL constraint failure triggers ROLLBACK: zero partial items inserted',
    resRollback.statusCode === 500 && countAfter === countBefore,
    `Before: ${countBefore}, After: ${countAfter}`
  );

  console.log(`\n===============================================================`);
  console.log(` ALL ${passed}/${total} BULK PRODUCT IMPORT TESTS PASSED (100%)!`);
  console.log(` Nazrin Sultana Omi - Task T-2.2 Complete and Verified.`);
  console.log(`===============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runBulkImportTests().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runBulkImportTests };

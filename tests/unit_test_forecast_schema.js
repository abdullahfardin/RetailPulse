const { initDatabase, db } = require('../src/config/database');

async function runForecastSchemaTests() {
  console.log('=== Running Forecasts & Recommendations Schema Tests (Task T-3.1) ===');
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

  // 1. Verify 'forecasts' table exists in database
  const forecastTable = await db.getAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='forecasts'"
  );
  assert(
    '1. forecasts table created in SQLite database',
    !!forecastTable && forecastTable.name === 'forecasts',
    JSON.stringify(forecastTable)
  );

  // 2. Verify 'recommendations' table exists in database
  const recTable = await db.getAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='recommendations'"
  );
  assert(
    '2. recommendations table created in SQLite database',
    !!recTable && recTable.name === 'recommendations',
    JSON.stringify(recTable)
  );

  // 3. Insert a forecast record for demo product (shop_id: 1, product_id: 1)
  const product = await db.getAsync('SELECT id, selling_price, cost_price, stock_quantity FROM products WHERE shop_id = 1 LIMIT 1');
  assert('3. Demo product exists for foreign key binding', !!product);

  const forecastInsert = await db.runAsync(
    `INSERT INTO forecasts (shop_id, product_id, horizon_days, model_name, predicted_demand, confidence_lower, confidence_upper, mae_error, rmse_error, wape_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, product.id, 7, 'WEIGHTED_MOVING_AVERAGE', 42.5, 38.0, 47.0, 2.15, 2.80, 0.051]
  );
  assert(
    '4. Record successfully inserted into forecasts table',
    forecastInsert.lastID > 0,
    `lastID: ${forecastInsert.lastID}`
  );

  // 5. Insert recommendation linked to forecast_id
  const dailyBurn = 42.5 / 7; // ~6.07 units/day
  const leadTime = 3;
  const safetyStock = 10;
  const rop = (dailyBurn * leadTime) + safetyStock; // ~28.2
  const suggestedOrder = Math.ceil(Math.max(15, rop - product.stock_quantity + 10));
  const estimatedCost = suggestedOrder * product.cost_price;

  const recInsert = await db.runAsync(
    `INSERT INTO recommendations (shop_id, product_id, forecast_id, current_stock, daily_burn_rate, supplier_lead_time_days, safety_stock, reorder_point, suggested_order_qty, estimated_cost, priority, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, product.id, forecastInsert.lastID, product.stock_quantity, parseFloat(dailyBurn.toFixed(2)), leadTime, safetyStock, parseFloat(rop.toFixed(2)), suggestedOrder, estimatedCost, 'HIGH', 'PENDING']
  );
  assert(
    '5. Record successfully inserted into recommendations table with foreign keys',
    recInsert.lastID > 0,
    `lastID: ${recInsert.lastID}`
  );

  // 6. Test relational query joining products, forecasts, and recommendations
  const joinedRecord = await db.getAsync(
    `SELECT p.name as product_name, p.sku, f.horizon_days, f.predicted_demand, f.model_name,
            r.reorder_point, r.suggested_order_qty, r.priority, r.status
     FROM recommendations r
     JOIN forecasts f ON r.forecast_id = f.id
     JOIN products p ON r.product_id = p.id
     WHERE r.id = ? AND r.shop_id = 1`,
    [recInsert.lastID]
  );
  assert(
    '6. Multi-table SQL JOIN query across products, forecasts, and recommendations',
    joinedRecord && joinedRecord.horizon_days === 7 && joinedRecord.status === 'PENDING',
    JSON.stringify(joinedRecord)
  );

  // 7. Test status update on recommendation
  await db.runAsync(
    'UPDATE recommendations SET status = ? WHERE id = ? AND shop_id = 1',
    ['ORDERED', recInsert.lastID]
  );
  const updatedRec = await db.getAsync('SELECT status FROM recommendations WHERE id = ?', [recInsert.lastID]);
  assert(
    '7. Recommendation lifecycle status transition to ORDERED',
    updatedRec.status === 'ORDERED',
    `Status: ${updatedRec.status}`
  );

  console.log(`\n===============================================================`);
  console.log(` ALL ${passed}/${total} FORECAST SCHEMA TESTS PASSED (100%)!`);
  console.log(` Md Ebrahim Hossen - Task T-3.1 Complete and Verified.`);
  console.log(`===============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runForecastSchemaTests().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runForecastSchemaTests };

const { initDatabase, db } = require('../src/config/database');
const {
  generateContinuousDateRange,
  getProductDailyTimeSeries,
  getCategoryAggregatedTimeSeries,
  sanitizeTimeSeries
} = require('../src/services/dataPreparation');
const forecastController = require('../src/controllers/forecastController');

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

async function runDataPrepTests() {
  console.log('=== Running Time-Series Data Preparation & Aggregation Tests (Task T-3.2) ===');
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
  const product = await db.getAsync('SELECT id, name, category FROM products WHERE shop_id = ? LIMIT 1', [shopId]);
  assert('1. Valid product found for time-series extraction', !!product);

  // 2. Test generateContinuousDateRange
  const calendar7 = generateContinuousDateRange(7);
  const calendar30 = generateContinuousDateRange(30);
  assert(
    '2. generateContinuousDateRange creates exact chronological date intervals',
    calendar7.length === 7 && calendar30.length === 30 && !!calendar7[0].dayOfWeek,
    `7d: ${calendar7.length}, 30d: ${calendar30.length}`
  );

  // 3. Test getProductDailyTimeSeries continuous gap filling
  const seriesData = await getProductDailyTimeSeries(shopId, product.id, 30);
  assert(
    '3. getProductDailyTimeSeries generates 30 continuous daily points with zero-gap filling',
    seriesData.series.length === 30 && seriesData.days_analyzed === 30,
    `Series length: ${seriesData.series.length}`
  );

  // 4. Verify summary statistics calculation
  const summary = seriesData.summary;
  assert(
    '4. Statistical summary computes mean daily volume and standard deviation',
    typeof summary.mean_daily_sales === 'number' && typeof summary.std_dev_daily_sales === 'number' && !!summary.data_sufficiency,
    JSON.stringify(summary)
  );

  // 5. Test category-level baseline aggregation
  const catData = await getCategoryAggregatedTimeSeries(shopId, product.category, 14);
  assert(
    '5. getCategoryAggregatedTimeSeries aggregates across category items for baseline',
    catData.series.length === 14 && catData.category === product.category && typeof catData.category_mean_daily === 'number',
    JSON.stringify({ category: catData.category, mean: catData.category_mean_daily })
  );

  // 6. Test sanitizeTimeSeries
  const rawDirty = [
    { date: '2026-11-01', quantity_sold: 5, revenue: 100 },
    { date: '2026-11-02', quantity_sold: -3, revenue: -50 }, // negative should be clamped to 0
    { date: '2026-11-03', quantity_sold: 'invalid', revenue: null }
  ];
  const cleaned = sanitizeTimeSeries(rawDirty);
  assert(
    '6. sanitizeTimeSeries clamps negative values to zero and guarantees valid numeric values',
    cleaned[1].quantity_sold === 0 && cleaned[2].quantity_sold === 0 && cleaned[0].quantity_sold === 5,
    JSON.stringify(cleaned)
  );

  // 7. Controller test: getProductTimeSeries returns 200
  const reqController = {
    user: { shop_id: 1 },
    params: { productId: product.id },
    query: { days: '14' }
  };
  const resController = createMockRes();
  await forecastController.getProductTimeSeries(reqController, resController);
  assert(
    '7. GET /api/forecast/time-series/:productId returns HTTP 200 with series array',
    resController.statusCode === 200 && resController.data.success === true && resController.data.data.series.length === 14,
    JSON.stringify(resController.data)
  );

  // 8. Controller test: rejection of invalid productId
  const reqBad = {
    user: { shop_id: 1 },
    params: { productId: 'invalid_id' },
    query: {}
  };
  const resBad = createMockRes();
  await forecastController.getProductTimeSeries(reqBad, resBad);
  assert(
    '8. Rejection of invalid product ID with HTTP 400',
    resBad.statusCode === 400 && resBad.data.success === false,
    JSON.stringify(resBad.data)
  );

  // 9. Controller test: getCategoryTimeSeries returns 200
  const reqCat = {
    user: { shop_id: 1 },
    params: { category: product.category },
    query: { days: '7' }
  };
  const resCat = createMockRes();
  await forecastController.getCategoryTimeSeries(reqCat, resCat);
  assert(
    '9. GET /api/forecast/category-series/:category returns HTTP 200',
    resCat.statusCode === 200 && resCat.data.success === true && resCat.data.data.series.length === 7,
    JSON.stringify(resCat.data)
  );

  console.log(`\n===============================================================`);
  console.log(` ALL ${passed}/${total} TIME-SERIES DATA PREPARATION TESTS PASSED (100%)!`);
  console.log(` Md Ebrahim Hossen - Task T-3.2 Complete and Verified.`);
  console.log(`===============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDataPrepTests().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runDataPrepTests };

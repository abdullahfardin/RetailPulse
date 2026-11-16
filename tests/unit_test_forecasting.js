const { initDatabase, db } = require('../src/config/database');
const forecastingEngine = require('../src/services/forecastingEngine');
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

async function runForecastingTestSuite() {
  console.log('=== Running Demand Forecasting Engine Tests (Task T-3.3) ===');
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

  // Retrieve an existing demo product
  const product = await db.getAsync('SELECT * FROM products WHERE shop_id = ? LIMIT 1', [shopId]);
  assert('0. Valid product exists in store catalog', product !== undefined, `Product: ${JSON.stringify(product)}`);

  // Mock synthetic 14-day time series for pure algorithmic unit tests
  const mockSeries = [
    { date: '2026-11-01', day_of_week: 'Sunday', quantity_sold: 10 },
    { date: '2026-11-02', day_of_week: 'Monday', quantity_sold: 4 },
    { date: '2026-11-03', day_of_week: 'Tuesday', quantity_sold: 6 },
    { date: '2026-11-04', day_of_week: 'Wednesday', quantity_sold: 5 },
    { date: '2026-11-05', day_of_week: 'Thursday', quantity_sold: 7 },
    { date: '2026-11-06', day_of_week: 'Friday', quantity_sold: 15 }, // Friday peak
    { date: '2026-11-07', day_of_week: 'Saturday', quantity_sold: 12 },
    { date: '2026-11-08', day_of_week: 'Sunday', quantity_sold: 11 },
    { date: '2026-11-09', day_of_week: 'Monday', quantity_sold: 5 },
    { date: '2026-11-10', day_of_week: 'Tuesday', quantity_sold: 5 },
    { date: '2026-11-11', day_of_week: 'Wednesday', quantity_sold: 6 },
    { date: '2026-11-12', day_of_week: 'Thursday', quantity_sold: 8 },
    { date: '2026-11-13', day_of_week: 'Friday', quantity_sold: 18 }, // Friday peak
    { date: '2026-11-14', day_of_week: 'Saturday', quantity_sold: 14 }
  ];

  // 1. Simple Moving Average test
  const sma7 = forecastingEngine.predictMovingAverage(mockSeries, 7, 7);
  // Last 7 days sum = 11 + 5 + 5 + 6 + 8 + 18 + 14 = 67. Mean = 67 / 7 = 9.57. Total = 67.
  assert(
    '1. predictMovingAverage calculates 7-day rolling window mean and 7-day horizon',
    sma7.model === 'MOVING_AVERAGE_7' && sma7.daily_projections.length === 7 && sma7.predicted_total > 60,
    JSON.stringify(sma7)
  );

  // 2. Seasonal Naive test (Period M = 7)
  const seasonal = forecastingEngine.predictSeasonalNaive(mockSeries, 7);
  // Should project 7 future days with day-of-week seasonality
  assert(
    '2. predictSeasonalNaive captures weekly day-of-week seasonality',
    seasonal.model === 'SEASONAL_NAIVE_7' && seasonal.daily_projections.length === 7 && seasonal.predicted_total > 0,
    JSON.stringify(seasonal)
  );

  // 3. Ensemble Model test (Blending)
  const ensemble = forecastingEngine.predictEnsemble(mockSeries, 7);
  assert(
    '3. predictEnsemble blends seasonal naive and moving average models',
    ensemble.model === 'ENSEMBLE' && ensemble.weights.seasonal_naive === 0.6 && ensemble.weights.moving_average_7 === 0.4,
    JSON.stringify(ensemble)
  );

  // 4. Confidence intervals calculation
  const ci = forecastingEngine.calculateConfidenceInterval(70, 2.5, 7);
  assert(
    '4. calculateConfidenceInterval returns non-negative lower and upper bounds at 95% confidence',
    ci.lower_bound >= 0 && ci.upper_bound > 70 && ci.margin_of_error > 0,
    JSON.stringify(ci)
  );

  // 5. generateProductForecast with database persistence
  const generated = await forecastingEngine.generateProductForecast(shopId, product.id, {
    horizonDays: 7,
    model: 'AUTO',
    persist: true
  });
  const persistedRow = await db.getAsync('SELECT * FROM forecasts WHERE id = ?', [generated.forecast_id]);

  assert(
    '5. generateProductForecast executes pipeline and persists to forecasts table',
    generated.forecast_id !== null && persistedRow !== undefined && persistedRow.product_id === product.id,
    `Generated: ${JSON.stringify(generated)}, Row: ${JSON.stringify(persistedRow)}`
  );

  // 6. Support for 14-day and 30-day horizons
  const fc14 = await forecastingEngine.generateProductForecast(shopId, product.id, { horizonDays: 14, persist: false });
  const fc30 = await forecastingEngine.generateProductForecast(shopId, product.id, { horizonDays: 30, persist: false });
  assert(
    '6. Flexible horizon projection supports 14-day and 30-day planning horizons',
    fc14.horizon_days === 14 && fc14.daily_projections.length === 14 &&
    fc30.horizon_days === 30 && fc30.daily_projections.length === 30,
    `14: ${fc14.daily_projections.length}, 30: ${fc30.daily_projections.length}`
  );

  // 7. Controller POST /api/forecast/generate/:productId endpoint
  const reqGen = {
    user: { id: 1, shop_id: shopId },
    params: { productId: product.id },
    body: { horizon_days: 7, model: 'SMA_7' }
  };
  const resGen = createMockRes();
  await forecastController.generateForecast(reqGen, resGen);
  assert(
    '7. generateForecast controller endpoint returns HTTP 201 with generated forecast',
    resGen.statusCode === 201 && resGen.data.success === true && resGen.data.forecast.model_used === 'MOVING_AVERAGE_7',
    JSON.stringify(resGen.data)
  );

  // 8. Rejection of invalid horizon with HTTP 400
  const reqInvalidHorizon = {
    user: { id: 1, shop_id: shopId },
    params: { productId: product.id },
    body: { horizon_days: 45 } // Invalid!
  };
  const resInvalidHorizon = createMockRes();
  await forecastController.generateForecast(reqInvalidHorizon, resInvalidHorizon);
  assert(
    '8. Invalid horizon days (not in 7, 14, 30) rejected with HTTP 400',
    resInvalidHorizon.statusCode === 400 && resInvalidHorizon.data.success === false,
    JSON.stringify(resInvalidHorizon.data)
  );

  // 9. Rejection of non-existent product ID with HTTP 404
  const reqMissingProd = {
    user: { id: 1, shop_id: shopId },
    params: { productId: 999999 },
    body: { horizon_days: 7 }
  };
  const resMissingProd = createMockRes();
  await forecastController.generateForecast(reqMissingProd, resMissingProd);
  assert(
    '9. Non-existent product ID rejected with HTTP 404',
    resMissingProd.statusCode === 404 && resMissingProd.data.success === false,
    JSON.stringify(resMissingProd.data)
  );

  // 10. Controller POST /api/forecast/generate-all (Catalog batch)
  const reqGenAll = {
    user: { id: 1, shop_id: shopId },
    body: { horizon_days: 7, model: 'AUTO' }
  };
  const resGenAll = createMockRes();
  await forecastController.generateAllForecasts(reqGenAll, resGenAll);
  assert(
    '10. generateAllForecasts batch produces forecasts for catalog items with HTTP 201',
    resGenAll.statusCode === 201 && resGenAll.data.total_products_forecasted >= 1,
    JSON.stringify(resGenAll.data)
  );

  // 11. Controller GET /api/forecast/product/:productId (History inspection)
  const reqHist = {
    user: { id: 1, shop_id: shopId },
    params: { productId: product.id }
  };
  const resHist = createMockRes();
  await forecastController.getProductForecastHistory(reqHist, resHist);
  assert(
    '11. getProductForecastHistory returns array of historical forecast runs',
    resHist.statusCode === 200 && resHist.data.count >= 1 && Array.isArray(resHist.data.forecasts),
    JSON.stringify(resHist.data)
  );

  // 12. Controller GET /api/forecast/latest (Latest catalog overview)
  const reqLatest = {
    user: { id: 1, shop_id: shopId }
  };
  const resLatest = createMockRes();
  await forecastController.getLatestCatalogForecasts(reqLatest, resLatest);
  assert(
    '12. getLatestCatalogForecasts returns latest forecast per product',
    resLatest.statusCode === 200 && resLatest.data.count >= 1 && Array.isArray(resLatest.data.latest_forecasts),
    JSON.stringify(resLatest.data)
  );

  // 13. Multi-tenant isolation: Shop 2 cannot view Shop 1 forecasts
  const reqShop2 = {
    user: { id: 99, shop_id: otherShopId }
  };
  const resShop2 = createMockRes();
  await forecastController.getLatestCatalogForecasts(reqShop2, resShop2);
  assert(
    '13. Multi-tenant isolation: Shop 2 catalog forecasts return zero Shop 1 records',
    resShop2.statusCode === 200 && resShop2.data.count === 0,
    JSON.stringify(resShop2.data)
  );

  console.log('\n===============================================================');
  if (passed === total) {
    console.log(` ALL ${passed}/${total} DEMAND FORECASTING ENGINE TESTS PASSED (100%)!`);
    console.log(' Md Ebrahim Hossen - Task T-3.3 Complete and Verified.');
  } else {
    console.error(` TEST SUITE FAILED: ${passed}/${total} passed.`);
  }
  console.log('===============================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runForecastingTestSuite().catch(err => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});

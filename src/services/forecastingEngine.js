const { db } = require('../config/database');
const { getProductDailyTimeSeries, formatDate } = require('./dataPreparation');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Predict future demand using Simple Moving Average (SMA)
 * @param {Array} series - Chronological daily time-series array
 * @param {number} windowSize - Moving average window (e.g., 7 or 30 days)
 * @param {number} horizonDays - Future projection days (7, 14, or 30)
 */
function predictMovingAverage(series, windowSize = 7, horizonDays = 7) {
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('Valid time-series data array is required.');
  }

  const effectiveWindow = Math.min(windowSize, series.length);
  const recentSlice = series.slice(-effectiveWindow);
  const totalInWindow = recentSlice.reduce((sum, item) => sum + (Number(item.quantity_sold) || 0), 0);
  const dailyAverage = Number((totalInWindow / effectiveWindow).toFixed(2));

  // Project future days
  const today = new Date();
  const dailyProjections = [];

  for (let h = 1; h <= horizonDays; h++) {
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + h);
    dailyProjections.push({
      horizon_step: h,
      date: formatDate(futureDate),
      day_of_week: DAY_NAMES[futureDate.getDay()],
      predicted_units: dailyAverage
    });
  }

  const totalDemand = Number((dailyAverage * horizonDays).toFixed(2));

  return {
    model: `MOVING_AVERAGE_${windowSize}`,
    window_size: effectiveWindow,
    horizon_days: horizonDays,
    daily_rate: dailyAverage,
    predicted_total: totalDemand,
    daily_projections: dailyProjections
  };
}

/**
 * Predict future demand using Seasonal Naive Model (Weekly Period M = 7)
 * Captures day-of-week retail seasonality patterns
 * @param {Array} series - Chronological daily time-series array
 * @param {number} horizonDays - Future projection days (7, 14, or 30)
 */
function predictSeasonalNaive(series, horizonDays = 7) {
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('Valid time-series data array is required.');
  }

  // Group historical sales by day-of-week index (0 = Sunday ... 6 = Saturday)
  const dayOfWeekSales = new Map();
  for (let i = 0; i < 7; i++) {
    dayOfWeekSales.set(i, []);
  }

  for (const item of series) {
    const d = new Date(item.date);
    const dayIdx = d.getDay();
    dayOfWeekSales.get(dayIdx).push(Number(item.quantity_sold) || 0);
  }

  // Calculate most recent seasonal value (or average of that weekday)
  const seasonalWeekdayMap = new Map();
  const overallMean = series.reduce((s, it) => s + (Number(it.quantity_sold) || 0), 0) / series.length;

  for (let i = 0; i < 7; i++) {
    const history = dayOfWeekSales.get(i);
    if (history.length > 0) {
      // Use the most recent occurrence of this weekday (Seasonal Naive)
      seasonalWeekdayMap.set(i, history[history.length - 1]);
    } else {
      seasonalWeekdayMap.set(i, Math.round(overallMean));
    }
  }

  const today = new Date();
  const dailyProjections = [];
  let totalDemand = 0;

  for (let h = 1; h <= horizonDays; h++) {
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + h);
    const dayIdx = futureDate.getDay();
    const predictedQty = Number((seasonalWeekdayMap.get(dayIdx) || 0).toFixed(2));

    totalDemand += predictedQty;
    dailyProjections.push({
      horizon_step: h,
      date: formatDate(futureDate),
      day_of_week: DAY_NAMES[dayIdx],
      predicted_units: predictedQty
    });
  }

  return {
    model: 'SEASONAL_NAIVE_7',
    season_period: 7,
    horizon_days: horizonDays,
    predicted_total: Number(totalDemand.toFixed(2)),
    daily_projections: dailyProjections
  };
}

/**
 * Predict future demand using Weighted Ensemble Model
 * Blends baseline moving average with day-of-week seasonality
 * @param {Array} series
 * @param {number} horizonDays
 */
function predictEnsemble(series, horizonDays = 7) {
  const sma7 = predictMovingAverage(series, 7, horizonDays);
  const seasonal = predictSeasonalNaive(series, horizonDays);

  const dailyProjections = [];
  let totalDemand = 0;

  for (let i = 0; i < horizonDays; i++) {
    const sItem = seasonal.daily_projections[i];
    const mItem = sma7.daily_projections[i];
    // 60% Seasonal Naive, 40% Moving Average
    const blended = Number((0.6 * sItem.predicted_units + 0.4 * mItem.predicted_units).toFixed(2));
    totalDemand += blended;

    dailyProjections.push({
      horizon_step: i + 1,
      date: sItem.date,
      day_of_week: sItem.day_of_week,
      predicted_units: blended
    });
  }

  return {
    model: 'ENSEMBLE',
    weights: { seasonal_naive: 0.6, moving_average_7: 0.4 },
    horizon_days: horizonDays,
    predicted_total: Number(totalDemand.toFixed(2)),
    daily_projections: dailyProjections
  };
}

/**
 * Compute 95% Confidence Intervals based on historical standard deviation
 */
function calculateConfidenceInterval(predictedTotal, dailyStdDev, horizonDays) {
  const effectiveStdDev = Math.max(0.5, dailyStdDev || 1.0);
  const horizonStdDev = effectiveStdDev * Math.sqrt(horizonDays);
  const margin = 1.96 * horizonStdDev;

  const lower = Math.max(0, Number((predictedTotal - margin).toFixed(2)));
  const upper = Number((predictedTotal + margin).toFixed(2));

  return {
    lower_bound: lower,
    upper_bound: upper,
    confidence_level: 0.95,
    margin_of_error: Number(margin.toFixed(2))
  };
}

/**
 * Generate and optionally persist demand forecast for a single product
 * @param {number} shopId
 * @param {number} productId
 * @param {Object} options - { horizonDays: 7, model: 'AUTO'|'SMA_7'|'SMA_30'|'SEASONAL_NAIVE'|'ENSEMBLE', persist: true }
 */
async function generateProductForecast(shopId, productId, options = {}) {
  const horizonDays = [7, 14, 30].includes(options.horizonDays) ? options.horizonDays : 7;
  const requestedModel = (options.model || 'AUTO').toUpperCase();
  const shouldPersist = options.persist !== false;

  // Retrieve gap-filled time-series from data preparation service
  const timeSeriesResult = await getProductDailyTimeSeries(shopId, productId, 30);
  const series = timeSeriesResult.series;
  const summary = timeSeriesResult.summary;
  const product = timeSeriesResult.product;

  let forecastResult;
  let modelChosen = requestedModel;

  if (requestedModel === 'AUTO') {
    if (summary.active_sales_days < 7) {
      forecastResult = predictMovingAverage(series, 7, horizonDays);
      modelChosen = 'MOVING_AVERAGE_7';
    } else {
      forecastResult = predictEnsemble(series, horizonDays);
      modelChosen = 'ENSEMBLE';
    }
  } else if (requestedModel === 'SMA_30' || requestedModel === 'MOVING_AVERAGE_30') {
    forecastResult = predictMovingAverage(series, 30, horizonDays);
    modelChosen = 'MOVING_AVERAGE_30';
  } else if (requestedModel === 'SEASONAL_NAIVE' || requestedModel === 'SEASONAL_NAIVE_7') {
    forecastResult = predictSeasonalNaive(series, horizonDays);
    modelChosen = 'SEASONAL_NAIVE_7';
  } else if (requestedModel === 'ENSEMBLE') {
    forecastResult = predictEnsemble(series, horizonDays);
    modelChosen = 'ENSEMBLE';
  } else {
    forecastResult = predictMovingAverage(series, 7, horizonDays);
    modelChosen = 'MOVING_AVERAGE_7';
  }

  // Calculate confidence interval
  const ci = calculateConfidenceInterval(forecastResult.predicted_total, summary.std_dev_daily_sales, horizonDays);

  let forecastId = null;
  if (shouldPersist) {
    const insertRes = await db.runAsync(
      `INSERT INTO forecasts (
        shop_id, product_id, horizon_days, model_name,
        predicted_demand, confidence_lower, confidence_upper
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        productId,
        horizonDays,
        modelChosen,
        forecastResult.predicted_total,
        ci.lower_bound,
        ci.upper_bound
      ]
    );
    forecastId = insertRes.lastID;
  }

  return {
    forecast_id: forecastId,
    shop_id: shopId,
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      current_stock: product.current_stock,
      unit: product.unit
    },
    forecast_date: formatDate(new Date()),
    horizon_days: horizonDays,
    model_name: modelChosen,
    model_used: modelChosen,
    predicted_demand: forecastResult.predicted_total,
    confidence_interval: ci,
    historical_metrics: {
      mean_daily_sales: summary.mean_daily_sales,
      std_dev_daily_sales: summary.std_dev_daily_sales,
      active_sales_days: summary.active_sales_days,
      data_sufficiency: summary.data_sufficiency
    },
    daily_projections: forecastResult.daily_projections
  };
}

/**
 * Batch generate forecasts for all catalog products of a shop
 */
async function generateCatalogForecasts(shopId, options = {}) {
  const horizonDays = [7, 14, 30].includes(options.horizonDays) ? options.horizonDays : 7;
  const products = await db.allAsync(
    'SELECT id, sku, name FROM products WHERE shop_id = ? ORDER BY id ASC',
    [shopId]
  );

  const results = [];
  for (const prod of products) {
    try {
      const fc = await generateProductForecast(shopId, prod.id, {
        horizonDays,
        model: options.model || 'AUTO',
        persist: options.persist !== false
      });
      results.push(fc);
    } catch (err) {
      console.warn(`[Forecasting Engine] Failed to forecast for product ${prod.sku}:`, err.message);
    }
  }

  return {
    shop_id: shopId,
    horizon_days: horizonDays,
    total_products_forecasted: results.length,
    forecasts: results
  };
}

module.exports = {
  predictMovingAverage,
  predictSeasonalNaive,
  predictEnsemble,
  calculateConfidenceInterval,
  generateProductForecast,
  generateCatalogForecasts
};

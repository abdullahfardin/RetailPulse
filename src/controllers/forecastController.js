const { db } = require('../config/database');
const { getProductDailyTimeSeries, getCategoryAggregatedTimeSeries } = require('../services/dataPreparation');
const {
  generateProductForecast,
  generateCatalogForecasts
} = require('../services/forecastingEngine');

/**
 * GET /api/forecast/time-series/:productId
 * Retrieve continuous chronological sales time-series for a product with gap filling (Task T-3.2)
 */
async function getProductTimeSeries(req, res) {
  try {
    const shopId = req.user.shop_id;
    const productId = parseInt(req.params.productId, 10);
    const days = parseInt(req.query.days, 10) || 30;

    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID specified.'
      });
    }

    const timeSeriesData = await getProductDailyTimeSeries(shopId, productId, Math.min(90, Math.max(7, days)));

    res.json({
      success: true,
      data: timeSeriesData
    });
  } catch (error) {
    console.error('[Forecast Controller - getProductTimeSeries]:', error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/forecast/category-series/:category
 * Retrieve category-level aggregated time-series for baseline demand comparison (Task T-3.2)
 */
async function getCategoryTimeSeries(req, res) {
  try {
    const shopId = req.user.shop_id;
    const category = req.params.category;
    const days = parseInt(req.query.days, 10) || 30;

    if (!category || !category.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Category parameter is required.'
      });
    }

    const categoryData = await getCategoryAggregatedTimeSeries(shopId, category.trim(), Math.min(90, Math.max(7, days)));

    res.json({
      success: true,
      data: categoryData
    });
  } catch (error) {
    console.error('[Forecast Controller - getCategoryTimeSeries]:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * POST /api/forecast/generate/:productId
 * Generate demand forecast for a single product using specified or auto-selected model (Task T-3.3)
 */
async function generateForecast(req, res) {
  try {
    const shopId = req.user.shop_id;
    const productId = parseInt(req.params.productId, 10);
    const { horizon_days, model, persist = true } = req.body || {};

    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID specified.'
      });
    }

    const horizon = parseInt(horizon_days, 10) || 7;
    if (![7, 14, 30].includes(horizon)) {
      return res.status(400).json({
        success: false,
        error: 'Forecast horizon must be 7, 14, or 30 days.'
      });
    }

    const forecast = await generateProductForecast(shopId, productId, {
      horizonDays: horizon,
      model: model || 'AUTO',
      persist: persist !== false
    });

    res.status(201).json({
      success: true,
      forecast
    });
  } catch (error) {
    console.error('[Forecast Controller - generateForecast]:', error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * POST /api/forecast/generate-all
 * Batch generate demand forecasts across all active products in the shop catalog (Task T-3.3)
 */
async function generateAllForecasts(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { horizon_days = 7, model = 'AUTO' } = req.body || {};

    const horizon = parseInt(horizon_days, 10) || 7;
    const results = await generateCatalogForecasts(shopId, {
      horizonDays: horizon,
      model
    });

    res.status(201).json({
      success: true,
      ...results
    });
  } catch (error) {
    console.error('[Forecast Controller - generateAllForecasts]:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to batch generate catalog forecasts.',
      details: error.message
    });
  }
}

/**
 * GET /api/forecast/product/:productId
 * Retrieve historical demand forecasts generated for a product (Task T-3.3)
 */
async function getProductForecastHistory(req, res) {
  try {
    const shopId = req.user.shop_id;
    const productId = parseInt(req.params.productId, 10);

    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID specified.'
      });
    }

    const rows = await db.allAsync(
      `SELECT f.*, p.name as product_name, p.sku as product_sku, p.unit
       FROM forecasts f
       JOIN products p ON f.product_id = p.id
       WHERE f.shop_id = ? AND f.product_id = ?
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT 20`,
      [shopId, productId]
    );

    res.json({
      success: true,
      count: rows.length,
      forecasts: rows
    });
  } catch (error) {
    console.error('[Forecast Controller - getProductForecastHistory]:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve forecast history.',
      details: error.message
    });
  }
}

/**
 * GET /api/forecast/latest
 * Retrieve the latest generated demand forecast for each catalog product (Task T-3.3)
 */
async function getLatestCatalogForecasts(req, res) {
  try {
    const shopId = req.user.shop_id;

    const rows = await db.allAsync(
      `SELECT f.*, p.name as product_name, p.sku as product_sku, p.category, p.stock_quantity as current_stock, p.unit
       FROM forecasts f
       JOIN products p ON f.product_id = p.id
       WHERE f.id IN (
         SELECT MAX(id)
         FROM forecasts
         WHERE shop_id = ?
         GROUP BY product_id
       )
       ORDER BY f.predicted_demand DESC`,
      [shopId]
    );

    res.json({
      success: true,
      count: rows.length,
      latest_forecasts: rows
    });
  } catch (error) {
    console.error('[Forecast Controller - getLatestCatalogForecasts]:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve latest catalog forecasts.',
      details: error.message
    });
  }
}

module.exports = {
  getProductTimeSeries,
  getCategoryTimeSeries,
  generateForecast,
  generateAllForecasts,
  getProductForecastHistory,
  getLatestCatalogForecasts
};

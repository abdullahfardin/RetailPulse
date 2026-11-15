const { getProductDailyTimeSeries, getCategoryAggregatedTimeSeries } = require('../services/dataPreparation');

/**
 * GET /api/forecast/time-series/:productId
 * Retrieve continuous chronological sales time-series for a product with gap filling
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
 * Retrieve category-level aggregated time-series for baseline demand comparison
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

module.exports = {
  getProductTimeSeries,
  getCategoryTimeSeries
};

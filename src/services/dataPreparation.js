const { db } = require('../config/database');

/**
 * Format Date to YYYY-MM-DD in local time
 */
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generate complete continuous sequence of calendar days between startDate and endDate
 */
function generateContinuousDateRange(daysBack = 30) {
  const dates = [];
  const today = new Date();

  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push({
      dateStr: formatDate(d),
      dayOfWeek: DAY_NAMES[d.getDay()],
      dayIndex: d.getDay()
    });
  }

  return dates;
}

/**
 * Retrieve and fill chronological daily sales time-series for a product
 * Implements gap-filling for zero-sales days (Proposal Section 4.1)
 */
async function getProductDailyTimeSeries(shopId, productId, daysBack = 30) {
  // 1. Verify product exists
  const product = await db.getAsync(
    'SELECT id, sku, name, category, cost_price, selling_price, stock_quantity, unit FROM products WHERE id = ? AND shop_id = ?',
    [productId, shopId]
  );

  if (!product) {
    throw new Error(`Product with ID ${productId} not found in this shop.`);
  }

  // 2. Query discrete sales records grouped by date
  const salesRows = await db.allAsync(
    `SELECT date(s.created_at, 'localtime') as sale_date,
            COALESCE(SUM(si.quantity), 0) as quantity_sold,
            COALESCE(SUM(si.total_price), 0) as daily_revenue,
            COUNT(DISTINCT s.id) as order_count
     FROM sales s
     JOIN sale_items si ON s.id = si.sale_id
     WHERE s.shop_id = ? 
       AND si.product_id = ?
       AND s.created_at >= datetime('now', '-' || ? || ' days', 'localtime')
     GROUP BY date(s.created_at, 'localtime')
     ORDER BY sale_date ASC`,
    [shopId, productId, daysBack]
  );

  // Map database rows by date for O(1) lookup
  const salesByDate = new Map();
  for (const row of salesRows) {
    salesByDate.set(row.sale_date, {
      quantity: Number(row.quantity_sold) || 0,
      revenue: Number(row.daily_revenue) || 0,
      orders: Number(row.order_count) || 0
    });
  }

  // 3. Gap-filling: Merge with full calendar sequence so no days are missing
  const fullCalendar = generateContinuousDateRange(daysBack);
  const timeSeries = [];
  let totalUnits = 0;
  let totalRevenue = 0;
  let activeSalesDays = 0;

  for (const cal of fullCalendar) {
    const entry = salesByDate.get(cal.dateStr);
    const qty = entry ? entry.quantity : 0;
    const rev = entry ? entry.revenue : 0;
    const orders = entry ? entry.orders : 0;

    if (qty > 0) {
      activeSalesDays++;
      totalUnits += qty;
      totalRevenue += rev;
    }

    timeSeries.push({
      date: cal.dateStr,
      day_of_week: cal.dayOfWeek,
      day_index: cal.dayIndex,
      quantity_sold: qty,
      revenue: rev,
      order_count: orders
    });
  }

  // 4. Statistical Metrics calculation
  const quantities = timeSeries.map(t => t.quantity_sold);
  const meanDailySales = Number((totalUnits / daysBack).toFixed(2));

  // Sample standard deviation
  const variance = quantities.reduce((acc, val) => acc + Math.pow(val - meanDailySales, 2), 0) / (daysBack - 1 || 1);
  const stdDevDailySales = Number(Math.sqrt(variance).toFixed(2));

  // Data sufficiency label (Proposal Section 4.2)
  let dataSufficiency = 'LIMITED';
  if (activeSalesDays >= 14) {
    dataSufficiency = 'HIGH';
  } else if (activeSalesDays >= 5) {
    dataSufficiency = 'MODERATE';
  }

  return {
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      current_stock: product.stock_quantity
    },
    days_analyzed: daysBack,
    summary: {
      total_units_sold: totalUnits,
      total_revenue: totalRevenue,
      active_sales_days: activeSalesDays,
      zero_sales_days: daysBack - activeSalesDays,
      mean_daily_sales: meanDailySales,
      std_dev_daily_sales: stdDevDailySales,
      data_sufficiency: dataSufficiency
    },
    series: timeSeries
  };
}

/**
 * Category-level baseline aggregation for fallback when individual product has low history
 */
async function getCategoryAggregatedTimeSeries(shopId, category, daysBack = 30) {
  const salesRows = await db.allAsync(
    `SELECT date(s.created_at, 'localtime') as sale_date,
            COALESCE(SUM(si.quantity), 0) as quantity_sold,
            COALESCE(SUM(si.total_price), 0) as daily_revenue
     FROM sales s
     JOIN sale_items si ON s.id = si.sale_id
     JOIN products p ON si.product_id = p.id
     WHERE s.shop_id = ? 
       AND p.category = ?
       AND s.created_at >= datetime('now', '-' || ? || ' days', 'localtime')
     GROUP BY date(s.created_at, 'localtime')
     ORDER BY sale_date ASC`,
    [shopId, category, daysBack]
  );

  const salesByDate = new Map();
  salesRows.forEach(r => salesByDate.set(r.sale_date, Number(r.quantity_sold) || 0));

  const fullCalendar = generateContinuousDateRange(daysBack);
  const series = fullCalendar.map(cal => ({
    date: cal.dateStr,
    day_of_week: cal.dayOfWeek,
    quantity_sold: salesByDate.get(cal.dateStr) || 0
  }));

  const total = series.reduce((acc, s) => acc + s.quantity_sold, 0);
  return {
    category,
    days_analyzed: daysBack,
    total_category_volume: total,
    category_mean_daily: Number((total / daysBack).toFixed(2)),
    series
  };
}

/**
 * Sanitizes and validates time-series data ensuring non-negative values
 */
function sanitizeTimeSeries(rawSeries) {
  if (!Array.isArray(rawSeries)) {
    throw new Error('Time-series data must be an array.');
  }

  return rawSeries.map(item => {
    const qty = Math.max(0, Number(item.quantity_sold) || 0);
    return {
      date: item.date,
      quantity_sold: qty,
      revenue: Math.max(0, Number(item.revenue) || 0)
    };
  });
}

module.exports = {
  formatDate,
  generateContinuousDateRange,
  getProductDailyTimeSeries,
  getCategoryAggregatedTimeSeries,
  sanitizeTimeSeries
};

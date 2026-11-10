const { db } = require('../config/database');

/**
 * Get Key Performance Indicators (KPIs) for the store dashboard
 * Computes: Today's revenue, sales count, inventory value, low-stock alerts
 */
async function getDashboardStats(req, res) {
  try {
    const shopId = req.user.shop_id;

    // 1. Sales stats for Today
    const todaySales = await db.getAsync(`
      SELECT
        COUNT(id) as today_orders,
        COALESCE(SUM(total_amount), 0) as today_revenue,
        COALESCE(SUM(discount), 0) as today_discounts
      FROM sales
      WHERE shop_id = ? AND date(created_at) = date('now', 'localtime')
    `, [shopId]);

    // 2. All-time Sales stats
    const allTimeSales = await db.getAsync(`
      SELECT
        COUNT(id) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_revenue
      FROM sales
      WHERE shop_id = ?
    `, [shopId]);

    // 3. Inventory stats & Stock health
    const inventoryStats = await db.getAsync(`
      SELECT
        COUNT(id) as total_products,
        COALESCE(SUM(stock_quantity), 0) as total_units,
        COALESCE(SUM(stock_quantity * cost_price), 0) as total_cost_valuation,
        COALESCE(SUM(stock_quantity * selling_price), 0) as total_retail_valuation,
        COALESCE(SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= min_stock_threshold THEN 1 ELSE 0 END), 0) as low_stock_count,
        COALESCE(SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count
      FROM products
      WHERE shop_id = ?
    `, [shopId]);

    return res.json({
      success: true,
      stats: {
        today_revenue: todaySales.today_revenue,
        today_orders: todaySales.today_orders,
        today_discounts: todaySales.today_discounts,
        all_time_revenue: allTimeSales.total_revenue,
        all_time_orders: allTimeSales.total_orders,
        total_products: inventoryStats.total_products,
        total_units: inventoryStats.total_units,
        cost_valuation: inventoryStats.total_cost_valuation,
        retail_valuation: inventoryStats.total_retail_valuation,
        potential_profit: inventoryStats.total_retail_valuation - inventoryStats.total_cost_valuation,
        low_stock_count: inventoryStats.low_stock_count,
        out_of_stock_count: inventoryStats.out_of_stock_count,
        total_alerts: inventoryStats.low_stock_count + inventoryStats.out_of_stock_count
      }
    });
  } catch (error) {
    console.error('[Dashboard Controller - getDashboardStats Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to compute dashboard KPI statistics.' });
  }
}

/**
 * Get daily sales trend for Chart.js Line Chart
 * Aggregates daily revenue and transaction count over the last 7 to 30 days
 */
async function getSalesTrend(req, res) {
  try {
    const shopId = req.user.shop_id;
    const days = parseInt(req.query.days, 10) || 7;

    const rows = await db.allAsync(`
      SELECT
        date(created_at) as sale_date,
        COUNT(id) as order_count,
        COALESCE(SUM(total_amount), 0) as daily_revenue
      FROM sales
      WHERE shop_id = ? AND created_at >= date('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      ORDER BY sale_date ASC
    `, [shopId, days]);

    // If fewer than 7 days recorded, format clean labels for charting
    const labels = [];
    const revenueData = [];
    const orderData = [];

    // Build timeline for the last `days` days
    const dateMap = {};
    rows.forEach(r => { dateMap[r.sale_date] = r; });

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const displayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      labels.push(displayLabel);
      if (dateMap[dateStr]) {
        revenueData.push(dateMap[dateStr].daily_revenue);
        orderData.push(dateMap[dateStr].order_count);
      } else {
        revenueData.push(0);
        orderData.push(0);
      }
    }

    return res.json({
      success: true,
      trend: {
        labels,
        revenue: revenueData,
        orders: orderData
      }
    });
  } catch (error) {
    console.error('[Dashboard Controller - getSalesTrend Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve sales trend data.' });
  }
}

/**
 * Get Top 5 Highest Selling Products by Quantity Sold
 */
async function getTopProducts(req, res) {
  try {
    const shopId = req.user.shop_id;
    const limit = parseInt(req.query.limit, 10) || 5;

    const topProducts = await db.allAsync(`
      SELECT
        p.id, p.name, p.sku, p.category, p.selling_price, p.stock_quantity,
        COALESCE(SUM(si.quantity), 0) as units_sold,
        COALESCE(SUM(si.total_price), 0) as total_sales_amount
      FROM products p
      JOIN sale_items si ON p.id = si.product_id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.shop_id = ?
      GROUP BY p.id
      ORDER BY units_sold DESC
      LIMIT ?
    `, [shopId, limit]);

    return res.json({
      success: true,
      count: topProducts.length,
      topProducts
    });
  } catch (error) {
    console.error('[Dashboard Controller - getTopProducts Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to compute top-selling products.' });
  }
}

/**
 * Get Category breakdown for Chart.js Doughnut Chart
 */
async function getCategoryDistribution(req, res) {
  try {
    const shopId = req.user.shop_id;

    const categories = await db.allAsync(`
      SELECT
        category,
        COUNT(id) as product_count,
        COALESCE(SUM(stock_quantity), 0) as total_units,
        COALESCE(SUM(stock_quantity * selling_price), 0) as total_value
      FROM products
      WHERE shop_id = ?
      GROUP BY category
      ORDER BY total_units DESC
    `, [shopId]);

    return res.json({
      success: true,
      categories
    });
  } catch (error) {
    console.error('[Dashboard Controller - getCategoryDistribution Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to compute category breakdown.' });
  }
}

/**
 * Inventory Planning & Reorder Engine (FR 16)
 * Generates low-stock alerts and calculates suggested replenishment reorder quantity
 */
async function getLowStockAlerts(req, res) {
  try {
    const shopId = req.user.shop_id;

    const alertProducts = await db.allAsync(`
      SELECT id, sku, name, category, cost_price, selling_price, stock_quantity,
             min_stock_threshold, unit,
             CASE
               WHEN stock_quantity <= 0 THEN 'CRITICAL_OUT_OF_STOCK'
               ELSE 'WARNING_LOW_STOCK'
             END as alert_level,
             (min_stock_threshold - stock_quantity) as deficit,
             -- Reorder recommendation formula: (min_threshold * 2) - current_stock + safety_buffer (5)
             MAX(10, ((min_stock_threshold * 2) - stock_quantity + 5)) as suggested_reorder_qty,
             MAX(10, ((min_stock_threshold * 2) - stock_quantity + 5)) * cost_price as estimated_reorder_cost
      FROM products
      WHERE shop_id = ? AND stock_quantity <= min_stock_threshold
      ORDER BY stock_quantity ASC, deficit DESC
    `, [shopId]);

    return res.json({
      success: true,
      count: alertProducts.length,
      alerts: alertProducts
    });
  } catch (error) {
    console.error('[Dashboard Controller - getLowStockAlerts Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to compute low-stock alerts.' });
  }
}

/**
 * Audit Trail Logs Viewer (FR 14)
 * Returns chronological ledger of inventory movements (sales, restocks, corrections)
 */
async function getAuditLogs(req, res) {
  try {
    const shopId = req.user.shop_id;
    const limit = parseInt(req.query.limit, 10) || 20;

    const logs = await db.allAsync(`
      SELECT il.id, il.change_type, il.quantity_change, il.previous_stock, il.new_stock,
             il.reason, il.created_at,
             p.name as product_name, p.sku as product_sku, p.unit,
             u.name as user_name
      FROM inventory_logs il
      JOIN products p ON il.product_id = p.id
      LEFT JOIN users u ON il.user_id = u.id
      WHERE il.shop_id = ?
      ORDER BY il.created_at DESC, il.id DESC
      LIMIT ?
    `, [shopId, limit]);

    return res.json({
      success: true,
      count: logs.length,
      logs
    });
  } catch (error) {
    console.error('[Dashboard Controller - getAuditLogs Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve inventory audit logs.' });
  }
}

/**
 * Export Business Report in CSV format (FR 17)
 */
async function exportReportCsv(req, res) {
  try {
    const shopId = req.user.shop_id;

    const shop = await db.getAsync('SELECT name FROM shops WHERE id = ?', [shopId]);
    const products = await db.allAsync(`
      SELECT sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit
      FROM products
      WHERE shop_id = ?
      ORDER BY name ASC
    `, [shopId]);

    let csv = `Shop Name: "${shop ? shop.name : 'Pulse Mart'}"\n`;
    csv += `Export Date: ${new Date().toLocaleString()}\n\n`;
    csv += `SKU,Product Name,Category,Cost Price (BDT),Selling Price (BDT),Current Stock,Min Threshold,Unit\n`;

    products.forEach(p => {
      csv += `"${p.sku}","${p.name.replace(/"/g, '""')}","${p.category}",${p.cost_price},${p.selling_price},${p.stock_quantity},${p.min_stock_threshold},"${p.unit}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=RetailPulse_Report_${Date.now()}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('[Dashboard Controller - exportReportCsv Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate CSV export report.' });
  }
}

module.exports = {
  getDashboardStats,
  getSalesTrend,
  getTopProducts,
  getCategoryDistribution,
  getLowStockAlerts,
  getAuditLogs,
  exportReportCsv
};

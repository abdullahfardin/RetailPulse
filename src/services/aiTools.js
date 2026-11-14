const { db } = require('../config/database');

/**
 * Gemini Function Calling Declarations (Tools Catalog)
 * Complies with Google Gemini REST API v1beta Schema
 */
const retailToolDeclarations = [
  {
    name: 'searchProduct',
    description: 'Search the store inventory for products matching a name, SKU, or category.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search term, product name, or SKU code (e.g., "Coca-Cola", "BEV-001", "Chips").'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'checkStock',
    description: 'Check real-time stock levels, price, and threshold for a specific product by SKU or name.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identifier: {
          type: 'STRING',
          description: 'Product name or exact SKU code.'
        }
      },
      required: ['identifier']
    }
  },
  {
    name: 'getSalesSummary',
    description: 'Get aggregated sales totals, revenue in BDT, and order count for today or recent period.',
    parameters: {
      type: 'OBJECT',
      properties: {
        period: {
          type: 'STRING',
          description: 'Timeframe for the sales report: "today", "7days", or "30days". Defaults to "today".'
        }
      }
    }
  },
  {
    name: 'getLowStockProducts',
    description: 'Retrieve all products that have depleted below their minimum safety stock threshold and require reordering.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: {
          type: 'NUMBER',
          description: 'Maximum number of low-stock alert items to retrieve. Defaults to 5.'
        }
      }
    }
  },
  {
    name: 'getTopSellingProducts',
    description: 'Retrieve the top best-selling products ranked by units sold and generated revenue.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: {
          type: 'NUMBER',
          description: 'Number of top sellers to retrieve. Defaults to 5.'
        }
      }
    }
  }
];

/**
 * Tool Execution Handlers (Database Queries scoped to authenticated shopId)
 */
const toolExecutors = {
  /**
   * Search products in catalog
   */
  async searchProduct({ query }, shopId) {
    const clean = `%${(query || '').trim()}%`;
    const rows = await db.allAsync(
      `SELECT id, sku, name, category, selling_price, stock_quantity, min_stock_threshold, unit
       FROM products
       WHERE shop_id = ? AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)
       LIMIT 10`,
      [shopId, clean, clean, clean]
    );

    return {
      query,
      found_count: rows.length,
      products: rows.map(r => ({
        sku: r.sku,
        name: r.name,
        category: r.category,
        price: `৳${r.selling_price}`,
        stock: `${r.stock_quantity} ${r.unit}`,
        status: r.stock_quantity <= 0 ? 'OUT_OF_STOCK' : (r.stock_quantity <= r.min_stock_threshold ? 'LOW_STOCK' : 'IN_STOCK')
      }))
    };
  },

  /**
   * Check stock of specific item
   */
  async checkStock({ identifier }, shopId) {
    const clean = (identifier || '').trim();
    const product = await db.getAsync(
      `SELECT id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit
       FROM products
       WHERE shop_id = ? AND (sku = ? OR name LIKE ?)
       LIMIT 1`,
      [shopId, clean, `%${clean}%`]
    );

    if (!product) {
      return {
        found: false,
        message: `Product matching "${identifier}" was not found in catalog.`
      };
    }

    return {
      found: true,
      sku: product.sku,
      name: product.name,
      category: product.category,
      selling_price: `৳${product.selling_price}`,
      cost_price: `৳${product.cost_price}`,
      stock_quantity: product.stock_quantity,
      unit: product.unit,
      min_threshold: product.min_stock_threshold,
      status: product.stock_quantity <= 0 ? 'CRITICAL_OUT_OF_STOCK' : (product.stock_quantity <= product.min_stock_threshold ? 'WARNING_LOW_STOCK' : 'IN_STOCK'),
      deficit: Math.max(0, product.min_stock_threshold - product.stock_quantity)
    };
  },

  /**
   * Sales totals and summary
   */
  async getSalesSummary({ period = 'today' }, shopId) {
    let dateCondition = "date(created_at, 'localtime') = date('now', 'localtime')";
    if (period === '7days') {
      dateCondition = "created_at >= datetime('now', '-7 days', 'localtime')";
    } else if (period === '30days') {
      dateCondition = "created_at >= datetime('now', '-30 days', 'localtime')";
    }

    const row = await db.getAsync(
      `SELECT COUNT(*) as total_orders,
              COALESCE(SUM(total_amount), 0) as total_revenue,
              COALESCE(SUM(discount), 0) as total_discounts
       FROM sales
       WHERE shop_id = ? AND ${dateCondition}`,
      [shopId]
    );

    return {
      period,
      total_orders: row.total_orders,
      total_revenue: `৳${row.total_revenue}`,
      total_discounts: `৳${row.total_discounts}`
    };
  },

  /**
   * Low stock alerts and reorder hints
   */
  async getLowStockProducts({ limit = 5 }, shopId) {
    const rows = await db.allAsync(
      `SELECT sku, name, category, stock_quantity, min_stock_threshold, cost_price, unit,
              (min_stock_threshold - stock_quantity) as deficit,
              MAX(10, ((min_stock_threshold * 2) - stock_quantity + 5)) as suggested_reorder_qty
       FROM products
       WHERE shop_id = ? AND stock_quantity <= min_stock_threshold
       ORDER BY stock_quantity ASC, deficit DESC
       LIMIT ?`,
      [shopId, limit]
    );

    return {
      alert_count: rows.length,
      items: rows.map(r => ({
        sku: r.sku,
        name: r.name,
        current_stock: `${r.stock_quantity} ${r.unit}`,
        threshold: `${r.min_stock_threshold} ${r.unit}`,
        suggested_reorder: `${r.suggested_reorder_qty} ${r.unit}`,
        estimated_cost: `৳${r.suggested_reorder_qty * r.cost_price}`
      }))
    };
  },

  /**
   * Best selling products
   */
  async getTopSellingProducts({ limit = 5 }, shopId) {
    const rows = await db.allAsync(
      `SELECT p.sku, p.name, p.category, p.unit,
              COALESCE(SUM(si.quantity), 0) as units_sold,
              COALESCE(SUM(si.total_price), 0) as gross_revenue
       FROM products p
       JOIN sale_items si ON p.id = si.product_id
       JOIN sales s ON si.sale_id = s.id
       WHERE s.shop_id = ?
       GROUP BY p.id
       ORDER BY units_sold DESC
       LIMIT ?`,
      [shopId, limit]
    );

    return {
      top_count: rows.length,
      top_sellers: rows.map((r, i) => ({
        rank: i + 1,
        sku: r.sku,
        name: r.name,
        units_sold: `${r.units_sold} ${r.unit}`,
        gross_revenue: `৳${r.gross_revenue}`
      }))
    };
  }
};

/**
 * Execute tool call with parameter and shop isolation
 */
async function executeRetailTool(name, args = {}, shopId) {
  const executor = toolExecutors[name];
  if (!executor) {
    throw new Error(`Unknown retail tool: "${name}"`);
  }

  return await executor(args, shopId);
}

module.exports = {
  retailToolDeclarations,
  toolExecutors,
  executeRetailTool
};

const { db } = require('../config/database');
const { createPendingConfirmation } = require('./confirmationManager');

/**
 * Gemini Function Calling Declarations - Core Retail Tools Catalog
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
  },
  {
    name: 'getLatestReceipt',
    description: 'Retrieve details of the most recent sales receipt/invoice, customer name, items sold, and total amount.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  }
];

/**
 * Sensitive State-Changing Declarations (Protected by Explicit Confirmation Gate)
 */
const sensitiveToolDeclarations = [
  {
    name: 'deleteProduct',
    description: 'Request permanent deletion of a product from store inventory. Protected by Explicit Confirmation Protocol.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identifier: {
          type: 'STRING',
          description: 'Product SKU or exact name to delete.'
        },
        reason: {
          type: 'STRING',
          description: 'Reason for deletion (e.g., discontinued, expired).'
        }
      },
      required: ['identifier']
    }
  },
  {
    name: 'updateStock',
    description: 'Request adjusting stock quantity (restock or damage deduction). Protected by Explicit Confirmation Protocol.',
    parameters: {
      type: 'OBJECT',
      properties: {
        identifier: {
          type: 'STRING',
          description: 'Product SKU or exact name.'
        },
        actionType: {
          type: 'STRING',
          description: 'Either "RESTOCK" (add inventory) or "DEDUCT" (spoilage/damage deduction).'
        },
        quantity: {
          type: 'NUMBER',
          description: 'Number of units to adjust.'
        },
        reason: {
          type: 'STRING',
          description: 'Operational justification for stock adjustment.'
        }
      },
      required: ['identifier', 'actionType', 'quantity']
    }
  }
];

const allToolDeclarations = [...retailToolDeclarations, ...sensitiveToolDeclarations];

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
  },

  /**
   * Latest Sales Receipt / Invoice
   */
  async getLatestReceipt(args, shopId) {
    const sale = await db.getAsync(
      `SELECT s.*, u.name as cashier_name
       FROM sales s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.shop_id = ?
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT 1`,
      [shopId]
    );

    if (!sale) {
      return { found: false, message: 'No sales transactions recorded yet for this shop.' };
    }

    const items = await db.allAsync(
      `SELECT product_name, quantity, unit_price, total_price
       FROM sale_items
       WHERE sale_id = ?`,
      [sale.id]
    );

    return {
      found: true,
      invoice_number: sale.invoice_number,
      created_at: sale.created_at,
      customer_name: sale.customer_name || 'Walk-in Customer',
      cashier: sale.cashier_name || 'Cashier',
      payment_method: sale.payment_method,
      subtotal: `৳${sale.subtotal.toFixed(2)}`,
      discount: `৳${(sale.discount || 0).toFixed(2)}`,
      total_amount: `৳${sale.total_amount.toFixed(2)}`,
      items: items.map(it => ({
        product: it.product_name,
        quantity: it.quantity,
        unit_price: `৳${it.unit_price.toFixed(2)}`,
        line_total: `৳${it.total_price.toFixed(2)}`
      }))
    };
  },

  /**
   * Explicit Confirmation Tool: deleteProduct
   * Stages action into pending confirmations instead of direct execution
   */
  async deleteProduct({ identifier, reason }, shopId, userId = null) {
    const clean = (identifier || '').trim();
    const product = await db.getAsync(
      `SELECT id, sku, name, stock_quantity FROM products WHERE shop_id = ? AND (sku = ? OR name LIKE ?) LIMIT 1`,
      [shopId, clean, `%${clean}%`]
    );

    if (!product) {
      return {
        success: false,
        requires_confirmation: false,
        error: `Product matching "${identifier}" not found in catalog.`
      };
    }

    const summary = `Permanently delete product "${product.name}" (${product.sku}, On-hand: ${product.stock_quantity})${reason ? ` - Reason: ${reason}` : ''}`;
    const pending = createPendingConfirmation(shopId, userId, 'deleteProduct', { productId: product.id, sku: product.sku }, summary);

    return {
      requires_confirmation: true,
      token: pending.token,
      action: 'deleteProduct',
      summary: pending.summary,
      warning: pending.warning,
      expires_in_seconds: pending.expires_in_seconds,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        stock_quantity: product.stock_quantity
      }
    };
  },

  /**
   * Explicit Confirmation Tool: updateStock
   * Stages adjustment into pending confirmations instead of direct execution
   */
  async updateStock({ identifier, actionType, quantity, reason }, shopId, userId = null) {
    const clean = (identifier || '').trim();
    const product = await db.getAsync(
      `SELECT id, sku, name, stock_quantity FROM products WHERE shop_id = ? AND (sku = ? OR name LIKE ?) LIMIT 1`,
      [shopId, clean, `%${clean}%`]
    );

    if (!product) {
      return {
        success: false,
        requires_confirmation: false,
        error: `Product matching "${identifier}" not found in catalog.`
      };
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return {
        success: false,
        requires_confirmation: false,
        error: 'Quantity must be a positive integer.'
      };
    }

    const act = (actionType || 'RESTOCK').toUpperCase();
    const isDeduct = act === 'DEDUCT';
    const summary = `${isDeduct ? 'Deduct' : 'Restock'} ${qty} units for "${product.name}" (Current stock: ${product.stock_quantity})${reason ? ` - Reason: ${reason}` : ''}`;

    const pending = createPendingConfirmation(shopId, userId, 'updateStock', {
      productId: product.id,
      sku: product.sku,
      actionType: isDeduct ? 'DEDUCT' : 'ADD',
      quantity: qty,
      reason
    }, summary);

    return {
      requires_confirmation: true,
      token: pending.token,
      action: 'updateStock',
      summary: pending.summary,
      warning: pending.warning,
      expires_in_seconds: pending.expires_in_seconds,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        current_stock: product.stock_quantity
      }
    };
  }
};

/**
 * Execute tool call with parameter and shop isolation
 */
async function executeRetailTool(name, args = {}, shopId, userId = null) {
  const executor = toolExecutors[name];
  if (!executor) {
    throw new Error(`Unknown retail tool: "${name}"`);
  }

  return await executor(args, shopId, userId);
}

module.exports = {
  retailToolDeclarations,
  sensitiveToolDeclarations,
  allToolDeclarations,
  toolExecutors,
  executeRetailTool
};

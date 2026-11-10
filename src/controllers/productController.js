const { db } = require('../config/database');

/**
 * Get all products for the authenticated user's shop
 * Supports optional search, category filter, and stock status filter
 */
async function getProducts(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { search, category, status } = req.query;

    let sql = `
      SELECT id, sku, name, category, cost_price, selling_price, stock_quantity,
             min_stock_threshold, unit, created_at, updated_at,
             CASE
               WHEN stock_quantity <= 0 THEN 'OUT_OF_STOCK'
               WHEN stock_quantity <= min_stock_threshold THEN 'LOW_STOCK'
               ELSE 'IN_STOCK'
             END as stock_status,
             ROUND(((selling_price - cost_price) / selling_price) * 100, 1) as profit_margin_percent
      FROM products
      WHERE shop_id = ?
    `;
    const params = [shopId];

    if (search && search.trim()) {
      sql += ` AND (name LIKE ? OR sku LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    if (category && category.trim() && category !== 'All') {
      sql += ` AND category = ?`;
      params.push(category.trim());
    }

    if (status) {
      if (status === 'LOW_STOCK') {
        sql += ` AND stock_quantity > 0 AND stock_quantity <= min_stock_threshold`;
      } else if (status === 'OUT_OF_STOCK') {
        sql += ` AND stock_quantity <= 0`;
      } else if (status === 'IN_STOCK') {
        sql += ` AND stock_quantity > min_stock_threshold`;
      }
    }

    sql += ` ORDER BY stock_quantity <= 0 DESC, stock_quantity <= min_stock_threshold DESC, name ASC`;

    const products = await db.allAsync(sql, params);

    return res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    console.error('[Product Controller - getProducts Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch products from database.' });
  }
}

/**
 * Get single product by ID
 */
async function getProductById(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { id } = req.params;

    const product = await db.getAsync(`
      SELECT id, sku, name, category, cost_price, selling_price, stock_quantity,
             min_stock_threshold, unit, created_at, updated_at,
             CASE
               WHEN stock_quantity <= 0 THEN 'OUT_OF_STOCK'
               WHEN stock_quantity <= min_stock_threshold THEN 'LOW_STOCK'
               ELSE 'IN_STOCK'
             END as stock_status
      FROM products
      WHERE id = ? AND shop_id = ?
    `, [id, shopId]);

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    return res.json({ success: true, product });
  } catch (error) {
    console.error('[Product Controller - getProductById Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch product details.' });
  }
}

/**
 * Create a new product with input validation
 */
async function createProduct(req, res) {
  try {
    const shopId = req.user.shop_id;
    const userId = req.user.id;
    const { sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit } = req.body;

    // 1. Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Product name is required.' });
    }
    if (!category || !category.trim()) {
      return res.status(400).json({ success: false, error: 'Product category is required.' });
    }

    const price = parseFloat(selling_price);
    if (isNaN(price) || price < 0) {
      return res.status(400).json({ success: false, error: 'Selling price must be a valid positive number.' });
    }

    const cost = cost_price !== undefined && cost_price !== '' ? parseFloat(cost_price) : 0;
    if (isNaN(cost) || cost < 0) {
      return res.status(400).json({ success: false, error: 'Cost price must be a valid positive number.' });
    }

    const initialStock = stock_quantity !== undefined && stock_quantity !== '' ? parseInt(stock_quantity, 10) : 0;
    if (isNaN(initialStock) || initialStock < 0) {
      return res.status(400).json({ success: false, error: 'Stock quantity cannot be negative.' });
    }

    const minThreshold = min_stock_threshold !== undefined && min_stock_threshold !== '' ? parseInt(min_stock_threshold, 10) : 5;

    // Generate automatic SKU if not provided
    const productSku = (sku && sku.trim()) ? sku.trim().toUpperCase() : `PRD-${Date.now().toString().slice(-6)}`;

    // Check SKU uniqueness within the shop
    const existingSku = await db.getAsync(`
      SELECT id FROM products WHERE shop_id = ? AND sku = ?
    `, [shopId, productSku]);

    if (existingSku) {
      return res.status(409).json({ success: false, error: `SKU '${productSku}' already exists in your shop inventory.` });
    }

    // 2. Insert product into database
    const result = await db.runAsync(`
      INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      shopId,
      productSku,
      name.trim(),
      category.trim(),
      cost,
      price,
      initialStock,
      minThreshold,
      (unit && unit.trim()) ? unit.trim() : 'pcs'
    ]);

    const newProductId = result.lastID;

    // 3. Log initial inventory record if initialStock > 0
    if (initialStock > 0) {
      await db.runAsync(`
        INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
        VALUES (?, ?, 'INITIAL', ?, 0, ?, 'Product initial intake', ?)
      `, [shopId, newProductId, initialStock, initialStock, userId]);
    }

    const newProduct = await db.getAsync('SELECT * FROM products WHERE id = ?', [newProductId]);

    return res.status(201).json({
      success: true,
      message: 'Product created and added to inventory successfully.',
      product: newProduct
    });
  } catch (error) {
    console.error('[Product Controller - createProduct Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to create product in database.' });
  }
}

/**
 * Update existing product details
 */
async function updateProduct(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { id } = req.params;
    const { sku, name, category, cost_price, selling_price, min_stock_threshold, unit } = req.body;

    // Check if product belongs to this shop
    const existing = await db.getAsync('SELECT * FROM products WHERE id = ? AND shop_id = ?', [id, shopId]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Product name cannot be empty.' });
    }
    const price = parseFloat(selling_price);
    if (isNaN(price) || price < 0) {
      return res.status(400).json({ success: false, error: 'Selling price must be a valid positive number.' });
    }
    const cost = cost_price !== undefined ? parseFloat(cost_price) : existing.cost_price;
    const minThreshold = min_stock_threshold !== undefined ? parseInt(min_stock_threshold, 10) : existing.min_stock_threshold;
    const productSku = (sku && sku.trim()) ? sku.trim().toUpperCase() : existing.sku;

    // If SKU changed, check uniqueness
    if (productSku !== existing.sku) {
      const duplicateSku = await db.getAsync(
        'SELECT id FROM products WHERE shop_id = ? AND sku = ? AND id != ?',
        [shopId, productSku, id]
      );
      if (duplicateSku) {
        return res.status(409).json({ success: false, error: `SKU '${productSku}' is already used by another product.` });
      }
    }

    await db.runAsync(`
      UPDATE products
      SET sku = ?, name = ?, category = ?, cost_price = ?, selling_price = ?,
          min_stock_threshold = ?, unit = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND shop_id = ?
    `, [
      productSku,
      name.trim(),
      category ? category.trim() : existing.category,
      cost,
      price,
      minThreshold,
      unit ? unit.trim() : existing.unit,
      id,
      shopId
    ]);

    const updated = await db.getAsync('SELECT * FROM products WHERE id = ?', [id]);
    return res.json({
      success: true,
      message: 'Product updated successfully.',
      product: updated
    });
  } catch (error) {
    console.error('[Product Controller - updateProduct Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to update product.' });
  }
}

/**
 * Delete product from inventory
 */
async function deleteProduct(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { id } = req.params;

    const existing = await db.getAsync('SELECT id, name FROM products WHERE id = ? AND shop_id = ?', [id, shopId]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    await db.runAsync('DELETE FROM products WHERE id = ? AND shop_id = ?', [id, shopId]);

    return res.json({
      success: true,
      message: `Product '${existing.name}' was removed from inventory.`
    });
  } catch (error) {
    console.error('[Product Controller - deleteProduct Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete product.' });
  }
}

/**
 * Manual stock adjustment (Restock or Deduct) with audit trail in inventory_logs
 */
async function adjustStock(req, res) {
  try {
    const shopId = req.user.shop_id;
    const userId = req.user.id;
    const { id } = req.params;
    const { action, quantity, reason } = req.body;

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, error: 'Quantity must be a positive integer greater than zero.' });
    }

    if (!['ADD', 'DEDUCT'].includes(action)) {
      return res.status(400).json({ success: false, error: "Action must be either 'ADD' (restock) or 'DEDUCT' (damage/correction)." });
    }

    const product = await db.getAsync('SELECT * FROM products WHERE id = ? AND shop_id = ?', [id, shopId]);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }

    const previousStock = product.stock_quantity;
    let newStock;

    if (action === 'ADD') {
      newStock = previousStock + qty;
    } else {
      if (qty > previousStock) {
        return res.status(400).json({
          success: false,
          error: `Cannot deduct ${qty} items. Only ${previousStock} units are currently available in stock.`
        });
      }
      newStock = previousStock - qty;
    }

    // Atomic update of product stock and inventory log
    await db.runAsync(`
      UPDATE products
      SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND shop_id = ?
    `, [newStock, id, shopId]);

    await db.runAsync(`
      INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      shopId,
      id,
      action === 'ADD' ? 'RESTOCK' : 'CORRECTION',
      action === 'ADD' ? qty : -qty,
      previousStock,
      newStock,
      reason ? reason.trim() : (action === 'ADD' ? 'Manual restock intake' : 'Manual stock deduction'),
      userId
    ]);

    return res.json({
      success: true,
      message: `Stock successfully updated. Previous: ${previousStock}, New: ${newStock}`,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        previous_stock: previousStock,
        current_stock: newStock
      }
    });
  } catch (error) {
    console.error('[Product Controller - adjustStock Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to adjust stock quantity.' });
  }
}

/**
 * Get all unique product categories in the shop
 */
async function getCategories(req, res) {
  try {
    const shopId = req.user.shop_id;
    const rows = await db.allAsync(`
      SELECT DISTINCT category FROM products WHERE shop_id = ? ORDER BY category ASC
    `, [shopId]);

    const categories = rows.map(r => r.category);
    return res.json({ success: true, categories });
  } catch (error) {
    console.error('[Product Controller - getCategories Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve categories.' });
  }
}

/**
 * Get inventory summary statistics for stat cards
 */
async function getProductStats(req, res) {
  try {
    const shopId = req.user.shop_id;

    const stats = await db.getAsync(`
      SELECT
        COUNT(*) as total_products,
        COALESCE(SUM(stock_quantity), 0) as total_units,
        COALESCE(SUM(stock_quantity * cost_price), 0) as total_cost_value,
        COALESCE(SUM(stock_quantity * selling_price), 0) as total_retail_value,
        COALESCE(SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= min_stock_threshold THEN 1 ELSE 0 END), 0) as low_stock_count,
        COALESCE(SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count
      FROM products
      WHERE shop_id = ?
    `, [shopId]);

    return res.json({ success: true, stats });
  } catch (error) {
    console.error('[Product Controller - getProductStats Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve inventory statistics.' });
  }
}

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  getCategories,
  getProductStats
};

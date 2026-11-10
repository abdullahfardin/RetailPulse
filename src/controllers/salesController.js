const { db } = require('../config/database');

/**
 * Record a new sale with Atomic Database Transaction
 * 1. Validates all cart items and verifies stock levels
 * 2. Deducts product inventory atomically
 * 3. Records immutable audit trails in inventory_logs
 * 4. Inserts sale header and sale_items
 * 5. Rolls back completely if any product is out of stock
 */
async function createSale(req, res) {
  const shopId = req.user.shop_id;
  const userId = req.user.id;
  const { customer_name, payment_method, discount, items } = req.body;

  // 1. Validation
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Cannot process sale: Cart is empty. Please add at least one product.'
    });
  }

  const discountAmount = parseFloat(discount) > 0 ? parseFloat(discount) : 0;
  const paymentMethod = payment_method && ['cash', 'card', 'mfs', 'bkash', 'nagad'].includes(payment_method.toLowerCase())
    ? payment_method.toLowerCase()
    : 'cash';
  const customerName = (customer_name && customer_name.trim()) ? customer_name.trim() : 'Walk-in Customer';

  // 2. Pre-verify all items and fetch fresh database records
  const itemValidations = [];
  let calculatedSubtotal = 0;

  for (const item of items) {
    const qty = parseInt(item.quantity, 10);
    if (!item.product_id || isNaN(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid cart item: Each product must have a valid ID and quantity greater than zero.'
      });
    }

    const product = await db.getAsync(`
      SELECT id, name, sku, selling_price, cost_price, stock_quantity, unit
      FROM products
      WHERE id = ? AND shop_id = ?
    `, [item.product_id, shopId]);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: `Product with ID #${item.product_id} does not exist in your store catalog.`
      });
    }

    // Strict stock check to prevent overselling
    if (product.stock_quantity < qty) {
      return res.status(400).json({
        success: false,
        error: `Insufficient stock for '${product.name}'. Requested: ${qty} ${product.unit}, Available: ${product.stock_quantity} ${product.unit}.`
      });
    }

    const lineTotal = product.selling_price * qty;
    calculatedSubtotal += lineTotal;

    itemValidations.push({
      product,
      quantity: qty,
      unitPrice: product.selling_price,
      lineTotal
    });
  }

  const grandTotal = Math.max(0, calculatedSubtotal - discountAmount);
  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

  // 3. Execute Atomic Database Transaction
  try {
    await db.runAsync('BEGIN TRANSACTION;');

    // Insert Sale Header
    const saleResult = await db.runAsync(`
      INSERT INTO sales (shop_id, invoice_number, customer_name, subtotal, discount, total_amount, payment_method, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      shopId,
      invoiceNumber,
      customerName,
      calculatedSubtotal,
      discountAmount,
      grandTotal,
      paymentMethod,
      userId
    ]);

    const saleId = saleResult.lastID;

    // Process each line item: insert sale_item, update product stock, record inventory_log
    const processedItems = [];
    for (const validItem of itemValidations) {
      const p = validItem.product;
      const newStock = p.stock_quantity - validItem.quantity;

      // a) Insert sale line item
      await db.runAsync(`
        INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, total_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [saleId, p.id, p.name, validItem.unitPrice, validItem.quantity, validItem.lineTotal]);

      // b) Atomically decrement stock
      await db.runAsync(`
        UPDATE products
        SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND shop_id = ?
      `, [newStock, p.id, shopId]);

      // c) Record immutable inventory audit log
      await db.runAsync(`
        INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
        VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?)
      `, [
        shopId,
        p.id,
        -validItem.quantity,
        p.stock_quantity,
        newStock,
        `Sale Invoice #${invoiceNumber}`,
        userId
      ]);

      processedItems.push({
        product_id: p.id,
        product_name: p.name,
        sku: p.sku,
        unit_price: validItem.unitPrice,
        quantity: validItem.quantity,
        total_price: validItem.lineTotal,
        remaining_stock: newStock
      });
    }

    // Commit transaction
    await db.runAsync('COMMIT;');

    return res.status(201).json({
      success: true,
      message: 'Sale completed successfully and inventory stock updated.',
      sale: {
        id: saleId,
        invoice_number: invoiceNumber,
        customer_name: customerName,
        payment_method: paymentMethod,
        subtotal: calculatedSubtotal,
        discount: discountAmount,
        total_amount: grandTotal,
        created_at: new Date().toISOString(),
        items: processedItems
      }
    });
  } catch (txError) {
    // If any error occurs inside transaction, ROLLBACK immediately
    console.error('[Sales Transaction Failed - Rolling Back]:', txError);
    try {
      await db.runAsync('ROLLBACK;');
    } catch (rbErr) {
      console.error('[Rollback Error]:', rbErr);
    }

    return res.status(500).json({
      success: false,
      error: 'Transaction failed during checkout. Database rolled back cleanly with no stock lost.'
    });
  }
}

/**
 * Retrieve Sales History for the current store
 * Supports search by invoice number or customer name, and pagination
 */
async function getSalesHistory(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { search, limit, offset } = req.query;

    let sql = `
      SELECT s.id, s.invoice_number, s.customer_name, s.subtotal, s.discount,
             s.total_amount, s.payment_method, s.created_at,
             u.name as cashier_name,
             COUNT(si.id) as total_items,
             SUM(si.quantity) as total_units_sold
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE s.shop_id = ?
    `;
    const params = [shopId];

    if (search && search.trim()) {
      sql += ` AND (s.invoice_number LIKE ? OR s.customer_name LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    sql += ` GROUP BY s.id ORDER BY s.created_at DESC`;

    if (limit) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
      if (offset) {
        sql += ` OFFSET ?`;
        params.push(parseInt(offset, 10));
      }
    }

    const sales = await db.allAsync(sql, params);

    return res.json({
      success: true,
      count: sales.length,
      sales
    });
  } catch (error) {
    console.error('[Sales Controller - getSalesHistory Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve sales history.' });
  }
}

/**
 * Retrieve single sale details with full itemized breakdown (for Receipt generation)
 */
async function getSaleById(req, res) {
  try {
    const shopId = req.user.shop_id;
    const { id } = req.params;

    const sale = await db.getAsync(`
      SELECT s.id, s.invoice_number, s.customer_name, s.subtotal, s.discount,
             s.total_amount, s.payment_method, s.created_at,
             u.name as cashier_name,
             sh.name as shop_name, sh.address as shop_address, sh.phone as shop_phone, sh.currency
      FROM sales s
      JOIN shops sh ON s.shop_id = sh.id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.shop_id = ?
    `, [id, shopId]);

    if (!sale) {
      return res.status(404).json({ success: false, error: 'Sale record not found.' });
    }

    const items = await db.allAsync(`
      SELECT si.id, si.product_id, si.product_name, si.unit_price, si.quantity, si.total_price,
             p.sku, p.unit
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `, [id]);

    return res.json({
      success: true,
      sale: {
        ...sale,
        items
      }
    });
  } catch (error) {
    console.error('[Sales Controller - getSaleById Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve sale details.' });
  }
}

module.exports = {
  createSale,
  getSalesHistory,
  getSaleById
};

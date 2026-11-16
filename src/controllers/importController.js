const { db } = require('../config/database');
const {
  validateProductCsv,
  validateSalesCsv,
  getProductCsvTemplate,
  getSalesCsvTemplate
} = require('../services/csvParser');

/**
 * GET /api/import/template/products
 * Download standard Product Catalog CSV template
 */
function downloadProductTemplate(req, res) {
  const csv = getProductCsvTemplate();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="retailpulse_products_template.csv"');
  res.send(csv);
}

/**
 * GET /api/import/template/sales
 * Download standard Historical Sales CSV template
 */
function downloadSalesTemplate(req, res) {
  const csv = getSalesCsvTemplate();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="retailpulse_sales_template.csv"');
  res.send(csv);
}

/**
 * POST /api/import/preview-products
 * Parse and validate product CSV payload without committing to database
 * Aligns with SRS Section 4.1 & 8.3 (Error preview and correction before saving)
 */
function previewProductCsv(req, res) {
  try {
    const csvContent = req.body?.csv_data || req.body?.content;

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty CSV text data. Please provide `csv_data` in JSON body.'
      });
    }

    const report = validateProductCsv(csvContent);

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('[Import Controller - previewProductCsv]:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to parse and validate product CSV.',
      details: error.message
    });
  }
}

/**
 * POST /api/import/preview-sales
 * Parse and validate historical sales CSV payload without committing to database
 */
function previewSalesCsv(req, res) {
  try {
    const csvContent = req.body?.csv_data || req.body?.content;

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty CSV text data. Please provide `csv_data` in JSON body.'
      });
    }

    const report = validateSalesCsv(csvContent);

    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('[Import Controller - previewSalesCsv]:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to parse and validate sales CSV.',
      details: error.message
    });
  }
}

/**
 * POST /api/import/products
 * Transactional bulk import of validated product catalog items
 * Performs ACID transaction (BEGIN, COMMIT, ROLLBACK) and writes inventory_logs audit records
 */
async function bulkImportProducts(req, res) {
  const shopId = req.user.shop_id;
  const userId = req.user.id;

  try {
    let productsToImport = [];

    // Support either raw CSV text or pre-parsed rows array
    if (req.body?.csv_data && typeof req.body.csv_data === 'string') {
      const validation = validateProductCsv(req.body.csv_data);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'CSV validation failed. Please correct the flagged row errors before importing.',
          validation_errors: validation.errors
        });
      }
      productsToImport = validation.valid_rows;
    } else if (Array.isArray(req.body?.products) && req.body.products.length > 0) {
      productsToImport = req.body.products;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Please provide `csv_data` string or `products` array in request body.'
      });
    }

    if (productsToImport.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No product rows provided for import.'
      });
    }

    // 1. Pre-check database for duplicate SKUs in this shop to prevent partial constraint failures
    const skus = productsToImport.map(p => p.sku);
    const placeholders = skus.map(() => '?').join(',');
    const existingProducts = await db.allAsync(
      `SELECT sku, name FROM products WHERE shop_id = ? AND sku IN (${placeholders})`,
      [shopId, ...skus]
    );

    if (existingProducts.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Import aborted. ${existingProducts.length} SKU(s) already exist in your catalog.`,
        conflicting_skus: existingProducts.map(p => ({ sku: p.sku, name: p.name }))
      });
    }

    // 2. Execute Atomic Transaction (BEGIN TRANSACTION, COMMIT, ROLLBACK)
    await db.runAsync('BEGIN TRANSACTION;');

    const importedItems = [];
    try {
      for (const item of productsToImport) {
        const sku = item.sku.trim().toUpperCase();
        const name = item.name.trim();
        const category = item.category.trim();
        const costPrice = parseFloat(item.cost_price);
        const sellingPrice = parseFloat(item.selling_price);
        const stockQty = parseInt(item.stock_quantity, 10);
        const minThreshold = parseInt(item.min_stock_threshold, 10);
        const unit = (item.unit || 'pcs').trim();

        // Insert into products table
        const insertRes = await db.runAsync(
          `INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [shopId, sku, name, category, costPrice, sellingPrice, stockQty, minThreshold, unit]
        );

        const newProductId = insertRes.lastID;

        // Record initial inventory audit log
        await db.runAsync(
          `INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
           VALUES (?, ?, 'BULK_IMPORT', ?, 0, ?, ?, ?)`,
          [shopId, newProductId, stockQty, stockQty, `Bulk CSV Catalog Import (${productsToImport.length} items)`, userId]
        );

        importedItems.push({
          id: newProductId,
          sku,
          name,
          stock_quantity: stockQty
        });
      }

      await db.runAsync('COMMIT;');
    } catch (txnError) {
      await db.runAsync('ROLLBACK;');
      throw txnError;
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${importedItems.length} products with initial inventory audit logs.`,
      imported_count: importedItems.length,
      products: importedItems
    });
  } catch (error) {
    console.error('[Import Controller - bulkImportProducts]:', error.message);
    res.status(500).json({
      success: false,
      error: 'An unexpected database error occurred during bulk product import.',
      details: error.message
    });
  }
}

/**
 * POST /api/import/sales
 * Transactional bulk import of historical sales records (Task T-2.3)
 * Supports multi-item orders grouped by invoice_number or (date + customer_name),
 * validates SKU catalog existence, and inserts into sales & sale_items in an atomic ACID transaction.
 */
async function bulkImportSales(req, res) {
  const shopId = req.user.shop_id;
  const userId = req.user.id;
  const deductStock = req.body?.options?.deduct_stock === true || req.body?.deduct_stock === true;

  try {
    let salesRows = [];

    // 1. Extract rows from either csv_data or sales array
    if (req.body?.csv_data && typeof req.body.csv_data === 'string') {
      const validation = validateSalesCsv(req.body.csv_data);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: 'Sales CSV validation failed. Please correct the flagged errors before importing.',
          validation_errors: validation.errors
        });
      }
      salesRows = validation.valid_rows;
    } else if (Array.isArray(req.body?.sales) && req.body.sales.length > 0) {
      salesRows = req.body.sales;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Please provide `csv_data` string or `sales` array in request body.'
      });
    }

    if (salesRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid sales records found to import.'
      });
    }

    // 2. Validate that all SKUs exist in the product catalog for this shop
    const uniqueSkus = [...new Set(salesRows.map(s => (s.sku || '').trim().toUpperCase()))];
    const placeholders = uniqueSkus.map(() => '?').join(',');
    const catalogRows = await db.allAsync(
      `SELECT id, sku, name, selling_price, stock_quantity 
       FROM products 
       WHERE shop_id = ? AND sku IN (${placeholders})`,
      [shopId, ...uniqueSkus]
    );

    const catalogMap = new Map();
    for (const prod of catalogRows) {
      catalogMap.set(prod.sku, prod);
    }

    const missingSkus = uniqueSkus.filter(sku => !catalogMap.has(sku));
    if (missingSkus.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Import failed: ${missingSkus.length} SKU(s) do not exist in your product catalog. Please create them before importing historical sales.`,
        missing_skus: missingSkus
      });
    }

    // 3. Group line items into orders
    const ordersMap = new Map();
    let autoInvoiceIndex = 1;

    for (const item of salesRows) {
      const cleanSku = item.sku.trim().toUpperCase();
      const product = catalogMap.get(cleanSku);
      const qty = parseInt(item.quantity, 10);
      const unitPrice = parseFloat(item.unit_price !== undefined ? item.unit_price : product.selling_price);
      const itemTotal = Number((qty * unitPrice).toFixed(2));
      const date = item.date;
      const customer = item.customer_name || 'Walk-in Customer';
      const payment = item.payment_method || 'cash';
      const discount = parseFloat(item.discount) || 0;

      let orderKey = item.invoice_number;
      if (!orderKey) {
        orderKey = `HIST-${date}-${customer}-${payment}`;
      }

      if (!ordersMap.has(orderKey)) {
        const orderInvoice = item.invoice_number || `INV-HIST-${Date.now().toString().slice(-6)}-${autoInvoiceIndex++}`;
        ordersMap.set(orderKey, {
          invoice_number: orderInvoice,
          date,
          customer_name: customer,
          payment_method: payment,
          discount,
          items: []
        });
      }

      ordersMap.get(orderKey).items.push({
        product_id: product.id,
        product_name: product.name,
        sku: cleanSku,
        quantity: qty,
        unit_price: unitPrice,
        total_price: itemTotal
      });
    }

    // 4. Execute atomic transaction (ACID)
    await db.runAsync('BEGIN TRANSACTION;');

    let totalOrdersCreated = 0;
    let totalItemsCreated = 0;
    let totalRevenue = 0;
    const dates = [];

    try {
      for (const order of ordersMap.values()) {
        const subtotal = Number(order.items.reduce((sum, it) => sum + it.total_price, 0).toFixed(2));
        const grandTotal = Math.max(0, Number((subtotal - (order.discount || 0)).toFixed(2)));
        const orderTimestamp = order.date.includes(' ') ? order.date : `${order.date} 12:00:00`;
        dates.push(order.date.split(' ')[0]);

        // Ensure invoice_number is globally unique
        let finalInvoiceNumber = order.invoice_number;
        const invoiceExists = await db.getAsync('SELECT id FROM sales WHERE invoice_number = ?', [finalInvoiceNumber]);
        if (invoiceExists) {
          finalInvoiceNumber = `${order.invoice_number}-${Date.now().toString().slice(-4)}`;
        }

        const saleResult = await db.runAsync(
          `INSERT INTO sales (shop_id, invoice_number, customer_name, subtotal, discount, total_amount, payment_method, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [shopId, finalInvoiceNumber, order.customer_name, subtotal, order.discount || 0, grandTotal, order.payment_method, userId, orderTimestamp]
        );

        const saleId = saleResult.lastID;
        totalOrdersCreated++;
        totalRevenue += grandTotal;

        for (const item of order.items) {
          await db.runAsync(
            `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total_price)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [saleId, item.product_id, item.product_name, item.quantity, item.unit_price, item.total_price]
          );
          totalItemsCreated++;

          if (deductStock) {
            const currentProd = await db.getAsync('SELECT stock_quantity FROM products WHERE id = ?', [item.product_id]);
            const prevStock = currentProd ? currentProd.stock_quantity : 0;
            const newStock = Math.max(0, prevStock - item.quantity);
            await db.runAsync('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, item.product_id]);
            await db.runAsync(
              `INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
               VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?)`,
              [shopId, item.product_id, -item.quantity, prevStock, newStock, `Historical Sale Import #${finalInvoiceNumber}`, userId]
            );
          }
        }
      }

      await db.runAsync('COMMIT;');
    } catch (txnErr) {
      await db.runAsync('ROLLBACK;');
      throw txnErr;
    }

    dates.sort();
    const dateRange = {
      start: dates.length > 0 ? dates[0] : null,
      end: dates.length > 0 ? dates[dates.length - 1] : null
    };

    res.status(201).json({
      success: true,
      message: `Successfully imported ${totalOrdersCreated} historical sales orders with ${totalItemsCreated} line items.`,
      total_orders: totalOrdersCreated,
      total_items: totalItemsCreated,
      total_revenue: Number(totalRevenue.toFixed(2)),
      date_range: dateRange
    });
  } catch (error) {
    console.error('[Import Controller - bulkImportSales Error]:', error.message);
    res.status(500).json({
      success: false,
      error: 'An unexpected database error occurred during historical sales batch import.',
      details: error.message
    });
  }
}

module.exports = {
  downloadProductTemplate,
  downloadSalesTemplate,
  previewProductCsv,
  previewSalesCsv,
  bulkImportProducts,
  bulkImportSales
};

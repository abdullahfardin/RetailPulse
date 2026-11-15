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

module.exports = {
  downloadProductTemplate,
  downloadSalesTemplate,
  previewProductCsv,
  previewSalesCsv,
  bulkImportProducts
};

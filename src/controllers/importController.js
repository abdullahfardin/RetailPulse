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

module.exports = {
  downloadProductTemplate,
  downloadSalesTemplate,
  previewProductCsv,
  previewSalesCsv
};

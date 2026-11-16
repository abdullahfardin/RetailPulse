const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const { authenticateToken } = require('../middleware/auth');

// Public CSV template downloads
router.get('/template/products', importController.downloadProductTemplate);
router.get('/template/sales', importController.downloadSalesTemplate);

// Preview and validation endpoints (protected by auth)
router.post('/preview-products', authenticateToken, importController.previewProductCsv);
router.post('/preview-sales', authenticateToken, importController.previewSalesCsv);

// Transactional Bulk Import endpoints (Tasks T-2.2 & T-2.3)
router.post('/products', authenticateToken, importController.bulkImportProducts);
router.post('/sales', authenticateToken, importController.bulkImportSales);

module.exports = router;

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');

// All dashboard & analytics routes require authentication
router.use(authenticateToken);

// Analytics KPI & Charting endpoints
router.get('/stats', dashboardController.getDashboardStats);
router.get('/sales-trend', dashboardController.getSalesTrend);
router.get('/top-products', dashboardController.getTopProducts);
router.get('/category-distribution', dashboardController.getCategoryDistribution);

// Inventory Planning & Alert endpoints (FR 16)
router.get('/low-stock-alerts', dashboardController.getLowStockAlerts);
router.get('/audit-logs', dashboardController.getAuditLogs);

// Export report endpoint (FR 17)
router.get('/export-report', dashboardController.exportReportCsv);

module.exports = router;

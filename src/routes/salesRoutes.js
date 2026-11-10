const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authenticateToken } = require('../middleware/auth');

// All sales routes require authentication
router.use(authenticateToken);

// Sales endpoints
router.post('/', salesController.createSale);
router.get('/', salesController.getSalesHistory);
router.get('/:id', salesController.getSaleById);

module.exports = router;

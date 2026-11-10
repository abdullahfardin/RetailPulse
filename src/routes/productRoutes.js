const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken } = require('../middleware/auth');

// All product routes require valid JWT authentication
router.use(authenticateToken);

// Aggregate stats and category helpers
router.get('/stats', productController.getProductStats);
router.get('/categories', productController.getCategories);

// Standard CRUD endpoints
router.get('/', productController.getProducts);
router.get('/:id', productController.getProductById);
router.post('/', productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

// Stock adjustment endpoint
router.post('/:id/adjust-stock', productController.adjustStock);

module.exports = router;

const express = require('express');
const router = express.Router();
const forecastController = require('../controllers/forecastController');
const { authenticateToken } = require('../middleware/auth');

// All forecast endpoints require authenticated tenant session
router.use(authenticateToken);

// Time-series inspection endpoints (Task T-3.2)
router.get('/time-series/:productId', forecastController.getProductTimeSeries);
router.get('/category-series/:category', forecastController.getCategoryTimeSeries);

module.exports = router;

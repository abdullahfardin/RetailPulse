const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { authenticateToken } = require('../middleware/auth');

// Public or authenticated status check
router.get('/status', agentController.getAgentStatus);

// Protected conversational AI chat endpoint
router.post('/chat', authenticateToken, agentController.processChat);

module.exports = router;

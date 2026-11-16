const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { authenticateToken } = require('../middleware/auth');

// Public or authenticated status check
router.get('/status', agentController.getAgentStatus);

// Protected conversational AI chat endpoint
router.post('/chat', authenticateToken, agentController.processChat);

// Explicit Confirmation Protocol endpoints (Safety Gate)
router.get('/confirmations', authenticateToken, agentController.listConfirmations);
router.get('/confirm/:token', authenticateToken, agentController.getConfirmation);
router.post('/confirm', authenticateToken, agentController.confirmAction);

module.exports = router;

const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { authenticateToken } = require('../middleware/auth');

// Public or authenticated status check
router.get('/status', agentController.getAgentStatus);

// Protected conversational AI chat endpoint
router.post('/chat', authenticateToken, agentController.processChat);

// Explicit Confirmation Protocol endpoints (Safety Gate - Task T-1.3)
router.get('/confirmations', authenticateToken, agentController.listConfirmations);
router.get('/confirm/:token', authenticateToken, agentController.getConfirmation);
router.post('/confirm', authenticateToken, agentController.confirmAction);

// Observability & AI Action Audit Trail endpoints (Task T-1.4)
router.get('/logs', authenticateToken, agentController.getAgentLogs);
router.get('/logs/:id', authenticateToken, agentController.getAgentLogDetails);
router.get('/analytics', authenticateToken, agentController.getAgentAnalytics);

module.exports = router;

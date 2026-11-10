const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'retailpulse_capstone_jwt_super_secret_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer <token>

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. No authentication token provided.'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired authentication token. Please log in again.'
      });
    }

    // Attach user payload to request for downstream handlers
    req.user = decodedUser;
    next();
  });
}

module.exports = {
  authenticateToken,
  JWT_SECRET
};

const crypto = require('crypto');
const { db } = require('../config/database');

/**
 * In-memory pending confirmation store with TTL expiration (5 minutes)
 * Key: token, Value: { token, shop_id, user_id, action, payload, summary, created_at, expires_at }
 */
const pendingConfirmations = new Map();
const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clean up expired tokens periodically
 */
function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, data] of pendingConfirmations.entries()) {
    if (data.expires_at <= now) {
      pendingConfirmations.delete(token);
    }
  }
}

/**
 * Generate unique secure confirmation token (e.g., CONF-A1B2C3D4)
 */
function generateConfirmationToken() {
  return `CONF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Register a sensitive action requiring explicit user confirmation
 * @param {number} shopId 
 * @param {number} userId 
 * @param {string} action - 'deleteProduct', 'updateStock'
 * @param {Object} payload - arguments needed for final execution
 * @param {string} summary - human-readable description for UI prompt
 */
function createPendingConfirmation(shopId, userId, action, payload, summary) {
  cleanupExpiredTokens();

  const token = generateConfirmationToken();
  const now = Date.now();
  const entry = {
    token,
    shop_id: shopId,
    user_id: userId,
    action,
    payload,
    summary,
    created_at: now,
    expires_at: now + CONFIRMATION_TTL_MS
  };

  pendingConfirmations.set(token, entry);

  return {
    token,
    action,
    summary,
    warning: 'Explicit confirmation required before executing this sensitive change.',
    expires_in_seconds: Math.floor(CONFIRMATION_TTL_MS / 1000),
    created_at: new Date(now).toISOString()
  };
}

/**
 * Retrieve pending confirmation ensuring shop tenant isolation
 */
function getPendingConfirmation(token, shopId) {
  cleanupExpiredTokens();
  if (!token) return null;

  const entry = pendingConfirmations.get(token.toUpperCase());
  if (!entry) {
    return null;
  }

  if (entry.shop_id !== shopId) {
    return null; // Cross-tenant access blocked
  }

  if (entry.expires_at <= Date.now()) {
    pendingConfirmations.delete(entry.token);
    return null;
  }

  return entry;
}

/**
 * List all active pending confirmations for a shop
 */
function listPendingConfirmations(shopId) {
  cleanupExpiredTokens();
  const list = [];
  const now = Date.now();

  for (const entry of pendingConfirmations.values()) {
    if (entry.shop_id === shopId && entry.expires_at > now) {
      list.push({
        token: entry.token,
        action: entry.action,
        summary: entry.summary,
        created_at: new Date(entry.created_at).toISOString(),
        expires_at: new Date(entry.expires_at).toISOString(),
        expires_in_seconds: Math.max(0, Math.floor((entry.expires_at - now) / 1000))
      });
    }
  }

  return list;
}

/**
 * Cancel a pending confirmation
 */
function cancelPendingConfirmation(token, shopId) {
  const entry = getPendingConfirmation(token, shopId);
  if (!entry) {
    return false;
  }
  pendingConfirmations.delete(entry.token);
  return true;
}

/**
 * Execute the confirmed sensitive action against database inside an ACID transaction
 */
async function executeConfirmedAction(token, shopId, userId) {
  const entry = getPendingConfirmation(token, shopId);
  if (!entry) {
    throw new Error('Invalid or expired confirmation token. Please request the action again.');
  }

  // Consume token so it cannot be re-used (anti-replay guarantee)
  pendingConfirmations.delete(entry.token);

  const { action, payload } = entry;

  switch (action) {
    case 'deleteProduct': {
      const { productId, sku } = payload;
      const product = await db.getAsync(
        'SELECT id, name, sku, stock_quantity FROM products WHERE (id = ? OR sku = ?) AND shop_id = ?',
        [productId || null, sku || null, shopId]
      );

      if (!product) {
        throw new Error('Product not found or already deleted in this shop.');
      }

      await db.runAsync('BEGIN TRANSACTION;');
      try {
        await db.runAsync('DELETE FROM products WHERE id = ? AND shop_id = ?', [product.id, shopId]);
        await db.runAsync('COMMIT;');
      } catch (err) {
        await db.runAsync('ROLLBACK;');
        throw err;
      }

      return {
        action: 'deleteProduct',
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        result: `Successfully deleted product "${product.name}" (${product.sku}).`
      };
    }

    case 'updateStock': {
      const { productId, sku, actionType, quantity, reason } = payload;
      const product = await db.getAsync(
        'SELECT id, name, sku, stock_quantity FROM products WHERE (id = ? OR sku = ?) AND shop_id = ?',
        [productId || null, sku || null, shopId]
      );

      if (!product) {
        throw new Error('Product not found in this shop.');
      }

      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('Quantity must be an integer greater than 0.');
      }

      const isDeduct = actionType === 'DEDUCT';
      const previousStock = product.stock_quantity;
      let newStock = previousStock;

      if (isDeduct) {
        if (previousStock < qty) {
          throw new Error(`Cannot deduct ${qty} units. Only ${previousStock} units currently available.`);
        }
        newStock = previousStock - qty;
      } else {
        newStock = previousStock + qty;
      }

      await db.runAsync('BEGIN TRANSACTION;');
      try {
        await db.runAsync(
          'UPDATE products SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND shop_id = ?',
          [newStock, product.id, shopId]
        );
        await db.runAsync(
          `INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            product.id,
            isDeduct ? 'DEDUCT' : 'ADD',
            isDeduct ? -qty : qty,
            previousStock,
            newStock,
            reason || `AI Confirmed Stock ${isDeduct ? 'Deduction' : 'Restock'}`,
            userId
          ]
        );
        await db.runAsync('COMMIT;');
      } catch (err) {
        await db.runAsync('ROLLBACK;');
        throw err;
      }

      return {
        action: 'updateStock',
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        action_type: isDeduct ? 'DEDUCT' : 'ADD',
        quantity: qty,
        previous_stock: previousStock,
        new_stock: newStock,
        result: `Successfully ${isDeduct ? 'deducted' : 'restocked'} ${qty} units for "${product.name}". New stock: ${newStock}.`
      };
    }

    default:
      throw new Error(`Unsupported sensitive action: "${action}"`);
  }
}

module.exports = {
  createPendingConfirmation,
  getPendingConfirmation,
  listPendingConfirmations,
  cancelPendingConfirmation,
  executeConfirmedAction,
  _pendingConfirmations: pendingConfirmations // Exposed for testing
};

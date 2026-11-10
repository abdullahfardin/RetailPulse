const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'retailpulse.db');
const db = new sqlite3.Database(DB_PATH);

// Promise helpers for clean async/await
db.runAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    this.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

db.getAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    this.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
};

db.allAsync = function (sql, params = []) {
  return new Promise((resolve, reject) => {
    this.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

// Initialize schema
async function initDatabase() {
  try {
    await db.runAsync('PRAGMA foreign_keys = ON;');
    await db.runAsync('PRAGMA journal_mode = WAL;');

    // 1. Shops table
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        currency TEXT DEFAULT 'BDT',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Users table
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'owner',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
      )
    `);

    // 3. Products table
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER NOT NULL,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        cost_price REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        min_stock_threshold INTEGER NOT NULL DEFAULT 5,
        unit TEXT DEFAULT 'pcs',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
        UNIQUE (shop_id, sku)
      )
    `);

    // 4. Inventory logs table (tracks all stock adjustments and sale deductions)
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        change_type TEXT NOT NULL, -- 'ADD', 'DEDUCT', 'SALE', 'CORRECTION'
        quantity_change INTEGER NOT NULL,
        previous_stock INTEGER NOT NULL,
        new_stock INTEGER NOT NULL,
        reason TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // 5. Sales & Sale items tables (ready for Member 2)
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER NOT NULL,
        invoice_number TEXT NOT NULL UNIQUE,
        customer_name TEXT DEFAULT 'Walk-in Customer',
        subtotal REAL NOT NULL,
        discount REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        unit_price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        total_price REAL NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    // Seed default shop and demo user if database is empty
    await seedDemoData();
    console.log('[Database] SQLite schema verified and ready at:', DB_PATH);
  } catch (error) {
    console.error('[Database] Initialization error:', error);
    throw error;
  }
}

async function seedDemoData() {
  const existingUser = await db.getAsync('SELECT id FROM users LIMIT 1');
  if (existingUser) return; // Already seeded

  console.log('[Database] Seeding initial demo data...');
  // 1. Create demo shop
  const shopResult = await db.runAsync(`
    INSERT INTO shops (name, address, phone, currency)
    VALUES ('Pulse Mart - Dhanmondi', 'Road 27, Dhanmondi, Dhaka', '+8801700000000', 'BDT')
  `);
  const shopId = shopResult.lastID;

  // 2. Create demo owner with bcrypt password hash
  const hashedPassword = await bcrypt.hash('password123', 10);
  const userResult = await db.runAsync(`
    INSERT INTO users (shop_id, name, email, password_hash, role)
    VALUES (?, 'Abdullah Al Junaed', 'owner@retailpulse.com', ?, 'owner')
  `, [shopId, hashedPassword]);

  // 3. Create initial sample products
  const sampleProducts = [
    { sku: 'BEV-001', name: 'Coca-Cola (500ml)', category: 'Beverages', cost: 35.0, price: 45.0, stock: 48, min: 10, unit: 'bottle' },
    { sku: 'BEV-002', name: 'Fresh Drinking Water (1L)', category: 'Beverages', cost: 18.0, price: 25.0, stock: 8, min: 15, unit: 'bottle' }, // Low stock!
    { sku: 'GRO-001', name: 'Fortune Cooking Oil (1L)', category: 'Groceries', cost: 155.0, price: 175.0, stock: 24, min: 8, unit: 'bottle' },
    { sku: 'GRO-002', name: 'Pran Basmati Rice (1kg)', category: 'Groceries', cost: 110.0, price: 130.0, stock: 40, min: 10, unit: 'pack' },
    { sku: 'SNK-001', name: 'Lays Potato Chips (50g)', category: 'Snacks', cost: 28.0, price: 35.0, stock: 3, min: 12, unit: 'packet' }, // Low stock!
    { sku: 'SNK-002', name: 'Oreo Biscuits (120g)', category: 'Snacks', cost: 42.0, price: 50.0, stock: 35, min: 10, unit: 'pack' },
    { sku: 'DAI-001', name: 'Aarong Pasteurised Milk (1L)', category: 'Dairy', cost: 85.0, price: 95.0, stock: 0, min: 6, unit: 'carton' }, // Out of stock!
    { sku: 'DAI-002', name: 'Amul Salted Butter (200g)', category: 'Dairy', cost: 180.0, price: 210.0, stock: 15, min: 5, unit: 'pack' }
  ];

  for (const p of sampleProducts) {
    const pResult = await db.runAsync(`
      INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [shopId, p.sku, p.name, p.category, p.cost, p.price, p.stock, p.min, p.unit]);

    await db.runAsync(`
      INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
      VALUES (?, ?, 'INITIAL', ?, 0, ?, 'Initial inventory stock intake', ?)
    `, [shopId, pResult.lastID, p.stock, p.stock, userResult.lastID]);
  }

  console.log('[Database] Demo data seeded successfully.');
}

module.exports = {
  db,
  initDatabase
};

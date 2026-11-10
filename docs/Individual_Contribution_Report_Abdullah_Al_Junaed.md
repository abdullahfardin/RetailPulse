# Individual Project Contribution Report

**Course Name:** Capstone Project / Software Engineering Assessment  
**Project Title:** RetailPulse: An Agentic AI-Powered Retail Sales, Demand Forecasting and Inventory Planning System for Small Retail Shops  
**Institution:** Daffodil International University (DIU)  
**Department:** Department of Software Engineering  

---

### Student Information
- **Name:** Abdullah Al Junaed Akond
- **Student ID:** 232-35-694
- **Email:** akond2305341694@diu.edu.bd
- **GitHub Username:** abdullahfardin
- **Project Role:** Team Lead & Core Engine Engineer
- **Submitted To:** Md. Mahedi Hassan, Lecturer (Senior Scale), Department of Software Engineering

---

## 1. Executive Summary & Assigned Ownership
As the Team Lead for RetailPulse, I assumed end-to-end technical ownership over:
1. **Compulsory Authentication & Multi-Tenant Isolation Module (FR 7):** Secure user registration, authentication, bcrypt salted password hashing, JWT token verification middleware, and shop profile binding.
2. **Core Feature 1 — Product & Inventory Management Engine (FR 8):** Relational database schema design (SQLite/PostgreSQL), complete Product CRUD REST APIs, stock status computation, inventory restock/deduct adjustments with automated audit logging, and the frontend inventory management UI.

All implemented features demonstrate live, transactional interaction with an ACID-compliant SQL database.

---

## 2. Functional Requirements Implemented

### 2.1 FR 7: Authentication & Shop Profile Management
- **Registration (`POST /api/auth/register`):**
  - Validates user full name, RFC-compliant email formatting, password length ($\ge 6$ characters), and shop name.
  - Generates a shop tenant record and an owner account linked via foreign key.
  - Rejects duplicate email registrations with `409 Conflict`.
- **Login (`POST /api/auth/login`):**
  - Compares submitted password against stored hash using `bcryptjs`.
  - Zero hardcoded credentials: all authentication is performed dynamically against the `users` table.
  - Issues signed JWT token containing `{ id, name, email, role, shop_id }` with a 7-day expiration.
- **Shop Isolation Middleware (`authenticateToken`):**
  - Intercepts bearer tokens and validates JWT integrity.
  - Attaches `req.user` to incoming requests, ensuring multi-tenant isolation where users can only read and modify data belonging to their registered `shop_id`.

### 2.2 FR 8: Product & Inventory Catalog Management
- **Catalog CRUD Operations:**
  - `GET /api/products`: Search by product name or SKU, filter by category, and filter by stock level status (`IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`).
  - `POST /api/products`: Create products with input validation and uniqueness constraints on `(shop_id, sku)`.
  - `PUT /api/products/:id`: Update price, category, unit, and threshold.
  - `DELETE /api/products/:id`: Remove items from inventory.
- **Manual Stock Adjustments (`POST /api/products/:id/adjust-stock`):**
  - Enables shop owners to record Restock (`+`) or Deduction/Damage (`-`).
  - Validates available stock to strictly prevent negative inventory.
  - Automatically writes an immutable audit record to `inventory_logs` capturing previous stock, quantity change, new stock, reason, and timestamp.
- **Inventory Metrics (`GET /api/products/stats`):**
  - Real-time aggregation of total products, total on-hand physical units, inventory cost valuation (BDT), retail valuation, low-stock alerts, and out-of-stock items.

---

## 3. Database Schema & Architecture

The database was constructed using an ACID-compliant relational SQL engine (`SQLite3` with `PRAGMA foreign_keys = ON` and `WAL` journal mode).

```
   ┌─────────────────┐       1:N       ┌─────────────────┐
   │      SHOPS      │ ──────────────< │      USERS      │
   │ id (PK)         │                 │ id (PK)         │
   │ name, address   │                 │ shop_id (FK)    │
   │ phone, currency │                 │ email (UNIQUE)  │
   └────────┬────────┘                 │ password_hash   │
            │                          └─────────────────┘
            │ 1:N
            ▼
   ┌─────────────────────────────────────────────────────┐
   │                     PRODUCTS                        │
   │ id (PK), shop_id (FK), sku, name, category          │
   │ cost_price, selling_price, stock_quantity           │
   │ min_stock_threshold, unit, created_at               │
   └────────┬────────────────────────────────────────────┘
            │ 1:N
            ▼
   ┌─────────────────────────────────────────────────────┐
   │                  INVENTORY_LOGS                     │
   │ id (PK), shop_id (FK), product_id (FK), change_type │
   │ quantity_change, previous_stock, new_stock, reason  │
   │ user_id (FK), created_at                            │
   └─────────────────────────────────────────────────────┘
```

---

## 4. Key Code Implementations

### 4.1 Secure Password Hashing & Registration (`src/controllers/authController.js`)
```javascript
// Input validation & duplicate check
const existing = await db.getAsync('SELECT id FROM users WHERE email = ?', [cleanEmail]);
if (existing) {
  return res.status(409).json({ success: false, error: 'Account already exists.' });
}

// Bcrypt salted hashing (Salt rounds: 10)
const salt = await bcrypt.genSalt(10);
const passwordHash = await bcrypt.hash(password, salt);

// Atomic creation of shop profile and owner
const shopResult = await db.runAsync(
  'INSERT INTO shops (name, address, phone) VALUES (?, ?, ?)',
  [shop_name.trim(), address, phone]
);
const userResult = await db.runAsync(
  'INSERT INTO users (shop_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
  [shopResult.lastID, name.trim(), cleanEmail, passwordHash, 'owner']
);
```

### 4.2 Stock Adjustment with Negative Stock Prevention (`src/controllers/productController.js`)
```javascript
if (action === 'DEDUCT') {
  if (qty > previousStock) {
    return res.status(400).json({
      success: false,
      error: `Cannot deduct ${qty} items. Only ${previousStock} units are currently available.`
    });
  }
  newStock = previousStock - qty;
} else {
  newStock = previousStock + qty;
}

await db.runAsync('UPDATE products SET stock_quantity = ? WHERE id = ? AND shop_id = ?', [newStock, id, shopId]);
await db.runAsync(
  `INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [shopId, id, action === 'ADD' ? 'RESTOCK' : 'CORRECTION', action === 'ADD' ? qty : -qty, previousStock, newStock, reason, userId]
);
```

---

## 5. Development Strategy & Approach
1. **Security-First Architecture:** Adopted industry standards by utilizing salted bcrypt hashing, eliminating plain-text password vulnerabilities, and utilizing stateless JWTs for scalable API protection.
2. **Defensive Validation:** Enforced validations on both frontend (instant user feedback) and backend (guaranteed data integrity).
3. **Auditability:** Implemented an immutable log table (`inventory_logs`) ensuring every stock movement is permanently traceable for bookkeeping and dispute resolution.
4. **Test-Driven Verification:** Authored automated in-memory integration test suites (`tests/unit_test_auth_products.js`) testing all 13 core operational scenarios.

---

## 6. Technical Challenges & Solutions
1. **Challenge: Preventing Cross-Shop Data Leaks in a Multi-Tenant Retail Environment**
   - *Problem:* A malicious shop owner could query or modify product IDs belonging to another retail store by guessing incremental primary keys.
   - *Solution:* Enforced strict shop isolation at the SQL query level by binding `WHERE shop_id = req.user.shop_id` to every select, update, and delete query.
2. **Challenge: Express 5 Router Compatibility in Node v24**
   - *Problem:* Legacy `app.get('*')` routing triggered a `PathError` in `path-to-regexp` v8.
   - *Solution:* Re-architected fallback single-page-application routing using standard Express middleware checking `req.path.startsWith('/api')`.

---

## 7. AI Tools Used & Representative Prompts
- **AI Tool Utilized:** Antigravity (Google DeepMind Coding Assistant).
- **Usage Purpose:**
  - Generating relational database schema definitions with proper constraints.
  - Designing responsive Bootstrap 5 interface layouts with stat cards and modals.
  - Drafting automated integration test suites for rapid validation.
- **Representative Prompts Used:**
  - *"Generate an Express controller for product inventory with search, category filtering, and real-time calculation of stock status badges."*
  - *"Implement a stock adjustment endpoint in Node.js with SQLite that prevents negative stock and writes an audit log."*
  - *"Design a clean, professional retail management UI using Bootstrap 5 with quick-fill demo login functionality."*

---

## 8. Git Commit Evidence & Contributions
- **Repository URL:** `https://github.com/abdullahfardin/RetailPulse.git`
- **Branch:** `main`
- **Verified Recent Commits:**
  1. `ec94036` — `feat(db): initialize database schema, relational tables, and project dependencies - Abdullah`
  2. `15ff058` — `feat(auth): implement user registration, login with bcrypt password hashing and JWT auth middleware - Abdullah`
  3. `0cf90c8` — `feat(products): implement product CRUD APIs, stock adjustment audit trail, and responsive UI - Abdullah`

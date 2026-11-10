# Individual Project Contribution Report

**Course Name:** Capstone Project / Software Engineering Assessment  
**Project Title:** RetailPulse: An Agentic AI-Powered Retail Sales, Demand Forecasting and Inventory Planning System for Small Retail Shops  
**Institution:** Daffodil International University (DIU)  
**Department:** Department of Software Engineering  

---

### Student Information
- **Name:** Nazrin Sultana Omi
- **Student ID:** 232-35-691
- **Email:** omi2305341691@diu.edu.bd
- **Project Role:** Sales Processing, Billing & Transaction Engine Engineer
- **Submitted To:** Md. Mahedi Hassan, Lecturer (Senior Scale), Department of Software Engineering

---

## 1. Executive Summary & Assigned Ownership
In the RetailPulse system, I held technical ownership over:
1. **Core Feature 2 — Sales & Billing Transaction Processing Engine (FR 9 & FR 10):** Multi-item point of sale (POS) operations, real-time stock availability verification, and atomic database checkout transactions with rollback protection.
2. **Audit & Sales Records Module (FR 14):** Itemized transaction history (`sales` and `sale_items`), receipt reconstruction, and immutable stock decrement logging in `inventory_logs`.
3. **Point of Sale (POS) User Interface:** Dual-pane sales terminal (`/sales.html`) featuring live cart management, instant discount calculations, payment method selection, printable digital receipt generator, and sales history viewer.

All features interact directly with our relational SQL database via atomic transactions.

---

## 2. Functional Requirements Implemented

### 2.1 FR 9: Manual Sales Entry & Point of Sale (POS) Billing
- Developed a dual-pane billing terminal where shop cashiers can quickly search or filter inventory items and add them to a live cart with a single click.
- Integrated quantity increment/decrement controls that respect real-time available stock limits.
- Supports customer name tagging and multiple retail payment options (Cash, Card, MFS / bKash / Nagad).
- Live calculation of subtotal, flat cash discount, and final total payable.

### 2.2 FR 10: Input Validation & Atomic Inventory Deduction
- **Pre-Transaction Validation:**
  - Validates that the cart contains at least one item.
  - Verifies that every product exists within the authenticated shop's catalog.
  - Compares requested quantity against `stock_quantity` in the database to prevent overselling or negative stock balances.
- **ACID Transaction Implementation (`POST /api/sales`):**
  - Begins a formal transaction (`BEGIN TRANSACTION;`).
  - Generates a unique invoice number (`INV-XXXXXX-XXX`).
  - Writes the master sales receipt to `sales`.
  - Iterates through line items to insert each into `sale_items`, decrement `products.stock_quantity`, and write an audit entry to `inventory_logs` with change type `'SALE'`.
  - Commits the transaction (`COMMIT;`).
  - If any unexpected error or database lock occurs, executes a full rollback (`ROLLBACK;`) to ensure zero inventory discrepancies.

### 2.3 FR 14: Sales History & Receipt Generation
- `GET /api/sales`: Lists transaction history with cashier identity, item counts, payment methods, and timestamps.
- `GET /api/sales/:id`: Retrieves full receipt breakdown with itemized line prices.
- Formatted digital receipt modal with store details and CSS thermal print capabilities (`window.print()`).

---

## 3. Database Interaction & Transaction Flow

```
   [ Cashier Checkout ]
          │
          ▼
   1. Validate Stock Level for ALL Items
          │
          ├── If any item Insufficient Stock ──► Return 400 Bad Request (Cancel)
          │
          ▼
   2. BEGIN TRANSACTION
          │
          ├── INSERT INTO sales (Invoice, Subtotal, Discount, Total, Payment)
          │
          ├── FOR EACH ITEM:
          │     ├── INSERT INTO sale_items (sale_id, product_id, unit_price, qty, total)
          │     ├── UPDATE products SET stock_quantity = stock_quantity - qty
          │     └── INSERT INTO inventory_logs (change_type = 'SALE', qty_change = -qty)
          │
          ▼
   3. COMMIT TRANSACTION ──► Issue Receipt
          │
     [On Failure]
          ▼
      ROLLBACK ──► No Stock Changed, Zero Data Inconsistency
```

---

## 4. Key Code Implementations

### 4.1 Atomic Sales Checkout & Stock Deduction (`src/controllers/salesController.js`)
```javascript
// Pre-check stock before touching database
for (const item of items) {
  const product = await db.getAsync(
    'SELECT id, name, selling_price, stock_quantity FROM products WHERE id = ? AND shop_id = ?',
    [item.product_id, shopId]
  );
  if (product.stock_quantity < item.quantity) {
    return res.status(400).json({
      success: false,
      error: `Insufficient stock for '${product.name}'. Available: ${product.stock_quantity}`
    });
  }
}

// Atomic Database Transaction
await db.runAsync('BEGIN TRANSACTION;');
try {
  const saleResult = await db.runAsync(
    `INSERT INTO sales (shop_id, invoice_number, customer_name, subtotal, discount, total_amount, payment_method, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [shopId, invoiceNumber, customerName, calculatedSubtotal, discountAmount, grandTotal, paymentMethod, userId]
  );

  for (const validItem of itemValidations) {
    const p = validItem.product;
    const newStock = p.stock_quantity - validItem.quantity;

    await db.runAsync(
      `INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, total_price)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [saleResult.lastID, p.id, p.name, validItem.unitPrice, validItem.quantity, validItem.lineTotal]
    );

    await db.runAsync(
      'UPDATE products SET stock_quantity = ? WHERE id = ? AND shop_id = ?',
      [newStock, p.id, shopId]
    );

    await db.runAsync(
      `INSERT INTO inventory_logs (shop_id, product_id, change_type, quantity_change, previous_stock, new_stock, reason, user_id)
       VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?)`,
      [shopId, p.id, -validItem.quantity, p.stock_quantity, newStock, `Sale Invoice #${invoiceNumber}`, userId]
    );
  }

  await db.runAsync('COMMIT;');
} catch (error) {
  await db.runAsync('ROLLBACK;');
  throw error;
}
```

---

## 5. Development Strategy & Approach
1. **Transaction Integrity:** Ensured that sales operations adhere to ACID properties (Atomicity, Consistency, Isolation, Durability) to eliminate partial updates.
2. **Defensive Inventory Management:** Enforced multi-layer stock checks (UI disables adding beyond available stock, backend rejects requests if concurrent purchases deplete inventory).
3. **Optimized POS UX:** Designed a responsive POS interface that minimizes cashier clicks, provides instant keyboard search, and formats thermal-printable bills.
4. **Automated Unit Testing:** Created test suite (`tests/unit_test_sales.js`) verifying multi-item transactions, inventory decrement, oversell prevention, and receipt generation.

---

## 6. Technical Challenges & Solutions
1. **Challenge: Preventing Partial Data Writes during Multi-Item Checkout**
   - *Problem:* In a multi-item purchase (e.g. 5 products), if item 4 encountered an error, items 1–3 would have deducted stock without an invoice, corrupting the inventory.
   - *Solution:* Wrapped the entire routine inside an explicit `BEGIN TRANSACTION;` and `COMMIT;` block with a catch handler executing `ROLLBACK;`.
2. **Challenge: Thermal Receipt Printing without Page Elements**
   - *Problem:* Browser `window.print()` prints navbars, cart buttons, and page backgrounds.
   - *Solution:* Added scoped `@media print` CSS rules hiding all non-receipt elements, ensuring clean 80mm/standard receipt printouts.

---

## 7. AI Tools Used & Representative Prompts
- **AI Tool Utilized:** Antigravity (Google DeepMind Coding Assistant).
- **Usage Purpose:**
  - Designing POS dual-pane flexbox/grid layout and printable invoice CSS.
  - Formulating transactional SQL queries with rollback error handling.
  - Writing automated test cases for inventory boundary conditions.
- **Representative Prompts Used:**
  - *"Implement a Node.js Express controller for Point of Sale transactions using SQLite BEGIN TRANSACTION and ROLLBACK."*
  - *"Create a responsive POS cart interface with real-time subtotal, discount, and grand total updates."*
  - *"Write CSS for a clean printable retail receipt that looks like a thermal bill when window.print() is called."*

---

## 8. Git Commit Evidence & Contributions
- **Repository URL:** `https://github.com/abdullahfardin/RetailPulse.git`
- **Branch:** `main`
- **Verified Commits under Nazrin Sultana Omi (`omi2305341691@diu.edu.bd`):**
  1. `feat(sales-api): implement atomic sales transaction controller with stock deduction and rollback - Nazrin`
  2. `feat(pos-ui): build interactive point-of-sale billing interface, cart manager, and receipt generator - Nazrin`
  3. `docs: add individual project contribution report for Nazrin Sultana Omi - Nazrin`

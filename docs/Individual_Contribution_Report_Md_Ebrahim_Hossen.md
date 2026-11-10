# Individual Project Contribution Report

**Course Name:** Capstone Project / Software Engineering Assessment  
**Project Title:** RetailPulse: An Agentic AI-Powered Retail Sales, Demand Forecasting and Inventory Planning System for Small Retail Shops  
**Institution:** Daffodil International University (DIU)  
**Department:** Department of Software Engineering  

---

### Student Information
- **Name:** Md Ebrahim Hossen
- **Student ID:** 232-35-711
- **Email:** hossen2305341711@diu.edu.bd
- **Project Role:** Inventory Planning & Real-Time Analytics Engineer
- **Submitted To:** Md. Mahedi Hassan, Lecturer (Senior Scale), Department of Software Engineering

---

## 1. Executive Summary & Assigned Ownership
As part of the RetailPulse engineering team, I owned the following technical components:
1. **Core Feature 3 — Inventory Planning & Low-Stock Alert Engine (FR 16):** Automated inventory threshold monitoring, stock deficit calculation, suggested reorder batch estimation, and inventory movement audit logs.
2. **Real-Time Dashboard & Analytics Module (FR 17):** High-performance SQL aggregation queries for store KPIs (daily revenue, order counts, valuation), daily sales trend tracking, top-selling product ranking, category distribution, and downloadable CSV report exports.
3. **Analytics User Interface:** Modern executive dashboard (`/dashboard.html`) featuring responsive Chart.js line charts and doughnut charts, top-sellers leaderboard, critical reorder alerts, and audit trail ledger.

All analytics are derived directly from transactional SQL queries against `sales`, `sale_items`, `products`, and `inventory_logs`.

---

## 2. Functional Requirements Implemented

### 2.1 FR 16: Inventory Planning & Stock Depletion Warnings
- **Real-Time Alert Detection (`GET /api/dashboard/low-stock-alerts`):**
  - Evaluates current `stock_quantity` against `min_stock_threshold`.
  - Classifies items into `CRITICAL_OUT_OF_STOCK` (0 units) and `WARNING_LOW_STOCK` ($\le$ threshold).
- **Mathematical Reorder Recommendation Formula:**
  - Designed an empirical reorder rule to assist non-technical store managers:
    $$\text{Suggested Reorder Qty} = \max\left(10, (2 \times \text{Threshold}) - \text{Current Stock} + \text{Safety Buffer (5)}\right)$$
  - Multiplies suggested units by product `cost_price` to provide an instant estimated cash outlay required for replenishment.
- **Audit Trail Traceability (`GET /api/dashboard/audit-logs`):**
  - Displays chronological stock movements (intake, sales, manual corrections) with operator names, quantities, and reasons.

### 2.2 FR 17: Executive Dashboard, Visual Charts & Export
- **Store KPIs (`GET /api/dashboard/stats`):**
  - Aggregates today's revenue, transaction volume, total catalog items, total physical units, wholesale cost valuation, retail valuation, and potential gross profit.
- **Daily Sales Velocity (`GET /api/dashboard/sales-trend`):**
  - Groups sales by calendar date over 7-day and 30-day horizons.
  - Feeds a dual-axis Chart.js line chart comparing Revenue in BDT against Order Velocity.
- **Top-Selling Leaderboard (`GET /api/dashboard/top-products`):**
  - Ranks products by units sold and gross sales amount using multi-table SQL joins (`products` $\to$ `sale_items` $\to$ `sales`).
- **Category Inventory Distribution (`GET /api/dashboard/category-distribution`):**
  - Groups stock quantities and valuation by retail category, feeding an interactive Chart.js doughnut chart.
- **Business Report Export (`GET /api/dashboard/export-report`):**
  - Generates downloadable CSV spreadsheets formatted with inventory pricing and stock health for offline accounting.

---

## 3. Architecture & Query Aggregation Flow

```
   ┌────────────────────────────────────────────────────────────┐
   │                  RELATIONAL SQL DATABASE                   │
   │  [sales]        [sale_items]    [products]  [inventory_logs]│
   └───────┬───────────────┬─────────────┬──────────────┬───────┘
           │               │             │              │
           ▼               ▼             ▼              ▼
   ┌────────────────────────────────────────────────────────────┐
   │              DASHBOARD AGGREGATION CONTROLLER              │
   │  • SUM(total_amount) by date(created_at)                   │
   │  • SUM(quantity) GROUP BY product_id ORDER BY sold DESC    │
   │  • Reorder formula: (min_threshold * 2) - stock + buffer   │
   └─────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │               EXECUTIVE FRONTEND DASHBOARD                 │
   │  • Chart.js Revenue & Order Velocity (Dual-Axis Line)      │
   │  • Chart.js Category Inventory Breakdown (Doughnut)        │
   │  • Top 5 Sellers Leaderboard & High-Priority Alerts Table  │
   │  • CSV Export & Movement Audit Trail Ledger                │
   └────────────────────────────────────────────────────────────┘
```

---

## 4. Key Code Implementations

### 4.1 Reorder Planning Formula (`src/controllers/dashboardController.js`)
```javascript
const alertProducts = await db.allAsync(`
  SELECT id, sku, name, category, cost_price, selling_price, stock_quantity,
         min_stock_threshold, unit,
         CASE
           WHEN stock_quantity <= 0 THEN 'CRITICAL_OUT_OF_STOCK'
           ELSE 'WARNING_LOW_STOCK'
         END as alert_level,
         (min_stock_threshold - stock_quantity) as deficit,
         MAX(10, ((min_stock_threshold * 2) - stock_quantity + 5)) as suggested_reorder_qty,
         MAX(10, ((min_stock_threshold * 2) - stock_quantity + 5)) * cost_price as estimated_reorder_cost
  FROM products
  WHERE shop_id = ? AND stock_quantity <= min_stock_threshold
  ORDER BY stock_quantity ASC, deficit DESC
`, [shopId]);
```

### 4.2 Top-Selling Ranking Query (`src/controllers/dashboardController.js`)
```javascript
const topProducts = await db.allAsync(`
  SELECT p.id, p.name, p.sku, p.category, p.selling_price, p.stock_quantity,
         COALESCE(SUM(si.quantity), 0) as units_sold,
         COALESCE(SUM(si.total_price), 0) as total_sales_amount
  FROM products p
  JOIN sale_items si ON p.id = si.product_id
  JOIN sales s ON si.sale_id = s.id
  WHERE s.shop_id = ?
  GROUP BY p.id
  ORDER BY units_sold DESC
  LIMIT ?
`, [shopId, limit]);
```

---

## 5. Development Strategy & Approach
1. **Database-Level Aggregation:** Executed all math and groupings inside SQL queries (`SUM`, `COUNT`, `MAX`, `COALESCE`) rather than in Node.js memory, ensuring sub-millisecond API response times.
2. **Actionable Decision Support:** Beyond displaying warnings, calculated explicit reorder quantities and estimated capital requirements so retailers can order stock with zero guesswork.
3. **Responsive Visualizations:** Integrated Chart.js with dual y-axes to provide clear separation between monetary revenue and discrete order counts.
4. **Automated Verification:** Authored unit integration tests (`tests/unit_test_dashboard.js`) verifying all 7 analytics functions against active database records.

---

## 6. Technical Challenges & Solutions
1. **Challenge: Rendering Continuous Timeline Charts When Days Have Zero Sales**
   - *Problem:* SQL `GROUP BY date(created_at)` only returns days with sales, resulting in gaps and broken timelines on charts.
   - *Solution:* Built a 7/30-day timeline generator in JavaScript that fills in `0` revenue and `0` orders for quiet days, guaranteeing smooth, continuous trend lines.
2. **Challenge: Efficient Top-Sellers SQL Joins Across Multi-Tenant Data**
   - *Problem:* Joining `products`, `sale_items`, and `sales` can lead to cross-shop contamination if not bounded correctly.
   - *Solution:* Constrained the join by `WHERE s.shop_id = ?`, ensuring complete tenant isolation.

---

## 7. AI Tools Used & Representative Prompts
- **AI Tool Utilized:** Antigravity (Google DeepMind Coding Assistant).
- **Usage Purpose:**
  - Formulating multi-table SQL queries with `COALESCE` and `GROUP BY`.
  - Configuring responsive dual-axis Chart.js line charts and doughnut legends.
  - Designing CSV export response headers and content serialization.
- **Representative Prompts Used:**
  - *"Write an optimized SQL query in SQLite to calculate top-selling products by quantity and revenue with shop isolation."*
  - *"Create a Chart.js dual-axis line chart in JavaScript showing daily revenue and transaction count."*
  - *"Design a low-stock alert calculation formula in Node.js that suggests replenishment quantities based on minimum safety stock."*

---

## 8. Git Commit Evidence & Contributions
- **Repository URL:** `https://github.com/abdullahfardin/RetailPulse.git`
- **Branch:** `main`
- **Verified Commits under Md Ebrahim Hossen (`hossen2305341711@diu.edu.bd`):**
  1. `feat(analytics-api): implement dashboard KPI aggregations, sales trend, and top products endpoints - Ebrahim`
  2. `feat(dashboard-ui): build executive analytics dashboard with Chart.js visualization and report export - Ebrahim`
  3. `docs: add individual project contribution report for Md Ebrahim Hossen - Ebrahim`

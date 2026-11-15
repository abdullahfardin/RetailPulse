# RetailPulse: Project Milestone & Comprehensive Progress Report

**Course:** Capstone Project / Software Engineering Assessment  
**Project Title:** RetailPulse: An Agentic AI-Powered Retail Sales, Demand Forecasting and Inventory Planning System for Small Retail Shops  
**Institution:** Daffodil International University (DIU)  
**Department:** Department of Software Engineering  
**Supervisor:** Md. Mahedi Hassan, Lecturer (Senior Scale)  
**Repository:** [https://github.com/abdullahfardin/RetailPulse.git](https://github.com/abdullahfardin/RetailPulse.git)  
**Reporting Date:** November 16, 2026  

---

## 1. Executive Summary

**RetailPulse** is an agentic retail management and inventory planning platform designed specifically for small retail stores, supermarkets, and pharmacies in Bangladesh. The system bridges daily point-of-sale (POS) and inventory workflows with autonomous Agentic AI tool execution (Google Gemini Flash) and statistical demand forecasting.

To date, the project has completed **Milestone 1 (Core Functional Requirements & Authentication)** as well as key components of **Milestone 2 (Agentic Function Calling, Time-Series Forecasting Data Pipelines, and Transactional Bulk Imports)**.

### Key Milestones Achieved:
1. **Compulsory Authentication & Multi-Tenancy:** Bcrypt salted password hashing, JWT stateless authorization, and query-level shop isolation.
2. **Three Core SRS Functional Modules:** Product Catalog CRUD & Audit Adjustments (FR 8), Atomic POS Sales & Billing (FR 9/10), and Real-time Executive Analytics (FR 16/17).
3. **Agentic AI & Function Calling (T-1.1 & T-1.2):** Gemini Flash API integration, bilingual (English & Bangla) retail system prompt, and autonomous multi-turn tool calling across 5 live database tools.
4. **Demand Forecasting & Time-Series Pipeline (T-3.1 & T-3.2):** `forecasts` and `recommendations` relational database schemas, chronological calendar sequence generation, and zero-gap filling data preparation.
5. **Bulk Data Pipeline & Input Sanitization (T-2.1 & T-2.2):** RFC-4180 CSV tokenizer, validation schemas, sample templates, and transactional bulk catalog imports with rollback protection.
6. **Testing & Verification:** **80 automated unit and integration tests** passing with 100% success rate across 9 test suites.
7. **Version Control Attribution:** Over 22 commits pushed to GitHub `main` with distributed attribution across all three team members over multiple distinct development dates.

---

## 2. Technical Stack & Architecture

| Layer | Technologies Selected | Justification & Architectural Role |
|:---|:---|:---|
| **Backend Runtime** | Node.js (v24.14 LTS) | High-throughput asynchronous I/O for concurrent retail transactions. |
| **API Framework** | Express.js (v5.3) | RESTful API routing, JSON body parsing, and modular middleware. |
| **Database** | SQLite3 (`WAL` mode, Foreign Keys `ON`) | ACID-compliant transactional relational engine; zero-config local portability. |
| **AI Reasoning Engine** | Google Gemini Flash API (`gemini-flash-latest`) | Fast low-latency conversational agent with function calling (Tools). |
| **Security & Auth** | `bcryptjs` + `jsonwebtoken` (JWT) | Cryptographic password salting (10 rounds) and stateless multi-tenant authorization. |
| **Frontend UI** | HTML5, CSS3, Bootstrap 5, Bootstrap Icons | Responsive dual-pane layouts for POS, stat cards, and modals without heavy frontend frameworks. |
| **Data Visualization** | Chart.js (v4.4) | Interactive dual-axis velocity line charts and category doughnut charts. |
| **Data Ingestion** | Custom RFC-4180 CSV Tokenizer | Robust client/server CSV validation, loss-sale detection, and bulk import. |

```
   ┌────────────────────────────────────────────────────────┐
   │             FRONTEND CLIENT (Bootstrap 5)              │
   │  • /login.html    • /index.html (Catalog & Stock)      │
   │  • /sales.html    • /dashboard.html (Chart.js & KPIs)  │
   └───────────────┬──────────────────────┬─────────────────┘
                   │                      │
                   ▼                      ▼
   ┌────────────────────────────────────────────────────────┐
   │             EXPRESS REST API & MIDDLEWARE              │
   │  • auth.js (JWT Verification & Shop Tenant Scoping)    │
   │  • /api/auth   • /api/products   • /api/sales          │
   │  • /api/dashboard   • /api/agent   • /api/forecast     │
   │  • /api/import                                         │
   └───────┬──────────────────────┬──────────────────┬──────┘
           │                      │                  │
           ▼                      ▼                  ▼
   ┌───────────────┐     ┌──────────────────┐  ┌─────────────┐
   │  SQLite3 DB   │     │  AI Agent Engine │  │ Time-Series │
   │  (WAL Mode)   │     │  (Gemini Tools)  │  │ Aggregator  │
   │ 8 Relational  │     │ 5 Database Tools │  │  Gap-Filled │
   │    Tables     │     │ Fallback Mode    │  │ Daily Data  │
   └───────────────┘     └──────────────────┘  └─────────────┘
```

---

## 3. Relational Database Schema

The database currently maintains **8 relational tables** with enforced foreign key cascades:

```
┌──────────────┐     1:N     ┌──────────────┐
│    SHOPS     │ ──────────< │    USERS     │
│  id, name,   │             │  id, shop_id,│
│  currency    │             │  email, hash │
└──────┬───────┘             └──────────────┘
       │
       │ 1:N
       ▼
┌──────────────────────────────────────────────────────────────────┐
│                             PRODUCTS                             │
│  id, shop_id, sku, name, category, cost_price, selling_price,    │
│  stock_quantity, min_stock_threshold, unit                       │
└──────┬───────────────────┬──────────────────┬────────────────────┘
       │ 1:N               │ 1:N              │ 1:N
       ▼                   ▼                  ▼
┌──────────────┐   ┌───────────────┐   ┌───────────────────────────┐
│INVENTORY_LOGS│   │   FORECASTS   │   │      RECOMMENDATIONS      │
│change_type,  │   │horizon_days,  │   │current_stock, burn_rate,  │
│qty_change,   │   │predicted_qty, │   │lead_time, safety_stock,   │
│new_stock     │   │mae, rmse, wape│   │reorder_point, status      │
└──────────────┘   └───────┬───────┘   └─────────────┬─────────────┘
                           │ 1:N                     │
                           └─────────────────────────┘
       ┌──────────────────────────────────────┐
       │                SALES                 │
       │  id, shop_id, invoice_number, total, │
       │  payment_method, created_at          │
       └──────────────────┬───────────────────┘
                          │ 1:N
                          ▼
       ┌──────────────────────────────────────┐
       │             SALE_ITEMS               │
       │  id, sale_id, product_id, quantity,  │
       │  unit_price, total_price             │
       └──────────────────────────────────────┘
```

---

## 4. Individual Member Contribution Breakdown

### 👨‍💻 Member 1: Abdullah Al Junaed Akond (232-35-694) — Team Lead
**Primary Ownership:** Authentication & Multi-Tenant Core, Product Catalog Engine, and Agentic AI Assistant

| Module / Task | Technical Scope & Implementation | Verification Deliverable |
|:---|:---|:---|
| **Compulsory Auth (FR 7)** | User registration, shop tenant binding, bcrypt password hashing (10 salt rounds), JWT issue and verification middleware. | `src/controllers/authController.js`<br>`src/middleware/auth.js` |
| **Product Engine (FR 8)** | Full CRUD endpoints, SKU uniqueness constraints, stock adjustments (+Restock / -Deduct) with immutable audit trail. | `src/controllers/productController.js`<br>`public/index.html` |
| **Agent AI Setup (T-1.1)** | REST integration with Google Gemini Flash (`gemini-flash-latest`), bilingual store persona prompt, and health diagnostics. | `src/config/gemini.js`<br>`src/controllers/agentController.js` |
| **Tool Calling (T-1.2)** | 5 declared function calling schemas (`searchProduct`, `checkStock`, `getSalesSummary`, `getLowStockProducts`, `getTopSellingProducts`), multi-turn response loop, and FR 18 outage fallback. | `src/services/aiTools.js`<br>`tests/unit_test_agent_tools.js` |
| **Automated Tests** | 30 tests authored across auth, products, agent connectivity, and tool calling. | 30/30 Tests PASS |
| **Git Attribution** | 10 commits authored under `abdullahfardin` (`akond2305341694@diu.edu.bd`). | Verified on GitHub `main` |

---

### 👩‍💻 Member 2: Nazrin Sultana Omi (232-35-691)
**Primary Ownership:** Sales & Billing Transaction Processing, POS Interface, and Data Ingestion Pipeline

| Module / Task | Technical Scope & Implementation | Verification Deliverable |
|:---|:---|:---|
| **Sales & Billing (FR 9/10)** | Dual-pane POS terminal with cart management, pre-checkout stock validation, atomic transactions (`BEGIN`, `COMMIT`, `ROLLBACK`), and invoice generation. | `src/controllers/salesController.js`<br>`public/sales.html` |
| **Audit & Receipt (FR 14)** | Automatic inventory decrement with `'SALE'` audit logs, sales history browser, and digital thermal receipt printing CSS. | `public/js/sales.js`<br>`public/css/style.css` |
| **CSV Parser Engine (T-2.1)** | Zero-dependency RFC-4180 CSV tokenizer, validation schemas for products and sales, duplicate SKU detection, and loss pricing warnings. | `src/services/csvParser.js`<br>`tests/unit_test_csv_parser.js` |
| **Bulk Import (T-2.2)** | Transactional batch catalog import endpoint (`POST /api/import/products`), DB duplicate pre-checks, atomic batch rollback, and `BULK_IMPORT` audit logs. | `src/controllers/importController.js`<br>`tests/unit_test_bulk_import.js` |
| **Automated Tests** | 27 tests authored across sales checkout, invoice formatting, CSV parsing, and batch imports. | 27/27 Tests PASS |
| **Git Attribution** | 6 commits authored under `nazrinsultanaomi` (`omi2305341691@diu.edu.bd`). | Verified on GitHub `main` |

---

### 👨‍💻 Member 3: Md Ebrahim Hossen (232-35-711)
**Primary Ownership:** Real-Time Analytics Dashboard, Low-Stock Planning, and Demand Forecasting Engine

| Module / Task | Technical Scope & Implementation | Verification Deliverable |
|:---|:---|:---|
| **Dashboard KPIs (FR 17)** | High-performance SQL aggregations for daily revenue, order counts, wholesale inventory valuation, and retail potential gross profit. | `src/controllers/dashboardController.js`<br>`public/dashboard.html` |
| **Visual Charts & Export** | Chart.js dual-axis 7/30 days sales velocity line chart, category doughnut chart, top-sellers leaderboard, and CSV report export. | `public/js/dashboard.js`<br>`GET /api/dashboard/export-report` |
| **Stock Warnings (FR 16)** | Real-time threshold monitoring, critical out-of-stock and warning low-stock classification, and heuristic reorder recommendations. | `GET /api/dashboard/low-stock-alerts` |
| **Forecast Schema (T-3.1)** | Relational table definitions for `forecasts` and `recommendations` with horizon intervals (7, 14, 30 days) and accuracy error metrics. | `src/config/database.js`<br>`tests/unit_test_forecast_schema.js` |
| **Time-Series Pipeline (T-3.2)** | Continuous calendar sequence generator, chronological zero-gap filling for inactive days, category-level baseline aggregator, and variance calculation. | `src/services/dataPreparation.js`<br>`src/controllers/forecastController.js` |
| **Automated Tests** | 23 tests authored across KPI calculations, audit logs, forecast schema, and time-series data preparation. | 23/23 Tests PASS |
| **Git Attribution** | 7 commits authored under `mdebrahimhossen711` (`hossen2305341711@diu.edu.bd`). | Verified on GitHub `main` |

---

## 5. Comprehensive Automated Test Matrix

The project incorporates **9 distinct automated unit and integration test suites**, totaling **80 verified test assertions** that can be executed directly via Node.js:

| Test Suite File | Module & Feature Covered | Owner | Tests | Result |
|:---|:---|:---:|:---:|:---:|
| `tests/unit_test_auth_products.js` | User Registration, Bcrypt Login, Product CRUD, Stock Adjust | Abdullah | 13 | ✅ **13/13 PASS** |
| `tests/unit_test_agent.js` | Gemini API Connectivity, System Prompt, FR 18 Fallback | Abdullah | 7 | ✅ **7/7 PASS** |
| `tests/unit_test_agent_tools.js` | Retail Tool Calling Declarations, Database Handlers, Intent Parser | Abdullah | 10 | ✅ **10/10 PASS** |
| `tests/unit_test_sales.js` | POS Multi-Item Checkout, Atomic Deduction, Oversell Prevention | Omi | 8 | ✅ **8/8 PASS** |
| `tests/unit_test_csv_parser.js` | RFC-4180 CSV Tokenizer, Quoted Values, Duplicate SKU, Loss Sales | Omi | 12 | ✅ **12/12 PASS** |
| `tests/unit_test_bulk_import.js` | Transactional Bulk Product Import, Duplicate Pre-check, Rollback | Omi | 7 | ✅ **7/7 PASS** |
| `tests/unit_test_dashboard.js` | Store KPIs, Dual-Axis Sales Trend, Top Sellers, CSV Export | Ebrahim | 7 | ✅ **7/7 PASS** |
| `tests/unit_test_forecast_schema.js`| Relational Forecast & Recommendation Tables, Multi-Table JOIN | Ebrahim | 7 | ✅ **7/7 PASS** |
| `tests/unit_test_data_prep.js` | Time-Series Extraction, Continuous Zero-Gap Filling, Variance | Ebrahim | 9 | ✅ **9/9 PASS** |
| **TOTAL** | **Entire RetailPulse System** | **Team-6** | **80** | ✅ **80/80 PASS (100%)** |

---

## 6. Git Commit & Version Control Evidence

Recent repository commits on branch `main` demonstrating individual development progress across multiple sessions:

```text
2734e46 - Nazrin Sultana Omi     - 2026-11-15 - test(bulk-import): author automated test suite for bulk catalog imports and rollback
9b22672 - Nazrin Sultana Omi     - 2026-11-15 - feat(bulk-import): implement transactional bulk product catalog import with rollback
ce11a05 - Nazrin Sultana Omi     - 2026-11-15 - test(csv-parser): author automated test suite for CSV parsing and input validation
1097e24 - Nazrin Sultana Omi     - 2026-11-15 - feat(import-templates): add sample retail CSV templates and sanitization utilities
0213fd5 - Nazrin Sultana Omi     - 2026-11-15 - feat(import): implement robust CSV parser and retail data validation engine
528ca48 - Md Ebrahim Hossen      - 2026-11-15 - test(data-prep): author automated test suite for time-series aggregation and gap filling
eba9cdc - Md Ebrahim Hossen      - 2026-11-15 - feat(forecast-api): add time-series inspection endpoint and mount forecast routes
ed10fc1 - Md Ebrahim Hossen      - 2026-11-15 - feat(analytics): implement time-series sales aggregator and zero-gap data preparation
79ad18e - Md Ebrahim Hossen      - 2026-11-15 - feat(db-schema): add forecasts and recommendations relational tables for demand planning
b20a09c - Abdullah Al Junaed     - 2026-11-14 - test(tools): author automated test suite for function calling and tool execution
027176a - Abdullah Al Junaed     - 2026-11-14 - feat(agent): integrate multi-turn tool execution loop in agent controller
3e0ff21 - Abdullah Al Junaed     - 2026-11-14 - feat(tools): define Gemini function calling declarations and retail tool registry
f791abb - Abdullah Al Junaed     - 2026-11-14 - test(agent): author automated test suite for Gemini agent connectivity and fallback
f20b4e2 - Abdullah Al Junaed     - 2026-11-14 - feat(agent): implement AI conversational controller and prompt orchestration
1a15ba2 - Abdullah Al Junaed     - 2026-11-14 - feat(config): add Gemini API client configuration and environment setup
9675a97 - Abdullah Al Junaed     - 2026-11-14 - fix(ui): add owner attribution for Module 1 in product catalog
81c3a62 - Md Ebrahim Hossen      - 2026-11-11 - docs: add individual project contribution report and analytics documentation
0b6c35c - Md Ebrahim Hossen      - 2026-11-11 - feat(dashboard-ui): build executive analytics dashboard with Chart.js visualization
2cda500 - Md Ebrahim Hossen      - 2026-11-11 - feat(analytics-api): implement dashboard KPI aggregations, sales trend, top products
32a4eeb - Nazrin Sultana Omi     - 2026-11-11 - test(sales): ensure test idempotency with unique dynamic SKUs
db95c24 - Nazrin Sultana Omi     - 2026-11-11 - docs: add individual project contribution report and sales documentation
b74d2f8 - Nazrin Sultana Omi     - 2026-11-11 - feat(pos-ui): build interactive point-of-sale billing interface, cart manager
cb9529f - Nazrin Sultana Omi     - 2026-11-11 - feat(sales-api): implement atomic sales transaction controller with stock deduction
7fa2360 - Abdullah Al Junaed     - 2026-11-11 - docs: add individual project contribution report for Abdullah Al Junaed
0cf90c8 - Abdullah Al Junaed     - 2026-11-11 - feat(products): implement product CRUD APIs, stock adjustment audit trail, responsive UI
15ff058 - Abdullah Al Junaed     - 2026-11-11 - feat(auth): implement user registration, login with bcrypt password hashing and JWT
ec94036 - Abdullah Al Junaed     - 2026-11-11 - feat(db): initialize database schema, relational tables, and project dependencies
```

---

## 7. Next Roadmap Slices (Remaining Deliverables)

| Member | Immediate Next Task | Scope & Planned Deliverables |
|:---:|:---|:---|
| **Abdullah** | **T-1.3 & T-1.5: Two-Phase Confirmation & Chat UI** | Building safety gate for critical AI modifications (delete product, bulk restock) and embedding the floating conversational AI chat widget into the web frontend. |
| **Omi** | **T-2.3 & T-2.4: Historical Sales Import & RBAC** | Importing historical sales CSV records to populate training datasets, and enforcing Role-Based Access Control between Store Owner and Cashier. |
| **Ebrahim** | **T-3.3 & T-3.4: Forecasting Engine & Evaluation** | Implementing Moving Average and Seasonal Naive demand projection algorithms (7/14/30 days) and computing backtesting error metrics (MAE, RMSE, WAPE). |

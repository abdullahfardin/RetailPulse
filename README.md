# RetailPulse: Agentic AI-Powered Retail Sales, Demand Forecasting and Inventory Planning System

RetailPulse is an intelligent retail management system designed for small retail businesses (grocery shops, departmental stores, pharmacies). It streamlines daily sales operations, maintains stock levels in real time, provides demand forecasting, and supports natural-language store assistance.

---

## Capstone Project Team (Daffodil International University)

| Member | Student ID | Primary Technical Responsibility |
| :--- | :--- | :--- |
| **Abdullah Al Junaed Akond** *(Lead)* | 232-35-694 | **Authentication & Product/Inventory Management Engine (FR 7 & FR 8)** |
| **Nazrin Sultana Omi** | 232-35-691 | **Sales & Billing Transaction Engine (Point of Sale) (FR 9 & FR 10)** |
| **Md Ebrahim Hossen** | 232-35-711 | **Inventory Planning, Real-Time Dashboard & Analytics (FR 16 & FR 17)** |

---

## Implemented in this Milestone: Abdullah Al Junaed Akond (Member 1)

### 1. Compulsory Requirement: Authentication & Shop Profile Module (FR 7)
- **User Registration (`POST /api/auth/register`):**
  - Input validation (name, email format regex, password $\ge 6$ chars, shop name).
  - Duplicate email collision detection (409 Conflict).
  - Secure password hashing using `bcryptjs` (salt rounds: 10, zero hardcoded credentials).
  - Automatic creation of the tenant shop profile.
- **Login Functionality (`POST /api/auth/login`):**
  - Validates credentials using `bcrypt.compare`.
  - Generates JSON Web Token (`JWT`) carrying user & shop identity.
- **Security Middleware & Shop Isolation:**
  - `authenticateToken` middleware verifies bearer token.
  - Multi-tenant data isolation: all inventory queries strictly scoped to `shop_id`.
- **Live Demo Credentials:**
  - **Email:** `owner@retailpulse.com`
  - **Password:** `password123`
  - *(A 1-click "Quick Fill" button is integrated on the login screen for quick assessor evaluation).*

### 2. Core Functional Requirement 1: Product & Inventory Management (FR 8)
- **Relational Database Schema (SQLite / PostgreSQL compatible):**
  - `shops`, `users`, `products`, `inventory_logs`, `sales`, `sale_items`.
- **Product REST APIs:**
  - `GET /api/products`: Retrieve all products with real-time search, category filter, and stock-status filter.
  - `GET /api/products/:id`: Retrieve single product details.
  - `POST /api/products`: Add product with validation, automatic/custom SKU check.
  - `PUT /api/products/:id`: Update existing product details.
  - `DELETE /api/products/:id`: Remove product from catalog.
  - `POST /api/products/:id/adjust-stock`: Manual restock intake or damage deduction with full audit trail in `inventory_logs`.
  - `GET /api/products/stats`: Real-time inventory metrics (total products, total stock units, cost value, retail value, low-stock count, out-of-stock count).
  - `GET /api/products/categories`: Dynamic list of unique categories.
- **Responsive User Interface:**
  - Modern dashboard layout using Bootstrap 5 and custom CSS.
  - Summary stat cards with live updates.
  - Product catalog table with colored status badges (In Stock, Low Stock, Out of Stock).
  - Modals for Product Add/Edit and Stock Restock/Deduct.
  - Interactive toast notifications and input confirmation prompts.

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation & Run
```bash
# 1. Clone repository
git clone https://github.com/abdullahfardin/RetailPulse.git
cd RetailPulse

# 2. Install dependencies
npm install

# 3. Start development server
npm start
```
The server will start at `http://localhost:3000`. Open `http://localhost:3000` in any browser.

### Running Automated Verification Tests
```bash
node tests/unit_test_auth_products.js
```

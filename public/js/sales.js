// Point of Sale (POS) & Billing Controller (Member 2: Nazrin Sultana Omi)

let catalogProducts = [];
let cart = []; // Array of { product, quantity }
let receiptModalInstance = null;
let historyModalInstance = null;
let toastInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify Authentication
  const token = API.getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // 2. Initialize Bootstrap modals & toasts
  receiptModalInstance = new bootstrap.Modal(document.getElementById('modalReceipt'));
  historyModalInstance = new bootstrap.Modal(document.getElementById('modalHistory'));
  const toastEl = document.getElementById('liveToast');
  if (toastEl) toastInstance = new bootstrap.Toast(toastEl, { delay: 3500 });

  // 3. Populate User & Shop Profiles
  loadUserProfile();

  // 4. Setup Event Listeners
  setupEventListeners();

  // 5. Initial Data Load
  await Promise.all([
    loadCategories(),
    loadCatalog()
  ]);
});

function showToast(message, isError = false) {
  const toastEl = document.getElementById('liveToast');
  const toastBody = document.getElementById('toastMessage');
  toastBody.textContent = message;
  toastEl.className = isError
    ? 'toast align-items-center text-white bg-danger border-0'
    : 'toast align-items-center text-white bg-dark border-0';
  if (toastInstance) toastInstance.show();
}

function loadUserProfile() {
  const user = API.getUser();
  const shop = API.getShop();

  if (shop && shop.name) {
    document.getElementById('navShopName').textContent = shop.name;
  }
  if (user && user.name) {
    document.getElementById('navUserName').textContent = user.name;
  }

  // Logout handler
  document.getElementById('btnLogout').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('Are you sure you want to log out?')) {
      API.clearSession();
      window.location.href = '/login.html';
    }
  });
}

function setupEventListeners() {
  // Search input with debounce
  let searchTimeout;
  document.getElementById('posSearchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderProductGrid, 250);
  });

  // Category filter
  document.getElementById('posCategorySelect').addEventListener('change', renderProductGrid);

  // Discount input change
  document.getElementById('cartDiscountInput').addEventListener('input', updateCartSummary);

  // Clear cart button
  document.getElementById('btnClearCart').addEventListener('click', () => {
    if (cart.length > 0 && confirm('Are you sure you want to clear all items in current cart?')) {
      cart = [];
      renderCart();
      showToast('Cart cleared.');
    }
  });

  // Checkout button
  document.getElementById('btnCheckout').addEventListener('click', handleCheckout);

  // Open Sales History modal
  document.getElementById('btnOpenHistory').addEventListener('click', openSalesHistory);

  // History search filter
  let histSearchTimeout;
  document.getElementById('historySearchInput').addEventListener('input', () => {
    clearTimeout(histSearchTimeout);
    histSearchTimeout = setTimeout(filterHistoryTable, 300);
  });
}

// ================= CATALOG & GRID =================

async function loadCategories() {
  try {
    const res = await API.get('/api/products/categories');
    if (res.success && res.categories) {
      const select = document.getElementById('posCategorySelect');
      select.innerHTML = '<option value="All">All Categories</option>';
      res.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

async function loadCatalog() {
  try {
    const res = await API.get('/api/products');
    if (res.success) {
      catalogProducts = res.products || [];
      renderProductGrid();
    }
  } catch (err) {
    console.error('Failed to load catalog:', err);
    document.getElementById('posProductGrid').innerHTML = `
      <div class="col-12 text-center py-4 text-danger">
        <i class="bi bi-exclamation-triangle me-1"></i> Failed to load catalog products.
      </div>
    `;
  }
}

function renderProductGrid() {
  const container = document.getElementById('posProductGrid');
  const search = document.getElementById('posSearchInput').value.trim().toLowerCase();
  const category = document.getElementById('posCategorySelect').value;

  const filtered = catalogProducts.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search);
    const matchCat = category === 'All' || p.category === category;
    return matchSearch && matchCat;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center py-5 text-muted">
        <i class="bi bi-search fs-2 d-block mb-2 text-secondary"></i>
        No products found matching your search.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isOutOfStock = p.stock_quantity <= 0;
    const isLowStock = !isOutOfStock && p.stock_quantity <= p.min_stock_threshold;

    let stockBadge = '';
    if (isOutOfStock) {
      stockBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle"><i class="bi bi-x-circle me-1"></i> Out of Stock</span>`;
    } else if (isLowStock) {
      stockBadge = `<span class="badge bg-warning-subtle text-warning border border-warning-subtle"><i class="bi bi-exclamation-triangle me-1"></i> Stock: ${p.stock_quantity}</span>`;
    } else {
      stockBadge = `<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-check-circle me-1"></i> Stock: ${p.stock_quantity}</span>`;
    }

    return `
      <div class="col-sm-6 col-md-4 col-xl-3">
        <div class="pos-product-card ${isOutOfStock ? 'disabled' : ''}" onclick="${isOutOfStock ? '' : `addToCart(${p.id})`}">
          <div>
            <div class="d-flex justify-content-between align-items-start mb-2">
              <span class="badge bg-light text-muted border font-monospace small">${escapeHtml(p.sku)}</span>
              ${stockBadge}
            </div>
            <h6 class="fw-bold text-dark mb-1 text-truncate" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h6>
            <small class="text-muted d-block mb-2">${escapeHtml(p.category)}</small>
          </div>
          <div class="d-flex justify-content-between align-items-center pt-2 border-top mt-2">
            <span class="fs-6 fw-bold text-primary font-monospace">৳${p.selling_price.toFixed(2)}</span>
            <button class="btn btn-sm ${isOutOfStock ? 'btn-secondary' : 'btn-outline-primary'} rounded-pill px-2 py-0" ${isOutOfStock ? 'disabled' : ''}>
              <i class="bi bi-plus-lg"></i> Add
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ================= CART MANAGEMENT =================

function addToCart(productId) {
  const product = catalogProducts.find(p => p.id === productId);
  if (!product) return;

  if (product.stock_quantity <= 0) {
    showToast(`"${product.name}" is out of stock!`, true);
    return;
  }

  const existingIndex = cart.findIndex(item => item.product.id === productId);
  if (existingIndex > -1) {
    const currentQty = cart[existingIndex].quantity;
    if (currentQty + 1 > product.stock_quantity) {
      showToast(`Cannot add more. Only ${product.stock_quantity} units available in stock.`, true);
      return;
    }
    cart[existingIndex].quantity += 1;
  } else {
    cart.push({
      product,
      quantity: 1
    });
  }

  renderCart();
}

function updateCartQuantity(productId, delta) {
  const index = cart.findIndex(item => item.product.id === productId);
  if (index === -1) return;

  const item = cart[index];
  const newQty = item.quantity + delta;

  if (newQty <= 0) {
    cart.splice(index, 1);
  } else if (newQty > item.product.stock_quantity) {
    showToast(`Cannot exceed on-hand inventory (${item.product.stock_quantity} ${item.product.unit}).`, true);
    return;
  } else {
    item.quantity = newQty;
  }

  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.product.id !== productId);
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartItemsList');
  const badge = document.getElementById('cartItemCountBadge');
  const btnCheckout = document.getElementById('btnCheckout');

  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  badge.textContent = totalCount;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-cart-x fs-1 text-secondary d-block mb-2"></i>
        Your cart is empty.<br>
        <small>Click any product on the left to add items.</small>
      </div>
    `;
    btnCheckout.disabled = true;
    updateCartSummary();
    return;
  }

  btnCheckout.disabled = false;
  container.innerHTML = cart.map(item => {
    const p = item.product;
    const lineTotal = p.selling_price * item.quantity;

    return `
      <div class="cart-item-row">
        <div class="d-flex justify-content-between align-items-start mb-1">
          <div class="pe-2">
            <div class="fw-semibold text-dark small text-truncate" style="max-width: 170px;" title="${escapeHtml(p.name)}">
              ${escapeHtml(p.name)}
            </div>
            <small class="text-muted font-monospace">৳${p.selling_price.toFixed(2)} / ${p.unit}</small>
          </div>
          <div class="text-end">
            <div class="fw-bold font-monospace text-primary small">৳${lineTotal.toFixed(2)}</div>
            <button type="button" class="btn btn-link text-danger p-0 border-0" style="font-size: 0.75rem;" onclick="removeFromCart(${p.id})">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>

        <!-- Quantity Controls -->
        <div class="d-flex justify-content-between align-items-center mt-2">
          <small class="text-muted" style="font-size: 0.72rem;">Available: ${p.stock_quantity}</small>
          <div class="input-group input-group-sm" style="width: 105px;">
            <button class="btn btn-outline-secondary py-0 px-2" type="button" onclick="updateCartQuantity(${p.id}, -1)">-</button>
            <input type="text" class="form-control text-center py-0 px-1 bg-white font-monospace" value="${item.quantity}" readonly>
            <button class="btn btn-outline-secondary py-0 px-2" type="button" onclick="updateCartQuantity(${p.id}, 1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  updateCartSummary();
}

function updateCartSummary() {
  const subtotal = cart.reduce((sum, item) => sum + (item.product.selling_price * item.quantity), 0);
  const discountInput = parseFloat(document.getElementById('cartDiscountInput').value) || 0;
  const grandTotal = Math.max(0, subtotal - discountInput);

  document.getElementById('summarySubtotal').textContent = `৳${subtotal.toFixed(2)}`;
  document.getElementById('summaryGrandTotal').textContent = `৳${grandTotal.toFixed(2)}`;
}

// ================= CHECKOUT & TRANSACTION =================

async function handleCheckout() {
  if (cart.length === 0) {
    showToast('Cannot complete checkout: Cart is empty.', true);
    return;
  }

  const customerName = document.getElementById('cartCustomerName').value.trim() || 'Walk-in Customer';
  const discount = parseFloat(document.getElementById('cartDiscountInput').value) || 0;
  const paymentMethod = document.querySelector('input[name="cartPaymentMethod"]:checked').value;

  const items = cart.map(item => ({
    product_id: item.product.id,
    quantity: item.quantity
  }));

  const btnCheckout = document.getElementById('btnCheckout');
  btnCheckout.disabled = true;
  btnCheckout.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Processing Atomic Transaction...';

  try {
    const res = await API.post('/api/sales', {
      customer_name: customerName,
      discount,
      payment_method: paymentMethod,
      items
    });

    if (res.success && res.sale) {
      showToast('Sale completed successfully! Inventory updated.', false);

      // Render Receipt
      renderReceiptModal(res.sale);

      // Reset cart
      cart = [];
      document.getElementById('cartDiscountInput').value = '0';
      document.getElementById('cartCustomerName').value = 'Walk-in Customer';
      renderCart();

      // Refresh catalog in background so updated stock levels reflect immediately
      await loadCatalog();
    } else {
      showToast(res.error || 'Failed to complete sale.', true);
    }
  } catch (err) {
    showToast(err.message || 'Transaction failed. Database rolled back safely.', true);
  } finally {
    btnCheckout.disabled = false;
    btnCheckout.innerHTML = '<i class="bi bi-check2-circle fs-5 me-1"></i> Complete Sale & Print Bill';
  }
}

function renderReceiptModal(sale) {
  const shop = API.getShop() || {};
  const user = API.getUser() || {};

  document.getElementById('rcptShopName').textContent = shop.name || 'Pulse Mart';
  document.getElementById('rcptShopAddress').textContent = shop.address || 'Dhaka, Bangladesh';
  document.getElementById('rcptShopPhone').textContent = `Tel: ${shop.phone || '+8801700000000'}`;

  document.getElementById('rcptInvoiceNumber').textContent = sale.invoice_number;
  document.getElementById('rcptDate').textContent = new Date(sale.created_at || Date.now()).toLocaleString();
  document.getElementById('rcptCashier').textContent = user.name || 'Nazrin Sultana Omi';
  document.getElementById('rcptCustomer').textContent = sale.customer_name;

  const tbody = document.getElementById('rcptItemsBody');
  tbody.innerHTML = (sale.items || []).map(it => `
    <tr>
      <td class="text-start py-1">${escapeHtml(it.product_name)}</td>
      <td class="text-center py-1 font-monospace">${it.quantity}</td>
      <td class="text-end py-1 font-monospace">৳${it.unit_price.toFixed(2)}</td>
      <td class="text-end py-1 font-monospace">৳${it.total_price.toFixed(2)}</td>
    </tr>
  `).join('');

  document.getElementById('rcptSubtotal').textContent = `৳${sale.subtotal.toFixed(2)}`;
  document.getElementById('rcptDiscount').textContent = `-৳${sale.discount.toFixed(2)}`;
  document.getElementById('rcptGrandTotal').textContent = `৳${sale.total_amount.toFixed(2)}`;
  document.getElementById('rcptPaymentMethod').textContent = sale.payment_method;

  receiptModalInstance.show();
}

// ================= SALES HISTORY =================

let allHistorySales = [];

async function openSalesHistory() {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="text-center py-4 text-muted">
        <div class="spinner-border spinner-border-sm text-primary me-2"></div>
        Loading transaction records from database...
      </td>
    </tr>
  `;

  historyModalInstance.show();

  try {
    const res = await API.get('/api/sales');
    if (res.success) {
      allHistorySales = res.sales || [];
      renderHistoryTable(allHistorySales);
    }
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-4 text-danger">
          <i class="bi bi-exclamation-circle me-1"></i> Failed to load sales history: ${err.message}
        </td>
      </tr>
    `;
  }
}

function renderHistoryTable(sales) {
  const tbody = document.getElementById('historyTableBody');

  if (sales.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-5 text-muted">
          No transactions recorded yet. Complete a sale on the terminal to see history.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sales.map(s => `
    <tr>
      <td class="font-monospace fw-semibold text-primary">${escapeHtml(s.invoice_number)}</td>
      <td class="small text-muted">${new Date(s.created_at).toLocaleString()}</td>
      <td class="fw-semibold text-dark">${escapeHtml(s.customer_name)}</td>
      <td class="small text-muted">${escapeHtml(s.cashier_name || 'Owner')}</td>
      <td class="text-center">
        <span class="badge bg-light text-dark border">${s.total_units_sold || s.total_items || 0} units</span>
      </td>
      <td class="text-center">
        <span class="badge bg-secondary-subtle text-secondary text-uppercase">${escapeHtml(s.payment_method)}</span>
      </td>
      <td class="text-end font-monospace fw-bold text-dark">৳${s.total_amount.toFixed(2)}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary" onclick="viewPastReceipt(${s.id})">
          <i class="bi bi-receipt me-1"></i> Receipt
        </button>
      </td>
    </tr>
  `).join('');
}

function filterHistoryTable() {
  const search = document.getElementById('historySearchInput').value.trim().toLowerCase();
  const filtered = allHistorySales.filter(s =>
    s.invoice_number.toLowerCase().includes(search) ||
    s.customer_name.toLowerCase().includes(search)
  );
  renderHistoryTable(filtered);
}

async function viewPastReceipt(saleId) {
  try {
    const res = await API.get(`/api/sales/${saleId}`);
    if (res.success && res.sale) {
      historyModalInstance.hide();
      renderReceiptModal(res.sale);
    }
  } catch (err) {
    showToast('Failed to load past receipt details.', true);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

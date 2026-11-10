// Product & Inventory Management Logic (Member 1: Abdullah Al Junaed Akond)

let currentProductList = [];
let productModalInstance = null;
let adjustModalInstance = null;
let toastInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify Authentication
  const token = API.getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // 2. Initialize Bootstrap components
  productModalInstance = new bootstrap.Modal(document.getElementById('modalProduct'));
  adjustModalInstance = new bootstrap.Modal(document.getElementById('modalAdjustStock'));
  const toastEl = document.getElementById('liveToast');
  if (toastEl) toastInstance = new bootstrap.Toast(toastEl, { delay: 3500 });

  // 3. Populate User & Shop Profiles
  loadUserProfile();

  // 4. Setup Event Listeners
  setupEventListeners();

  // 5. Initial Data Load
  await Promise.all([
    loadStats(),
    loadCategories(),
    loadProducts()
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

  // Handle Logout
  document.getElementById('btnLogout').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('Are you sure you want to log out?')) {
      API.clearSession();
      window.location.href = '/login.html';
    }
  });
}

function setupEventListeners() {
  // Open Add Product Modal
  document.getElementById('btnOpenAddModal').addEventListener('click', () => {
    openAddProductModal();
  });

  // Save Product (Add or Edit) Form
  document.getElementById('formProduct').addEventListener('submit', handleProductFormSubmit);

  // Save Stock Adjustment Form
  document.getElementById('formAdjustStock').addEventListener('submit', handleAdjustStockSubmit);

  // Real-time search with debounce
  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadProducts, 300);
  });

  // Filter change handlers
  document.getElementById('categoryFilter').addEventListener('change', loadProducts);
  document.getElementById('statusFilter').addEventListener('change', loadProducts);
  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadStats();
    loadCategories();
    loadProducts();
    showToast('Inventory records refreshed.');
  });

  // Adjust stock dynamic preview calculation
  const adjQty = document.getElementById('adjQty');
  const adjActionRadios = document.querySelectorAll('input[name="adjAction"]');
  const updatePreview = () => {
    const current = parseInt(document.getElementById('adjCurrentStock').textContent, 10) || 0;
    const qty = parseInt(adjQty.value, 10) || 0;
    const action = document.querySelector('input[name="adjAction"]:checked').value;
    const preview = action === 'ADD' ? current + qty : Math.max(0, current - qty);
    document.getElementById('adjPreviewStock').textContent = preview;
  };
  adjQty.addEventListener('input', updatePreview);
  adjActionRadios.forEach(r => r.addEventListener('change', updatePreview));
}

// ================= API CALLS & RENDERING =================

async function loadStats() {
  try {
    const res = await API.get('/api/products/stats');
    if (res.success && res.stats) {
      const s = res.stats;
      document.getElementById('statTotalProducts').textContent = s.total_products || 0;
      document.getElementById('statTotalUnits').textContent = s.total_units || 0;
      document.getElementById('statCostValue').textContent = `৳${(s.total_cost_value || 0).toLocaleString()}`;
      
      const alerts = (s.low_stock_count || 0) + (s.out_of_stock_count || 0);
      document.getElementById('statAlertCount').textContent = alerts;
      document.getElementById('statAlertSub').textContent = 
        `${s.low_stock_count || 0} Low Stock • ${s.out_of_stock_count || 0} Out of Stock`;
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadCategories() {
  try {
    const res = await API.get('/api/products/categories');
    if (res.success && res.categories) {
      const select = document.getElementById('categoryFilter');
      const datalist = document.getElementById('categoryList');
      
      const currentVal = select.value;
      select.innerHTML = '<option value="All">All Categories</option>';
      datalist.innerHTML = '';

      res.categories.forEach(cat => {
        // Dropdown option
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === currentVal) opt.selected = true;
        select.appendChild(opt);

        // Datalist option for modal
        const dOpt = document.createElement('option');
        dOpt.value = cat;
        datalist.appendChild(dOpt);
      });
    }
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

async function loadProducts() {
  const tbody = document.getElementById('productsTableBody');
  const search = document.getElementById('searchInput').value.trim();
  const category = document.getElementById('categoryFilter').value;
  const status = document.getElementById('statusFilter').value;

  let query = '/api/products?';
  const params = [];
  if (search) params.push(`search=${encodeURIComponent(search)}`);
  if (category && category !== 'All') params.push(`category=${encodeURIComponent(category)}`);
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  query += params.join('&');

  try {
    const res = await API.get(query);
    if (res.success) {
      currentProductList = res.products || [];
      renderProductsTable(currentProductList);
    }
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-4 text-danger">
          <i class="bi bi-exclamation-circle me-1"></i> Failed to load products: ${err.message}
        </td>
      </tr>
    `;
  }
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');

  if (products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-5 text-muted">
          <i class="bi bi-box-seam fs-2 d-block mb-2 text-secondary"></i>
          No products found matching the criteria. Click <strong>"Add New Product"</strong> to register items.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = products.map(p => {
    // Badge status styling
    let badgeHtml = '';
    if (p.stock_status === 'OUT_OF_STOCK') {
      badgeHtml = `<span class="badge badge-stock badge-out-of-stock"><i class="bi bi-x-circle me-1"></i> Out of Stock (0)</span>`;
    } else if (p.stock_status === 'LOW_STOCK') {
      badgeHtml = `<span class="badge badge-stock badge-low-stock"><i class="bi bi-exclamation-triangle me-1"></i> Low Stock (${p.stock_quantity} ${p.unit})</span>`;
    } else {
      badgeHtml = `<span class="badge badge-stock badge-in-stock"><i class="bi bi-check2 me-1"></i> In Stock (${p.stock_quantity} ${p.unit})</span>`;
    }

    const margin = p.profit_margin_percent !== null ? `${p.profit_margin_percent}%` : '-';

    return `
      <tr>
        <td class="font-monospace text-muted small fw-semibold">${escapeHtml(p.sku)}</td>
        <td>
          <div class="fw-semibold text-dark">${escapeHtml(p.name)}</div>
          <small class="text-muted">Min Threshold: ${p.min_stock_threshold} ${p.unit}</small>
        </td>
        <td>
          <span class="badge bg-light text-dark border">${escapeHtml(p.category)}</span>
        </td>
        <td class="text-end font-monospace">৳${p.cost_price.toFixed(2)}</td>
        <td class="text-end font-monospace fw-bold text-dark">৳${p.selling_price.toFixed(2)}</td>
        <td class="text-center small text-success fw-semibold">${margin}</td>
        <td class="text-center">${badgeHtml}</td>
        <td class="text-center">
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn btn-outline-warning" title="Adjust Stock (Restock / Deduct)" onclick="openAdjustStockModal(${p.id})">
              <i class="bi bi-boxes"></i>
            </button>
            <button class="btn btn-outline-primary" title="Edit Product Details" onclick="openEditProductModal(${p.id})">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-outline-danger" title="Delete Product" onclick="confirmDeleteProduct(${p.id}, '${escapeHtml(p.name)}')">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ================= MODAL ACTIONS =================

function openAddProductModal() {
  document.getElementById('modalProductTitle').textContent = 'Add New Product';
  document.getElementById('prodId').value = '';
  document.getElementById('prodSku').value = '';
  document.getElementById('prodName').value = '';
  document.getElementById('prodCategory').value = '';
  document.getElementById('prodUnit').value = 'pcs';
  document.getElementById('prodCostPrice').value = '';
  document.getElementById('prodSellingPrice').value = '';
  document.getElementById('prodStock').value = '0';
  document.getElementById('prodMinThreshold').value = '5';
  
  // Show initial stock field for new product
  document.getElementById('initialStockContainer').classList.remove('d-none');
  document.getElementById('modalAlert').classList.add('d-none');

  productModalInstance.show();
}

function openEditProductModal(id) {
  const product = currentProductList.find(p => p.id === id);
  if (!product) return;

  document.getElementById('modalProductTitle').textContent = 'Edit Product Details';
  document.getElementById('prodId').value = product.id;
  document.getElementById('prodSku').value = product.sku;
  document.getElementById('prodName').value = product.name;
  document.getElementById('prodCategory').value = product.category;
  document.getElementById('prodUnit').value = product.unit || 'pcs';
  document.getElementById('prodCostPrice').value = product.cost_price;
  document.getElementById('prodSellingPrice').value = product.selling_price;
  document.getElementById('prodMinThreshold').value = product.min_stock_threshold;

  // Hide initial stock field when editing existing product
  document.getElementById('initialStockContainer').classList.add('d-none');
  document.getElementById('modalAlert').classList.add('d-none');

  productModalInstance.show();
}

async function handleProductFormSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('modalAlert');
  alertBox.classList.add('d-none');

  const id = document.getElementById('prodId').value;
  const isEdit = Boolean(id);

  const payload = {
    sku: document.getElementById('prodSku').value.trim(),
    name: document.getElementById('prodName').value.trim(),
    category: document.getElementById('prodCategory').value.trim(),
    unit: document.getElementById('prodUnit').value.trim() || 'pcs',
    cost_price: parseFloat(document.getElementById('prodCostPrice').value),
    selling_price: parseFloat(document.getElementById('prodSellingPrice').value),
    min_stock_threshold: parseInt(document.getElementById('prodMinThreshold').value, 10) || 5
  };

  if (!isEdit) {
    payload.stock_quantity = parseInt(document.getElementById('prodStock').value, 10) || 0;
  }

  const btnSave = document.getElementById('btnSaveProduct');
  btnSave.disabled = true;
  btnSave.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';

  try {
    let res;
    if (isEdit) {
      res = await API.put(`/api/products/${id}`, payload);
    } else {
      res = await API.post('/api/products', payload);
    }

    if (res.success) {
      productModalInstance.hide();
      showToast(isEdit ? 'Product updated successfully.' : 'Product created and added to inventory.');
      await Promise.all([loadStats(), loadCategories(), loadProducts()]);
    } else {
      alertBox.textContent = res.error || 'Failed to save product.';
      alertBox.classList.remove('d-none');
    }
  } catch (err) {
    alertBox.textContent = err.message || 'Error occurred while saving product.';
    alertBox.classList.remove('d-none');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="bi bi-check-circle me-1"></i> Save Product';
  }
}

function openAdjustStockModal(id) {
  const product = currentProductList.find(p => p.id === id);
  if (!product) return;

  document.getElementById('adjProdId').value = product.id;
  document.getElementById('adjProdName').textContent = product.name;
  document.getElementById('adjProdSku').textContent = product.sku;
  document.getElementById('adjCurrentStock').textContent = product.stock_quantity;
  document.getElementById('adjPreviewStock').textContent = product.stock_quantity;
  document.getElementById('adjQty').value = '';
  document.getElementById('adjReason').value = '';
  document.getElementById('adjAdd').checked = true;
  document.getElementById('adjAlert').classList.add('d-none');

  adjustModalInstance.show();
}

async function handleAdjustStockSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById('adjAlert');
  alertBox.classList.add('d-none');

  const id = document.getElementById('adjProdId').value;
  const action = document.querySelector('input[name="adjAction"]:checked').value;
  const quantity = parseInt(document.getElementById('adjQty').value, 10);
  const reason = document.getElementById('adjReason').value.trim();

  if (!quantity || quantity <= 0) {
    alertBox.textContent = 'Please enter a valid positive quantity.';
    alertBox.classList.remove('d-none');
    return;
  }

  const btnSave = document.getElementById('btnSaveAdjust');
  btnSave.disabled = true;
  btnSave.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Updating...';

  try {
    const res = await API.post(`/api/products/${id}/adjust-stock`, {
      action,
      quantity,
      reason
    });

    if (res.success) {
      adjustModalInstance.hide();
      showToast(`Stock adjusted: ${action === 'ADD' ? '+' : '-'}${quantity} units recorded.`);
      await Promise.all([loadStats(), loadProducts()]);
    } else {
      alertBox.textContent = res.error || 'Failed to adjust stock.';
      alertBox.classList.remove('d-none');
    }
  } catch (err) {
    alertBox.textContent = err.message || 'Error updating stock.';
    alertBox.classList.remove('d-none');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Confirm Stock Adjustment';
  }
}

async function confirmDeleteProduct(id, name) {
  if (confirm(`Are you sure you want to delete "${name}" from inventory? This action cannot be undone.`)) {
    try {
      const res = await API.delete(`/api/products/${id}`);
      if (res.success) {
        showToast(`Product "${name}" deleted.`);
        await Promise.all([loadStats(), loadCategories(), loadProducts()]);
      } else {
        alert(res.error || 'Failed to delete product.');
      }
    } catch (err) {
      alert(err.message || 'Error deleting product.');
    }
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

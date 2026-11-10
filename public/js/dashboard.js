// Executive Analytics & Inventory Planning Controller (Member 3: Md Ebrahim Hossen)

let trendChartInstance = null;
let categoryChartInstance = null;
let currentTrendDays = 7;
let toastInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify Authentication
  const token = API.getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // 2. Initialize Toasts
  const toastEl = document.getElementById('liveToast');
  if (toastEl) toastInstance = new bootstrap.Toast(toastEl, { delay: 3500 });

  // 3. Populate User & Shop Profiles
  loadUserProfile();

  // 4. Setup Event Listeners
  setupEventListeners();

  // 5. Initial Data Load
  await refreshDashboard();
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
  document.getElementById('btnRefreshDashboard').addEventListener('click', () => {
    refreshDashboard();
    showToast('Analytics refreshed from database.');
  });

  document.getElementById('btnExportCsv').addEventListener('click', handleExportCsv);
}

function setChartDays(days) {
  currentTrendDays = days;
  document.getElementById('btnDays7').classList.toggle('active', days === 7);
  document.getElementById('btnDays30').classList.toggle('active', days === 30);
  loadSalesTrend(days);
}

async function refreshDashboard() {
  await Promise.all([
    loadKPIs(),
    loadSalesTrend(currentTrendDays),
    loadCategoryChart(),
    loadTopProducts(),
    loadLowStockAlerts(),
    loadAuditLogs()
  ]);
}

// ================= 1. KPI STATS =================

async function loadKPIs() {
  try {
    const res = await API.get('/api/dashboard/stats');
    if (res.success && res.stats) {
      const s = res.stats;
      document.getElementById('kpiTodayRev').textContent = `৳${(s.today_revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      document.getElementById('kpiTodayOrders').textContent = `${s.today_orders || 0} completed orders today`;
      document.getElementById('kpiTotalUnits').textContent = (s.total_units || 0).toLocaleString();
      document.getElementById('kpiProductCount').textContent = `Across ${s.total_products || 0} active catalog items`;
      document.getElementById('kpiRetailVal').textContent = `৳${(s.retail_valuation || 0).toLocaleString()}`;
      document.getElementById('kpiProfitEst').textContent = `Potential Profit: ৳${(s.potential_profit || 0).toLocaleString()}`;
      document.getElementById('kpiAlertCount').textContent = s.total_alerts || 0;
      document.getElementById('kpiAlertDetail').textContent = `${s.low_stock_count || 0} low stock • ${s.out_of_stock_count || 0} out of stock`;
    }
  } catch (err) {
    console.error('Failed to load dashboard KPIs:', err);
  }
}

// ================= 2. SALES TREND (LINE CHART) =================

async function loadSalesTrend(days = 7) {
  try {
    const res = await API.get(`/api/dashboard/sales-trend?days=${days}`);
    if (res.success && res.trend) {
      const t = res.trend;
      renderTrendChart(t.labels, t.revenue, t.orders);
    }
  } catch (err) {
    console.error('Failed to load sales trend:', err);
  }
}

function renderTrendChart(labels, revenue, orders) {
  const ctx = document.getElementById('salesTrendChart').getContext('2d');

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue (৳)',
          data: revenue,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          fill: true,
          tension: 0.35,
          yAxisID: 'y',
          pointRadius: 4,
          pointBackgroundColor: '#2563eb'
        },
        {
          label: 'Transaction Count',
          data: orders,
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          borderDash: [5, 5],
          tension: 0.2,
          yAxisID: 'y1',
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Revenue (৳)' },
          ticks: {
            callback: value => '৳' + value
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Orders' },
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

// ================= 3. CATEGORY DISTRIBUTION (DOUGHNUT) =================

async function loadCategoryChart() {
  try {
    const res = await API.get('/api/dashboard/category-distribution');
    if (res.success && res.categories) {
      renderCategoryChart(res.categories);
    }
  } catch (err) {
    console.error('Failed to load categories chart:', err);
  }
}

function renderCategoryChart(categories) {
  const ctx = document.getElementById('categoryChart').getContext('2d');

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  const labels = categories.map(c => c.category);
  const data = categories.map(c => c.total_units);

  const colors = [
    '#2563eb', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6',
    '#06b6d4', '#64748b', '#ef4444'
  ];

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 11 } }
        }
      }
    }
  });
}

// ================= 4. TOP PRODUCTS =================

async function loadTopProducts() {
  const tbody = document.getElementById('topProductsTableBody');
  try {
    const res = await API.get('/api/dashboard/top-products?limit=5');
    if (res.success) {
      const prods = res.topProducts || [];
      if (prods.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="text-center py-4 text-muted">
              No sales recorded yet. Completed sales will populate this leaderboard.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = prods.map((p, idx) => `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              <span class="badge ${idx === 0 ? 'bg-warning text-dark' : 'bg-light text-muted border'} rounded-circle" style="width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;">
                ${idx + 1}
              </span>
              <div>
                <div class="fw-semibold text-dark small">${escapeHtml(p.name)}</div>
                <small class="text-muted font-monospace">${escapeHtml(p.sku)}</small>
              </div>
            </div>
          </td>
          <td><span class="badge bg-light text-dark border small">${escapeHtml(p.category)}</span></td>
          <td class="text-center fw-bold font-monospace text-primary">${p.units_sold}</td>
          <td class="text-end fw-bold font-monospace">৳${p.total_sales_amount.toFixed(2)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load top products:', err);
  }
}

// ================= 5. LOW STOCK ALERTS & REORDER ADVICE (FR 16) =================

async function loadLowStockAlerts() {
  const tbody = document.getElementById('alertsTableBody');
  try {
    const res = await API.get('/api/dashboard/low-stock-alerts');
    if (res.success) {
      const alerts = res.alerts || [];
      if (alerts.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="text-center py-4 text-success">
              <i class="bi bi-check-circle me-1"></i> All products are currently above their minimum safety thresholds!
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = alerts.map(p => {
        const isCritical = p.stock_quantity <= 0;
        const badge = isCritical
          ? `<span class="badge bg-danger">OUT OF STOCK (0)</span>`
          : `<span class="badge bg-warning text-dark">${p.stock_quantity} ${p.unit}</span>`;

        return `
          <tr>
            <td>
              <div class="fw-semibold text-dark small">${escapeHtml(p.name)}</div>
              <small class="text-muted font-monospace">${escapeHtml(p.sku)}</small>
            </td>
            <td class="text-center">${badge}</td>
            <td class="text-center small text-muted font-monospace">${p.min_stock_threshold} ${p.unit}</td>
            <td class="text-center font-monospace text-danger fw-bold">-${p.deficit}</td>
            <td class="text-end">
              <span class="badge bg-primary-subtle text-primary border border-primary-subtle font-monospace">
                +${p.suggested_reorder_qty} ${p.unit}
              </span>
              <div class="small text-muted" style="font-size: 0.7rem;">Est: ৳${p.estimated_reorder_cost.toFixed(0)}</div>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load low stock alerts:', err);
  }
}

// ================= 6. AUDIT LOGS (FR 14) =================

async function loadAuditLogs() {
  const tbody = document.getElementById('auditLogsTableBody');
  try {
    const res = await API.get('/api/dashboard/audit-logs?limit=15');
    if (res.success) {
      const logs = res.logs || [];
      if (logs.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-4 text-muted">No audit movements recorded.</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = logs.map(l => {
        let actionBadge = '';
        if (l.change_type === 'SALE') {
          actionBadge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">SALE</span>';
        } else if (l.change_type === 'RESTOCK' || l.change_type === 'INITIAL') {
          actionBadge = '<span class="badge bg-success-subtle text-success border border-success-subtle">RESTOCK</span>';
        } else {
          actionBadge = '<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle">ADJUST</span>';
        }

        const qtyDisplay = l.quantity_change > 0 ? `+${l.quantity_change}` : `${l.quantity_change}`;
        const qtyColor = l.quantity_change > 0 ? 'text-success' : 'text-danger';

        return `
          <tr>
            <td class="text-muted">${new Date(l.created_at).toLocaleString()}</td>
            <td>
              <div class="fw-semibold text-dark">${escapeHtml(l.product_name)}</div>
              <small class="text-muted font-monospace">${escapeHtml(l.product_sku)}</small>
            </td>
            <td class="text-center">${actionBadge}</td>
            <td class="text-center font-monospace fw-bold ${qtyColor}">${qtyDisplay} ${l.unit || 'pcs'}</td>
            <td class="text-center font-monospace small text-muted">${l.previous_stock} &rarr; ${l.new_stock}</td>
            <td class="text-muted">${escapeHtml(l.reason || 'General inventory update')}</td>
            <td class="small text-muted">${escapeHtml(l.user_name || 'System')}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load audit logs:', err);
  }
}

// ================= 7. EXPORT CSV (FR 17) =================

async function handleExportCsv() {
  const token = API.getToken();
  try {
    showToast('Generating CSV business report...');
    const response = await fetch('/api/dashboard/export-report', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Failed to generate export file.');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RetailPulse_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Report downloaded successfully!');
  } catch (err) {
    showToast('Failed to export CSV report: ' + err.message, true);
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

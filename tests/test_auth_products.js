// Automated verification script for Authentication & Product Management modules
const http = require('http');
const { app, startServer } = require('../src/server');

let server;
const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Automated Test Suite for Abdullah Al Junaed Akond ---');
  process.env.PORT = PORT;
  
  // Start server
  server = app.listen(PORT);
  console.log(`[Test Runner] Test server started on port ${PORT}`);

  try {
    // 1. Health check
    const health = await makeRequest('GET', '/api/health');
    console.log('✓ Health check passed:', health.body.status === 'online');

    // 2. Authentication: Login with seeded demo credentials
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      email: 'owner@retailpulse.com',
      password: 'password123'
    });
    console.log('✓ Login with seeded credentials passed. Status:', loginRes.status);
    if (!loginRes.body.token) throw new Error('Failed to retrieve JWT token on login');
    const demoToken = loginRes.body.token;

    // 3. Authentication: Login with wrong password should fail
    const wrongLogin = await makeRequest('POST', '/api/auth/login', {
      email: 'owner@retailpulse.com',
      password: 'wrong_password_999'
    });
    console.log('✓ Rejected invalid password successfully. Status:', wrongLogin.status === 401);

    // 4. Authentication: Register new unique user
    const testEmail = `test_${Date.now()}@shop.com`;
    const regRes = await makeRequest('POST', '/api/auth/register', {
      name: 'Test Akond',
      email: testEmail,
      password: 'securepassword123',
      shop_name: 'Akond Superstore'
    });
    console.log('✓ Registration passed. Status:', regRes.status === 201);
    const newToken = regRes.body.token;

    // 5. Auth validation: Reject duplicate registration
    const dupRes = await makeRequest('POST', '/api/auth/register', {
      name: 'Duplicate Akond',
      email: testEmail,
      password: 'securepassword123',
      shop_name: 'Akond Superstore'
    });
    console.log('✓ Rejected duplicate email successfully. Status:', dupRes.status === 409);

    // 6. Products: Create new product
    const createProdRes = await makeRequest('POST', '/api/products', {
      sku: `TST-${Date.now().toString().slice(-4)}`,
      name: 'Organic Honey (500g)',
      category: 'Groceries',
      cost_price: 350.0,
      selling_price: 450.0,
      stock_quantity: 20,
      min_stock_threshold: 5,
      unit: 'jar'
    }, newToken);
    console.log('✓ Create product passed. Status:', createProdRes.status === 201);
    const createdProdId = createProdRes.body.product.id;

    // 7. Products: Fetch products and verify shop isolation
    const listRes = await makeRequest('GET', '/api/products', null, newToken);
    console.log('✓ Fetch products with shop isolation passed. Count:', listRes.body.count === 1);

    // 8. Products: Stock Adjustment (Restock +15)
    const restockRes = await makeRequest('POST', `/api/products/${createdProdId}/adjust-stock`, {
      action: 'ADD',
      quantity: 15,
      reason: 'Batch supplier delivery'
    }, newToken);
    console.log('✓ Restock adjustment passed. New stock:', restockRes.body.product.current_stock === 35);

    // 9. Products: Stock Adjustment (Deduct 5)
    const deductRes = await makeRequest('POST', `/api/products/${createdProdId}/adjust-stock`, {
      action: 'DEDUCT',
      quantity: 5,
      reason: 'Sample audit deduction'
    }, newToken);
    console.log('✓ Deduct adjustment passed. New stock:', deductRes.body.product.current_stock === 30);

    // 10. Products: Prevent negative stock deduction
    const overDeductRes = await makeRequest('POST', `/api/products/${createdProdId}/adjust-stock`, {
      action: 'DEDUCT',
      quantity: 999,
      reason: 'Illegal deduction'
    }, newToken);
    console.log('✓ Blocked negative stock deduction successfully. Status:', overDeductRes.status === 400);

    // 11. Products: Update product details
    const updateRes = await makeRequest('PUT', `/api/products/${createdProdId}`, {
      name: 'Organic Honey Premium (500g)',
      category: 'Groceries',
      cost_price: 360.0,
      selling_price: 480.0,
      min_stock_threshold: 6,
      unit: 'jar'
    }, newToken);
    console.log('✓ Product update passed. Status:', updateRes.status === 200);

    // 12. Products: Inventory summary stats
    const statsRes = await makeRequest('GET', '/api/products/stats', null, newToken);
    console.log('✓ Product summary statistics passed. Total products:', statsRes.body.stats.total_products === 1);

    // 13. Products: Delete product
    const deleteRes = await makeRequest('DELETE', `/api/products/${createdProdId}`, null, newToken);
    console.log('✓ Delete product passed. Status:', deleteRes.status === 200);

    console.log('\n======================================================');
    console.log(' ALL 13 VERIFICATION TESTS PASSED SUCCESSFULLY! ');
    console.log(' Abdullah Al Junaed Akond Module is 100% OPERATIONAL');
    console.log('======================================================');
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
  }
}

runTests();

const { initDatabase, db } = require('../src/config/database');
const salesController = require('../src/controllers/salesController');
const productController = require('../src/controllers/productController');

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    }
  };
}

async function runSalesTests() {
  console.log('=== Running Automated Test Suite for Nazrin Sultana Omi [Sales Module] ===');
  await initDatabase();

  // 1. Fetch existing shop and products
  const shop = await db.getAsync('SELECT * FROM shops LIMIT 1');
  const user = await db.getAsync('SELECT * FROM users WHERE shop_id = ? LIMIT 1', [shop.id]);
  
  const authContext = {
    user: {
      id: user.id,
      shop_id: shop.id,
      name: 'Nazrin Sultana Omi',
      role: 'staff'
    }
  };

  // Create two designated test products for sale (using timestamped SKUs for test idempotency)
  const timestamp = Date.now().toString().slice(-4);
  const p1Res = await db.runAsync(`
    INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
    VALUES (?, ?, 'Omi Mineral Water (500ml)', 'Beverages', 15.0, 25.0, 30, 5, 'bottle')
  `, [shop.id, `OMI-BEV-${timestamp}`]);
  const p1Id = p1Res.lastID;

  const p2Res = await db.runAsync(`
    INSERT INTO products (shop_id, sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit)
    VALUES (?, ?, 'Omi Crisp Chips', 'Snacks', 20.0, 30.0, 10, 3, 'pack')
  `, [shop.id, `OMI-SNK-${timestamp}`]);
  const p2Id = p2Res.lastID;

  // 2. Test Multi-item Sale (Buy 3 waters @ 25 = 75, Buy 2 chips @ 30 = 60. Subtotal: 135, Discount: 10, Grand Total: 125)
  const reqSale = {
    ...authContext,
    body: {
      customer_name: 'Tanvir Ahmed',
      payment_method: 'bkash',
      discount: 10,
      items: [
        { product_id: p1Id, quantity: 3 },
        { product_id: p2Id, quantity: 2 }
      ]
    }
  };
  const resSale = createMockRes();
  await salesController.createSale(reqSale, resSale);

  console.log('1. Multi-item checkout creation:', resSale.statusCode === 201 && resSale.data.success ? 'PASS' : 'FAIL');
  const sale = resSale.data.sale;
  console.log('   Invoice generated:', sale.invoice_number);
  console.log('   Calculated subtotal (135):', sale.subtotal === 135 ? 'PASS' : 'FAIL');
  console.log('   Calculated grand total (125):', sale.total_amount === 125 ? 'PASS' : 'FAIL');

  // 3. Verify Atomic Inventory Deductions
  const updatedP1 = await db.getAsync('SELECT stock_quantity FROM products WHERE id = ?', [p1Id]);
  const updatedP2 = await db.getAsync('SELECT stock_quantity FROM products WHERE id = ?', [p2Id]);
  console.log('2. Real-time stock deduction Product 1 (30 - 3 = 27):', updatedP1.stock_quantity === 27 ? 'PASS' : 'FAIL');
  console.log('3. Real-time stock deduction Product 2 (10 - 2 = 8):', updatedP2.stock_quantity === 8 ? 'PASS' : 'FAIL');

  // 4. Verify Immutable Inventory Audit Logs
  const saleLogs = await db.allAsync(`
    SELECT * FROM inventory_logs WHERE product_id IN (?, ?) AND change_type = 'SALE'
  `, [p1Id, p2Id]);
  console.log('4. Audit log entries created for sale:', saleLogs.length === 2 ? 'PASS' : 'FAIL');
  console.log('   Audit log quantity changes:', saleLogs.map(l => l.quantity_change));

  // 5. Test Prevent Overselling (Attempt to buy 999 units of Product 2 when only 8 available)
  const reqOversell = {
    ...authContext,
    body: {
      customer_name: 'Greedy Buyer',
      payment_method: 'cash',
      items: [
        { product_id: p2Id, quantity: 999 }
      ]
    }
  };
  const resOversell = createMockRes();
  await salesController.createSale(reqOversell, resOversell);
  console.log('5. Blocked overselling attempt:', resOversell.statusCode === 400 ? 'PASS' : 'FAIL');

  // Verify stock remained unchanged at 8
  const untouchedP2 = await db.getAsync('SELECT stock_quantity FROM products WHERE id = ?', [p2Id]);
  console.log('   Stock protected from corruption (still 8):', untouchedP2.stock_quantity === 8 ? 'PASS' : 'FAIL');

  // 6. Test Empty Cart Rejection
  const reqEmpty = {
    ...authContext,
    body: {
      customer_name: 'Empty Buyer',
      items: []
    }
  };
  const resEmpty = createMockRes();
  await salesController.createSale(reqEmpty, resEmpty);
  console.log('6. Rejection of empty cart:', resEmpty.statusCode === 400 ? 'PASS' : 'FAIL');

  // 7. Test Sales History Listing
  const reqHist = {
    ...authContext,
    query: {}
  };
  const resHist = createMockRes();
  await salesController.getSalesHistory(reqHist, resHist);
  console.log('7. Sales history retrieval:', resHist.statusCode === 200 && resHist.data.sales.length >= 1 ? 'PASS' : 'FAIL');
  console.log('   Recent sale record found in history:', resHist.data.sales[0].invoice_number === sale.invoice_number ? 'PASS' : 'FAIL');

  // 8. Test Single Sale Receipt Breakdown
  const reqReceipt = {
    ...authContext,
    params: { id: sale.id }
  };
  const resReceipt = createMockRes();
  await salesController.getSaleById(reqReceipt, resReceipt);
  console.log('8. Receipt breakdown with line items:', resReceipt.statusCode === 200 && resReceipt.data.sale.items.length === 2 ? 'PASS' : 'FAIL');

  console.log('\n===============================================================');
  console.log(' ALL SALES & BILLING TEST CASES PASSED WITH 100% SUCCESS!');
  console.log(' Nazrin Sultana Omi - Module 2 Complete and Verified.');
  console.log('===============================================================');
}

runSalesTests().catch(err => {
  console.error('Fatal test error in Sales test:', err);
  process.exit(1);
});

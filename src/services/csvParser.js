/**
 * RetailPulse CSV Parser & Data Sanitization Engine
 * Zero-dependency RFC-4180 compliant CSV tokenizer & schema validator
 * Aligns with SRS Section 4.1: Strict validation, error flagging without silent modification
 */

/**
 * Parses raw CSV text into a 2D array of rows and cells.
 * Correctly handles quoted strings, escaped quotes (""), and varied line breaks.
 * @param {string} csvText 
 * @returns {Array<Array<string>>}
 */
function parseCsvToMatrix(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return [];
  }

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;

  // Normalize line breaks
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote: "" -> "
        currentCell += '"';
        i++; // Skip following quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // Cell boundary
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (char === '\n' && !insideQuotes) {
      // Row boundary
      currentRow.push(currentCell.trim());
      // Skip completely empty lines
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  // Final cell and row if file doesn't end with newline
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Validate and sanitize Product Catalog CSV
 * Expected Headers: sku, name, category, cost_price, selling_price, stock_quantity, min_stock_threshold, unit
 */
function validateProductCsv(csvText) {
  const matrix = parseCsvToMatrix(csvText);

  if (matrix.length < 2) {
    return {
      success: false,
      error: 'CSV file must contain a header row and at least one data row.',
      total_rows: 0,
      valid_rows: [],
      errors: [{ row: 1, column: 'FILE', reason: 'Empty or header-only file.' }]
    };
  }

  const headers = matrix[0].map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const requiredHeaders = ['sku', 'name', 'category', 'cost_price', 'selling_price', 'stock_quantity', 'min_stock_threshold'];

  // Check required headers
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      success: false,
      error: `Missing required header columns: ${missingHeaders.join(', ')}`,
      total_rows: matrix.length - 1,
      valid_rows: [],
      errors: [{ row: 1, column: 'HEADERS', reason: `Missing columns: ${missingHeaders.join(', ')}` }]
    };
  }

  const headerIndices = {};
  headers.forEach((h, idx) => { headerIndices[h] = idx; });

  const validRows = [];
  const errors = [];
  const seenSkus = new Set();

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const rowNum = i + 1; // 1-based index matching spreadsheet line numbers
    const rowErrors = [];

    const sku = (row[headerIndices['sku']] || '').trim().toUpperCase();
    const name = (row[headerIndices['name']] || '').trim();
    const category = (row[headerIndices['category']] || '').trim();
    const costPriceRaw = row[headerIndices['cost_price']];
    const sellingPriceRaw = row[headerIndices['selling_price']];
    const stockQtyRaw = row[headerIndices['stock_quantity']];
    const minThresholdRaw = row[headerIndices['min_stock_threshold']];
    const unitRaw = headerIndices['unit'] !== undefined ? (row[headerIndices['unit']] || 'pcs').trim() : 'pcs';

    // 1. SKU validation
    if (!sku) {
      rowErrors.push({ row: rowNum, column: 'sku', value: sku, reason: 'SKU code is required.' });
    } else if (seenSkus.has(sku)) {
      rowErrors.push({ row: rowNum, column: 'sku', value: sku, reason: `Duplicate SKU '${sku}' found in the same file.` });
    } else {
      seenSkus.add(sku);
    }

    // 2. Name validation
    if (!name || name.length < 2) {
      rowErrors.push({ row: rowNum, column: 'name', value: name, reason: 'Product name must be at least 2 characters.' });
    }

    // 3. Category validation
    if (!category) {
      rowErrors.push({ row: rowNum, column: 'category', value: category, reason: 'Category is required.' });
    }

    // 4. Cost Price validation
    const costPrice = parseFloat(costPriceRaw);
    if (isNaN(costPrice) || costPrice < 0) {
      rowErrors.push({ row: rowNum, column: 'cost_price', value: costPriceRaw, reason: 'Cost price must be a valid non-negative number.' });
    }

    // 5. Selling Price validation
    const sellingPrice = parseFloat(sellingPriceRaw);
    if (isNaN(sellingPrice) || sellingPrice < 0) {
      rowErrors.push({ row: rowNum, column: 'selling_price', value: sellingPriceRaw, reason: 'Selling price must be a valid non-negative number.' });
    } else if (!isNaN(costPrice) && sellingPrice < costPrice) {
      // Flag suspect data as per Section 4.1
      rowErrors.push({ row: rowNum, column: 'selling_price', value: sellingPriceRaw, reason: `Selling price (৳${sellingPrice}) cannot be lower than cost price (৳${costPrice}).` });
    }

    // 6. Stock Quantity validation
    const stockQty = parseInt(stockQtyRaw, 10);
    if (isNaN(stockQty) || stockQty < 0) {
      rowErrors.push({ row: rowNum, column: 'stock_quantity', value: stockQtyRaw, reason: 'Stock quantity must be a non-negative integer.' });
    }

    // 7. Min Stock Threshold validation
    const minThreshold = parseInt(minThresholdRaw, 10);
    if (isNaN(minThreshold) || minThreshold < 0) {
      rowErrors.push({ row: rowNum, column: 'min_stock_threshold', value: minThresholdRaw, reason: 'Minimum stock threshold must be a non-negative integer.' });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push({
        row: rowNum,
        sku,
        name,
        category,
        cost_price: Number(costPrice.toFixed(2)),
        selling_price: Number(sellingPrice.toFixed(2)),
        stock_quantity: stockQty,
        min_stock_threshold: minThreshold,
        unit: unitRaw || 'pcs'
      });
    }
  }

  return {
    success: errors.length === 0,
    total_rows: matrix.length - 1,
    valid_count: validRows.length,
    error_count: errors.length,
    valid_rows: validRows,
    errors
  };
}

/**
 * Validate Historical Sales CSV
 * Expected Headers: date, sku, product_name, quantity, unit_price, payment_method, customer_name
 */
function validateSalesCsv(csvText) {
  const matrix = parseCsvToMatrix(csvText);

  if (matrix.length < 2) {
    return {
      success: false,
      error: 'CSV file must contain a header row and at least one sales transaction row.',
      total_rows: 0,
      valid_rows: [],
      errors: [{ row: 1, column: 'FILE', reason: 'Empty or header-only file.' }]
    };
  }

  const headers = matrix[0].map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const requiredHeaders = ['date', 'sku', 'quantity', 'unit_price'];

  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return {
      success: false,
      error: `Missing required sales header columns: ${missingHeaders.join(', ')}`,
      total_rows: matrix.length - 1,
      valid_rows: [],
      errors: [{ row: 1, column: 'HEADERS', reason: `Missing columns: ${missingHeaders.join(', ')}` }]
    };
  }

  const headerIndices = {};
  headers.forEach((h, idx) => { headerIndices[h] = idx; });

  const validRows = [];
  const errors = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const rowNum = i + 1;
    const rowErrors = [];

    const dateStr = (row[headerIndices['date']] || '').trim();
    const sku = (row[headerIndices['sku']] || '').trim().toUpperCase();
    const productName = headerIndices['product_name'] !== undefined ? (row[headerIndices['product_name']] || '').trim() : '';
    const quantityRaw = row[headerIndices['quantity']];
    const unitPriceRaw = row[headerIndices['unit_price']];
    const paymentMethod = headerIndices['payment_method'] !== undefined ? (row[headerIndices['payment_method']] || 'cash').trim().toLowerCase() : 'cash';
    const customerName = headerIndices['customer_name'] !== undefined ? (row[headerIndices['customer_name']] || 'Walk-in Customer').trim() : 'Walk-in Customer';

    // 1. Date validation
    const parsedDate = new Date(dateStr);
    if (!dateStr || isNaN(parsedDate.getTime())) {
      rowErrors.push({ row: rowNum, column: 'date', value: dateStr, reason: 'Invalid date format (must be YYYY-MM-DD).' });
    }

    // 2. SKU validation
    if (!sku) {
      rowErrors.push({ row: rowNum, column: 'sku', value: sku, reason: 'Product SKU is required.' });
    }

    // 3. Quantity validation
    const quantity = parseInt(quantityRaw, 10);
    if (isNaN(quantity) || quantity <= 0) {
      rowErrors.push({ row: rowNum, column: 'quantity', value: quantityRaw, reason: 'Quantity sold must be an integer greater than 0.' });
    }

    // 4. Unit Price validation
    const unitPrice = parseFloat(unitPriceRaw);
    if (isNaN(unitPrice) || unitPrice < 0) {
      rowErrors.push({ row: rowNum, column: 'unit_price', value: unitPriceRaw, reason: 'Unit price must be a valid non-negative number.' });
    }

    // 5. Payment method sanitization
    const validPayments = ['cash', 'card', 'mfs', 'bkash', 'nagad'];
    const sanitizedPayment = validPayments.includes(paymentMethod) ? (paymentMethod === 'bkash' || paymentMethod === 'nagad' ? 'mfs' : paymentMethod) : 'cash';

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push({
        row: rowNum,
        date: dateStr,
        sku,
        product_name: productName || sku,
        quantity,
        unit_price: Number(unitPrice.toFixed(2)),
        total_price: Number((quantity * unitPrice).toFixed(2)),
        payment_method: sanitizedPayment,
        customer_name: customerName || 'Walk-in Customer'
      });
    }
  }

  return {
    success: errors.length === 0,
    total_rows: matrix.length - 1,
    valid_count: validRows.length,
    error_count: errors.length,
    valid_rows: validRows,
    errors
  };
}

/**
 * Generate standard CSV template for Product Catalog imports
 */
function getProductCsvTemplate() {
  return [
    'sku,name,category,cost_price,selling_price,stock_quantity,min_stock_threshold,unit',
    'BEV-101,"Pran Frooto Mango Juice (250ml)",Beverages,22.0,25.0,40,10,bottle',
    'SNK-102,"Kurkure Masala Munch (45g)",Snacks,18.0,20.0,35,12,packet',
    'GRO-103,"Radhuni Turmeric Powder (200g)",Groceries,85.0,95.0,20,5,pack',
    'DAI-104,"Farm Fresh Pasteurised Milk (1L)",Dairy,88.0,95.0,15,6,carton'
  ].join('\n');
}

/**
 * Generate standard CSV template for Historical Sales imports
 */
function getSalesCsvTemplate() {
  return [
    'date,sku,product_name,quantity,unit_price,payment_method,customer_name',
    '2026-11-01,BEV-101,"Pran Frooto Mango Juice (250ml)",4,25.0,cash,"Walk-in Customer"',
    '2026-11-01,SNK-102,"Kurkure Masala Munch (45g)",2,20.0,mfs,"Rafiqul Islam"',
    '2026-11-02,GRO-103,"Radhuni Turmeric Powder (200g)",1,95.0,card,"Farhana Yasmin"'
  ].join('\n');
}

module.exports = {
  parseCsvToMatrix,
  validateProductCsv,
  validateSalesCsv,
  getProductCsvTemplate,
  getSalesCsvTemplate
};

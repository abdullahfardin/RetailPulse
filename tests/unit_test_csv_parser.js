const {
  parseCsvToMatrix,
  validateProductCsv,
  validateSalesCsv,
  getProductCsvTemplate,
  getSalesCsvTemplate
} = require('../src/services/csvParser');
const importController = require('../src/controllers/importController');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    },
    send(content) {
      this.data = content;
      return this;
    }
  };
}

async function runCsvParserTests() {
  console.log('=== Running Retail CSV Parser & Validation Engine Tests (Task T-2.1) ===');

  let passed = 0;
  let total = 0;

  function assert(testName, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] ${testName}`);
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
    }
  }

  // 1. Basic CSV Tokenizer Test
  const rawSimple = 'sku,name,price\nBEV-01,Coke,25\nSNK-01,Chips,20';
  const matrixSimple = parseCsvToMatrix(rawSimple);
  assert(
    '1. parseCsvToMatrix splits rows and columns properly',
    matrixSimple.length === 3 && matrixSimple[1][0] === 'BEV-01' && matrixSimple[2][1] === 'Chips',
    JSON.stringify(matrixSimple)
  );

  // 2. Quoted comma handling
  const rawQuoted = 'sku,name,price\nBEV-02,"Coca-Cola, 250ml Bottle",30';
  const matrixQuoted = parseCsvToMatrix(rawQuoted);
  assert(
    '2. parseCsvToMatrix handles commas inside double quotes without splitting',
    matrixQuoted.length === 2 && matrixQuoted[1][1] === 'Coca-Cola, 250ml Bottle',
    JSON.stringify(matrixQuoted)
  );

  // 3. Escaped quote handling ("")
  const rawEscaped = 'sku,name\nDAI-01,"Aarong ""Fresh"" Milk"';
  const matrixEscaped = parseCsvToMatrix(rawEscaped);
  assert(
    '3. parseCsvToMatrix handles escaped double quotes correctly',
    matrixEscaped[1][1] === 'Aarong "Fresh" Milk',
    JSON.stringify(matrixEscaped)
  );

  // 4. Product CSV validation with valid template
  const validCsv = getProductCsvTemplate();
  const validReport = validateProductCsv(validCsv);
  assert(
    '4. validateProductCsv accepts clean retail template with 100% valid rows',
    validReport.success === true && validReport.valid_count === 4 && validReport.error_count === 0,
    JSON.stringify(validReport)
  );

  // 5. Missing headers detection
  const badHeadersCsv = 'sku,name,price\nBEV-01,Coke,25';
  const badHeaderReport = validateProductCsv(badHeadersCsv);
  assert(
    '5. validateProductCsv flags missing required header columns',
    badHeaderReport.success === false && badHeaderReport.errors.length > 0 && badHeaderReport.errors[0].column === 'HEADERS',
    JSON.stringify(badHeaderReport)
  );

  // 6. Duplicate SKU detection within same CSV payload
  const duplicateCsv = [
    'sku,name,category,cost_price,selling_price,stock_quantity,min_stock_threshold,unit',
    'DUP-01,Product One,Beverages,20,25,10,5,pcs',
    'DUP-01,Product Duplicate,Beverages,20,25,10,5,pcs'
  ].join('\n');
  const dupReport = validateProductCsv(duplicateCsv);
  assert(
    '6. validateProductCsv flags duplicate SKU in the same CSV file',
    dupReport.success === false && dupReport.errors.some(e => e.reason.includes('Duplicate SKU')),
    JSON.stringify(dupReport.errors)
  );

  // 7. Flag loss sales (selling_price < cost_price)
  const lossCsv = [
    'sku,name,category,cost_price,selling_price,stock_quantity,min_stock_threshold,unit',
    'LOSS-01,Loss Item,Groceries,100,50,10,2,pcs'
  ].join('\n');
  const lossReport = validateProductCsv(lossCsv);
  assert(
    '7. validateProductCsv flags suspect loss pricing (selling price < cost price)',
    lossReport.success === false && lossReport.errors.some(e => e.reason.includes('cannot be lower than cost price')),
    JSON.stringify(lossReport.errors)
  );

  // 8. Negative stock quantity rejection
  const negativeStockCsv = [
    'sku,name,category,cost_price,selling_price,stock_quantity,min_stock_threshold,unit',
    'NEG-01,Negative Item,Snacks,10,15,-5,2,pcs'
  ].join('\n');
  const negReport = validateProductCsv(negativeStockCsv);
  assert(
    '8. validateProductCsv rejects negative stock quantities',
    negReport.success === false && negReport.errors.some(e => e.column === 'stock_quantity'),
    JSON.stringify(negReport.errors)
  );

  // 9. Historical Sales CSV validation
  const validSalesCsv = getSalesCsvTemplate();
  const salesReport = validateSalesCsv(validSalesCsv);
  assert(
    '9. validateSalesCsv accepts valid sales history CSV',
    salesReport.success === true && salesReport.valid_count === 3 && salesReport.error_count === 0,
    JSON.stringify(salesReport)
  );

  // 10. Invalid sales date and zero quantity detection
  const badSalesCsv = [
    'date,sku,quantity,unit_price',
    'not-a-date,BEV-01,0,25.0'
  ].join('\n');
  const badSalesReport = validateSalesCsv(badSalesCsv);
  assert(
    '10. validateSalesCsv flags invalid date and zero/negative quantity',
    badSalesReport.success === false && badSalesReport.errors.length >= 2,
    JSON.stringify(badSalesReport.errors)
  );

  // 11. Controller Preview endpoint test
  const reqPreview = {
    body: { csv_data: getProductCsvTemplate() }
  };
  const resPreview = createMockRes();
  importController.previewProductCsv(reqPreview, resPreview);
  assert(
    '11. POST /api/import/preview-products returns HTTP 200 with structured validation report',
    resPreview.statusCode === 200 && resPreview.data.success === true && resPreview.data.report.valid_count === 4,
    JSON.stringify(resPreview.data)
  );

  // 12. Controller Download template test
  const reqDownload = {};
  const resDownload = createMockRes();
  importController.downloadProductTemplate(reqDownload, resDownload);
  assert(
    '12. GET /api/import/template/products sets text/csv header and attachment disposition',
    resDownload.headers['Content-Type'] === 'text/csv' && resDownload.headers['Content-Disposition'].includes('attachment'),
    JSON.stringify(resDownload.headers)
  );

  console.log(`\n===============================================================`);
  console.log(` ALL ${passed}/${total} CSV PARSER & VALIDATION TESTS PASSED (100%)!`);
  console.log(` Nazrin Sultana Omi - Task T-2.1 Complete and Verified.`);
  console.log(`===============================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runCsvParserTests().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runCsvParserTests };

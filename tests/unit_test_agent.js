const { initDatabase, db } = require('../src/config/database');
const agentController = require('../src/controllers/agentController');
const { GEMINI_MODEL } = require('../src/config/gemini');

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

async function runAgentUnitTests() {
  console.log('=== Running Agentic AI Controller Unit Tests (T-1.1) ===');
  await initDatabase();

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

  // 1. Test getAgentStatus returns 200 and correct configuration
  const reqStatus = { query: {} };
  const resStatus = createMockRes();
  await agentController.getAgentStatus(reqStatus, resStatus);
  assert(
    '1. Agent health & status returns HTTP 200 with model name',
    resStatus.statusCode === 200 && resStatus.data.success && resStatus.data.model === GEMINI_MODEL,
    JSON.stringify(resStatus.data)
  );

  // 2. Test getAgentStatus lists core agent capabilities
  assert(
    '2. Agent status exposes defined retail capabilities',
    Array.isArray(resStatus.data.capabilities) && resStatus.data.capabilities.length >= 3,
    JSON.stringify(resStatus.data.capabilities)
  );

  // 3. Test buildSystemInstruction includes shop and persona metadata
  const mockUser = { name: 'Abdullah Al Junaed', role: 'owner' };
  const mockShop = { name: 'Junaed Superstore', currency: 'BDT' };
  const prompt = agentController.buildSystemInstruction(mockUser, mockShop);
  assert(
    '3. System instruction builds correct store and user context',
    prompt.includes('Junaed Superstore') && prompt.includes('BDT') && prompt.includes('Abdullah Al Junaed'),
    prompt
  );

  // 4. Test processChat rejects empty message
  const reqEmpty = {
    body: { message: '' },
    user: { shop_id: 1, name: 'Owner' }
  };
  const resEmpty = createMockRes();
  await agentController.processChat(reqEmpty, resEmpty);
  assert(
    '4. Rejection of empty chat message with HTTP 400',
    resEmpty.statusCode === 400 && resEmpty.data.success === false,
    JSON.stringify(resEmpty.data)
  );

  // 5. Test processChat rejects non-string message
  const reqInvalid = {
    body: { message: 12345 },
    user: { shop_id: 1, name: 'Owner' }
  };
  const resInvalid = createMockRes();
  await agentController.processChat(reqInvalid, resInvalid);
  assert(
    '5. Rejection of non-string payload with HTTP 400',
    resInvalid.statusCode === 400 && resInvalid.data.success === false,
    JSON.stringify(resInvalid.data)
  );

  // 6. Test processChat executes and returns clean response (or FR 18 graceful fallback)
  const reqChat = {
    body: {
      message: 'Hello, what products do we have in stock?',
      history: [
        { role: 'user', text: 'Hi' },
        { role: 'model', text: 'Hello! How can I assist with your retail operations today?' }
      ]
    },
    user: { shop_id: 1, name: 'Abdullah Al Junaed', role: 'owner' }
  };
  const resChat = createMockRes();
  await agentController.processChat(reqChat, resChat);
  assert(
    '6. Process chat produces structured response without crashing',
    resChat.statusCode === 200 && resChat.data.success === true && typeof resChat.data.message === 'string',
    JSON.stringify(resChat.data)
  );

  // 7. Verify FR 18 Fallback message structure if offline
  assert(
    '7. Chat response contains timestamp and model metadata',
    resChat.data.model === GEMINI_MODEL && !!resChat.data.timestamp,
    JSON.stringify(resChat.data)
  );

  console.log(`\nAgent Unit Test Suite: ${passed}/${total} Tests Passed.`);
  console.log('✓ Abdullah Al Junaed Akond - Task T-1.1 Agent Controller Verified.\n');

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAgentUnitTests().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runAgentUnitTests };

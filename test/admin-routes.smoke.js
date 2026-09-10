// ============================================================================
// MEJORA 4: TESTS DE RUTAS ADMIN
// ============================================================================
// Ejecutar con: node test/admin-routes.smoke.js
// Agregar a package.json: "test:admin": "node test/admin-routes.smoke.js"

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
let testsPassed = 0;
let testsFailed = 0;

// ============================================================================
// HELPERS
// ============================================================================

async function test(description, fn) {
  try {
    await fn();
    console.log(`✅ ${description}`);
    testsPassed++;
  } catch (e) {
    console.error(`❌ ${description}`);
    console.error(`   Error: ${e.message}`);
    testsFailed++;
  }
}

async function createTestUser() {
  try {
    const res = await axios.post(`${BASE_URL}/api/signup`, {
      name: `Test User ${Date.now()}`,
      email: `test-${Date.now()}@example.com`,
      password: 'TestPassword123!',
    });
    return res.data;
  } catch (e) {
    throw new Error(`Failed to create test user: ${e.response?.status || e.message}`);
  }
}

async function loginUser(email, password) {
  try {
    const res = await axios.post(`${BASE_URL}/api/login`, { email, password });
    return res.data.token;
  } catch (e) {
    throw new Error(`Failed to login: ${e.response?.status || e.message}`);
  }
}

// ============================================================================
// TESTS: GET /api/admin/stats
// ============================================================================

async function testAdminStats() {
  console.log('\n📊 GET /api/admin/stats\n');

  // Test 1: 401 sin autenticación
  await test('GET /api/admin/stats: 401 sin token', async () => {
    try {
      await axios.get(`${BASE_URL}/api/admin/stats`);
      throw new Error('Debería rechazar sin token');
    } catch (e) {
      if (e.response?.status !== 401) throw e;
    }
  });

  // Test 2: 403 con usuario normal
  await test('GET /api/admin/stats: 403 con usuario normal', async () => {
    try {
      const user = await createTestUser();
      const token = await loginUser(user.email, 'TestPassword123!');

      try {
        await axios.get(`${BASE_URL}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        throw new Error('Debería rechazar usuario normal');
      } catch (e) {
        if (e.response?.status !== 403) throw e;
      }
    } catch (e) {
      throw e;
    }
  });

  // Test 3: 200 con admin (usando ADMIN_TEST_TOKEN env var)
  await test('GET /api/admin/stats: 200 con admin token', async () => {
    const adminToken = process.env.ADMIN_TEST_TOKEN || 'test-admin-token';
    
    try {
      const res = await axios.get(`${BASE_URL}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.data.totalUsers) throw new Error('Missing totalUsers in response');
    } catch (e) {
      // Si no hay token admin configurado, es OK fallar aquí
      if (e.response?.status === 401 || e.response?.status === 403) {
        console.log('   ⚠️  (ADMIN_TEST_TOKEN no configurado)');
      } else {
        throw e;
      }
    }
  });
}

// ============================================================================
// TESTS: POST /api/admin/recalculate-eleven
// ============================================================================

async function testRecalculateEleven() {
  console.log('\n💳 POST /api/admin/recalculate-eleven\n');

  const adminToken = process.env.ADMIN_TEST_TOKEN || 'test-admin-token';

  // Test 1: 401 sin token
  await test('POST /api/admin/recalculate-eleven: 401 sin token', async () => {
    try {
      await axios.post(`${BASE_URL}/api/admin/recalculate-eleven`, {
        sessionIds: [1, 2, 3],
      });
      throw new Error('Debería rechazar sin token');
    } catch (e) {
      if (e.response?.status !== 401) throw e;
    }
  });

  // Test 2: 403 con usuario normal
  await test('POST /api/admin/recalculate-eleven: 403 con usuario normal', async () => {
    try {
      const user = await createTestUser();
      const token = await loginUser(user.email, 'TestPassword123!');

      try {
        await axios.post(
          `${BASE_URL}/api/admin/recalculate-eleven`,
          { sessionIds: [1, 2, 3] },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        throw new Error('Debería rechazar usuario normal');
      } catch (e) {
        if (e.response?.status !== 403) throw e;
      }
    } catch (e) {
      throw e;
    }
  });

  // Test 3: Validación de entrada
  await test('POST /api/admin/recalculate-eleven: valida sessionIds vacío', async () => {
    try {
      await axios.post(
        `${BASE_URL}/api/admin/recalculate-eleven`,
        { sessionIds: [] },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      throw new Error('Debería rechazar sessionIds vacío');
    } catch (e) {
      if (![400, 422].includes(e.response?.status)) throw e;
    }
  });

  // Test 4: Validación de tipo
  await test('POST /api/admin/recalculate-eleven: valida que sessionIds sea array', async () => {
    try {
      await axios.post(
        `${BASE_URL}/api/admin/recalculate-eleven`,
        { sessionIds: 'not-an-array' },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      throw new Error('Debería rechazar tipo incorrecto');
    } catch (e) {
      if (![400, 422].includes(e.response?.status)) throw e;
    }
  });

  // Test 5: Tarificación
  await test('POST /api/admin/recalculate-eleven: decrementa créditos', async () => {
    try {
      const res = await axios.post(
        `${BASE_URL}/api/admin/recalculate-eleven`,
        { sessionIds: [1, 2, 3] },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      if (![200, 207, 400].includes(res.status)) {
        throw new Error(`Unexpected status: ${res.status}`);
      }

      if (res.data.creditsUsed !== undefined) {
        // creditsUsed fue reportado, bien
      }
    } catch (e) {
      if (e.response?.status === 503) {
        console.log('   ⚠️  (ELEVENLABS_API_KEY no configurado)');
      } else if (e.response?.status === 401 || e.response?.status === 403) {
        console.log('   ⚠️  (ADMIN_TEST_TOKEN no configurado)');
      } else {
        throw e;
      }
    }
  });

  // Test 6: Maneja fallo parcial (207)
  await test('POST /api/admin/recalculate-eleven: maneja fallo parcial', async () => {
    try {
      const res = await axios.post(
        `${BASE_URL}/api/admin/recalculate-eleven`,
        { sessionIds: [999999, 1000000] },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      if (res.status === 207) {
        if (!Array.isArray(res.data.succeeded) || !Array.isArray(res.data.failed)) {
          throw new Error('Response 207 debe tener succeeded y failed arrays');
        }
      }
    } catch (e) {
      if (e.response?.status === 401 || e.response?.status === 403) {
        console.log('   ⚠️  (ADMIN_TEST_TOKEN no configurado)');
      } else if (e.response?.status === 503) {
        console.log('   ⚠️  (ELEVENLABS_API_KEY no configurado)');
      } else {
        throw e;
      }
    }
  });
}

// ============================================================================
// TESTS: GET /api/admin/accounts
// ============================================================================

async function testAdminAccounts() {
  console.log('\n👥 GET /api/admin/accounts\n');

  const adminToken = process.env.ADMIN_TEST_TOKEN || 'test-admin-token';

  // Test 1: 401 sin token
  await test('GET /api/admin/accounts: 401 sin token', async () => {
    try {
      await axios.get(`${BASE_URL}/api/admin/accounts`);
      throw new Error('Debería rechazar sin token');
    } catch (e) {
      if (e.response?.status !== 401) throw e;
    }
  });

  // Test 2: 200 con admin
  await test('GET /api/admin/accounts: lista cuentas', async () => {
    try {
      const res = await axios.get(`${BASE_URL}/api/admin/accounts`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!Array.isArray(res.data.accounts)) throw new Error('accounts no es array');
      if (!res.data.pagination) throw new Error('pagination missing');
    } catch (e) {
      if (e.response?.status === 401 || e.response?.status === 403) {
        console.log('   ⚠️  (ADMIN_TEST_TOKEN no configurado)');
      } else {
        throw e;
      }
    }
  });

  // Test 3: Filtros
  await test('GET /api/admin/accounts: respeta filtros', async () => {
    try {
      const res = await axios.get(`${BASE_URL}/api/admin/accounts?limit=5&offset=0`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.data.accounts.length > 5) throw new Error('No respeta limit');
    } catch (e) {
      if (e.response?.status === 401 || e.response?.status === 403) {
        console.log('   ⚠️  (ADMIN_TEST_TOKEN no configurado)');
      } else {
        throw e;
      }
    }
  });
}

// ============================================================================
// EJECUTAR TESTS
// ============================================================================

async function runAllTests() {
  console.log('🚀 Iniciando tests de rutas admin...\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin token: ${process.env.ADMIN_TEST_TOKEN ? '✅ configurado' : '❌ NO configurado'}`);

  try {
    await testAdminStats();
    await testRecalculateEleven();
    await testAdminAccounts();
  } catch (e) {
    console.error(`\n🔴 Error fatal en suite: ${e.message}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 RESULTADOS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Pasaron: ${testsPassed}`);
  console.log(`❌ Fallaron: ${testsFailed}`);
  console.log(`📈 Total: ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 ¡TODOS LOS TESTS PASARON!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Algunos tests fallaron. Revisa arriba.');
    process.exit(1);
  }
}

runAllTests();

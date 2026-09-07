// Smoke test para el modo "dummy" de pagos: mientras no haya
// WAVA_MERCHANT_KEY configurada, /api/billing/checkout y
// /api/billing/gift-checkout simulan el pago de una en vez de responder
// 501 — para poder probar el resto del flujo (plan activo, código de
// regalo, canje) sin depender de la cuenta real de Wava todavía.
//
// A propósito, este archivo NO define process.env.WAVA_MERCHANT_KEY — así
// PAGOS_DUMMY queda en true, igual que en un despliegue real sin esa
// variable configurada (ver BACKLOG.md #11). test/billing.smoke.js cubre
// el camino real (con Wava configurada) por separado.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'ci-cron-secret';
delete process.env.WAVA_MERCHANT_KEY;
delete process.env.RESEND_API_KEY;

const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

const users = {
  1: { id: 1, username: 'usuarioa', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Usuaria A', email: 'a@example.com' },
  2: { id: 2, username: 'usuariob', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Usuario B', email: null },
};

let subscriptions = {}; // user_id -> row
let nextSubId = 1;
let billingOrders = []; // lista simple, no hace falta indexar por order_key acá
let nextOrderId = 1;
let giftRedemptions = {}; // code -> row
let nextGiftId = 1;

function fakeSql(strings, ...values) {
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE') || text.includes('CREATE INDEX')) return Promise.resolve([]);
  if (text.includes('rate_limits')) return Promise.resolve([{ count: 1 }]);

  if (text.includes('SELECT id, username, password_hash, token_version FROM users WHERE username')) {
    const u = Object.values(users).find((x) => x.username === values[0]);
    return Promise.resolve(u ? [{ id: u.id, username: u.username, password_hash: u.password_hash, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT owner_user_id, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ owner_user_id: u.owner_user_id, token_version: u.token_version }] : []);
  }
  if (text.includes('SELECT id FROM subscriptions WHERE user_id')) {
    const s = subscriptions[values[0]];
    return Promise.resolve(s ? [{ id: s.id }] : []);
  }
  if (text.includes('INSERT INTO subscriptions (user_id, plan_id, periodo, status)')) {
    const [userId, planId, periodo] = values;
    const id = nextSubId++;
    subscriptions[userId] = { id, user_id: userId, plan_id: planId, periodo, status: 'trialing', current_period_end: null, cancel_at_period_end: false };
    return Promise.resolve([{ id }]);
  }

  // --- Checkout dummy: INSERT ya como 'paid' (7 values) + UPDATE en la misma transacción ---
  if (text.includes("VALUES (?, ?, ?, NULL, ?, ?, ?, 'paid', ?)")) {
    const [subscriptionId, userId, orderKey, link, concepto, montoCop, planId] = values;
    const id = nextOrderId++;
    billingOrders.push({ id, subscription_id: subscriptionId, user_id: userId, order_key: orderKey, wava_link: link, concepto, monto_cop: montoCop, plan_id: planId, status: 'paid' });
    return Promise.resolve([]);
  }
  if (text.includes("UPDATE subscriptions SET status = 'active'") && text.includes('::interval')) {
    const [intervalo, subId] = values;
    const s = Object.values(subscriptions).find((x) => x.id === subId);
    if (s) {
      s.status = 'active';
      const meses = intervalo === '1 month' ? 1 : 12;
      const d = new Date(); d.setMonth(d.getMonth() + meses);
      s.current_period_end = d.toISOString();
      s.grace_until = null;
    }
    return Promise.resolve([]);
  }

  // --- Gift-checkout dummy: INSERT ya como 'paid' (7 values, RETURNING id) ---
  if (text.includes("VALUES (NULL, ?, ?, NULL, ?, ?, ?, 'paid', 'regalo', ?, ?)")) {
    const [userId, orderKey, link, concepto, montoCop, sendOn, giftMessage] = values;
    const id = nextOrderId++;
    billingOrders.push({ id, subscription_id: null, user_id: userId, order_key: orderKey, wava_link: link, concepto, monto_cop: montoCop, plan_id: 'regalo', status: 'paid', send_on: sendOn, gift_message: giftMessage });
    return Promise.resolve([{ id }]);
  }
  if (text.includes('SELECT 1 FROM gift_redemptions WHERE code')) {
    return Promise.resolve(giftRedemptions[values[0]] ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('INSERT INTO gift_redemptions (code, billing_order_id, bought_by_user_id, plan_id, meses, send_on, gift_message)')) {
    const [code, billingOrderId, boughtByUserId, sendOn, giftMessage] = values;
    const id = nextGiftId++;
    giftRedemptions[code] = { id, code, billing_order_id: billingOrderId, bought_by_user_id: boughtByUserId, plan_id: 'regalo', redeemed_by_user_id: null, send_on: sendOn, gift_message: giftMessage, email_sent_at: null };
    return Promise.resolve([{ id }]);
  }
  // --- Marca de correo enviado (inmediato o desde el cron) -- claim atómico ---
  if (text.includes('UPDATE gift_redemptions SET email_sent_at = now()')) {
    const [id] = values;
    const g = Object.values(giftRedemptions).find((x) => x.id === id);
    if (!g || g.email_sent_at) return Promise.resolve([]);
    g.email_sent_at = new Date().toISOString();
    return Promise.resolve([{ id }]);
  }
  if (text.includes('SELECT id, code, bought_by_user_id, gift_message FROM gift_redemptions')) {
    const hoy = new Date().toISOString().slice(0, 10);
    const pendientes = Object.values(giftRedemptions).filter((g) => g.send_on && g.send_on <= hoy && !g.email_sent_at);
    return Promise.resolve(pendientes.map((g) => ({ id: g.id, code: g.code, bought_by_user_id: g.bought_by_user_id, gift_message: g.gift_message })));
  }
  if (text.includes('SELECT email, name, username FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ email: u.email, name: u.name, username: u.username }] : []);
  }

  // --- redeem-gift: claim atómico (P1 de seguridad, 2026-09-05) ---
  if (text.includes('UPDATE gift_redemptions') && text.includes('redeemed_by_user_id = ') && text.includes('IS NULL')) {
    const [userId, code] = values;
    const g = giftRedemptions[code];
    if (!g || g.redeemed_by_user_id) return Promise.resolve([]);
    g.redeemed_by_user_id = userId;
    return Promise.resolve([{ id: g.code, plan_id: g.plan_id }]);
  }
  if (text.includes('SELECT redeemed_by_user_id FROM gift_redemptions WHERE code')) {
    const g = giftRedemptions[values[0]];
    return Promise.resolve(g ? [{ redeemed_by_user_id: g.redeemed_by_user_id }] : []);
  }
  if (text.includes("cancel_at_period_end = true") && text.includes('UPDATE subscriptions')) {
    const [planId, subId] = values;
    const s = Object.values(subscriptions).find((x) => x.id === subId);
    if (s) { s.plan_id = planId; s.status = 'active'; s.cancel_at_period_end = true; }
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO subscriptions (user_id, plan_id, periodo, status, current_period_end, cancel_at_period_end)')) {
    const [userId, planId] = values;
    const id = nextSubId++;
    subscriptions[userId] = { id, user_id: userId, plan_id: planId, status: 'active', cancel_at_period_end: true };
    return Promise.resolve([]);
  }
  if (text.includes('SELECT plan_id, periodo, status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id')) {
    const s = subscriptions[values[0]];
    return Promise.resolve(s ? [{ plan_id: s.plan_id, periodo: s.periodo, status: s.status, current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end }] : []);
  }

  return Promise.resolve([]);
}
fakeSql.transaction = (queries) => Promise.all(queries);

require.cache[require.resolve('@neondatabase/serverless')] = {
  id: require.resolve('@neondatabase/serverless'), filename: require.resolve('@neondatabase/serverless'), loaded: true,
  exports: { neon: () => fakeSql },
};
require.cache[require.resolve('@vercel/blob')] = {
  id: require.resolve('@vercel/blob'), filename: require.resolve('@vercel/blob'), loaded: true,
  exports: { put: async () => ({ url: 'https://fake.public.blob.vercel-storage.com/x' }), del: async () => {}, get: async () => null },
};
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'), filename: require.resolve('@anthropic-ai/sdk'), loaded: true,
  exports: class FakeAnthropic { constructor() {} },
};

// Ni Wava ni Resend deberían llamarse nunca en modo dummy — si algo los
// llama, que el test explote en vez de fallar en silencio.
const fetchOriginal = global.fetch;
global.fetch = async (url) => {
  throw new Error('No debería llamarse a fetch() externo en modo dummy: ' + url);
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  if (resp.status !== 200) throw new Error(`login falló: ${resp.status} ${resp.body}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

(async () => {
  const server = app.listen(0);
  try {
    const cookieA = await login(server, 'usuarioa');
    const cookieB = await login(server, 'usuariob');

    // --- Checkout normal, en modo dummy ---
    const checkout = await request(server, { path: '/api/billing/checkout', method: 'POST', body: { planId: 'legado_personal', periodo: 'annual' } }, cookieA);
    check('checkout en modo dummy -> 200 (no 501)', checkout.status === 200);
    const checkoutData = JSON.parse(checkout.body);
    check('la respuesta marca dummy:true', checkoutData.dummy === true);
    check('el link apunta a la propia app, no a Wava', checkoutData.link.includes('/app.html?pago=ok'));
    check('el plan queda ACTIVO de una, sin webhook', subscriptions[1] && subscriptions[1].status === 'active');
    check('current_period_end quedó seteado', !!subscriptions[1].current_period_end);
    check('se guardó la orden como paid', billingOrders.some((o) => o.user_id === 1 && o.status === 'paid'));

    // --- Regalo, en modo dummy: sin fecha programada -> el correo se marca mandado ya mismo ---
    const gift = await request(server, { path: '/api/billing/gift-checkout', method: 'POST' }, cookieA);
    check('gift-checkout en modo dummy -> 200 (no 501)', gift.status === 200);
    const giftData = JSON.parse(gift.body);
    check('la respuesta trae el código directo (sin depender del correo)', typeof giftData.code === 'string' && giftData.code.length === 8);
    check('la orden de regalo quedó paid, sin subscription_id', billingOrders.some((o) => o.plan_id === 'regalo' && o.status === 'paid' && o.subscription_id === null));
    check('sin fecha programada, se marca el correo como mandado ya mismo', !!giftRedemptions[giftData.code].email_sent_at);

    // --- Regalo con fecha de envío futura + mensaje: el código sale igual, pero el correo NO se manda todavía ---
    const manana = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const giftProgramado = await request(server, { path: '/api/billing/gift-checkout', method: 'POST', body: { sendOn: manana, message: 'Para que sigas contando tus historias, papá' } }, cookieA);
    check('gift-checkout programado -> 200', giftProgramado.status === 200);
    const giftProgramadoData = JSON.parse(giftProgramado.body);
    check('con fecha futura, el correo NO se manda de una', !giftRedemptions[giftProgramadoData.code].email_sent_at);
    check('se guardó el mensaje personalizado', giftRedemptions[giftProgramadoData.code].gift_message === 'Para que sigas contando tus historias, papá');

    // --- El cron de facturación todavía no lo manda: falta para la fecha ---
    const cronAntes = await request(server, { path: '/api/cron/billing', method: 'GET', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check('cron corre -> 200', cronAntes.status === 200);
    check('el cron no manda nada antes de que llegue la fecha', !giftRedemptions[giftProgramadoData.code].email_sent_at);

    // --- Llegó el día (simulado moviendo la fecha al pasado): el cron sí lo manda ---
    giftRedemptions[giftProgramadoData.code].send_on = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const cronDespues = await request(server, { path: '/api/cron/billing', method: 'GET', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const cronDespuesData = JSON.parse(cronDespues.body);
    check('el cron mandó el regalo pendiente cuando llegó la fecha', cronDespuesData.regalosMandados === 1);
    check('email_sent_at quedó marcado después del cron', !!giftRedemptions[giftProgramadoData.code].email_sent_at);

    // --- El cron es idempotente: correrlo de nuevo no lo manda otra vez ---
    const cronOtraVez = await request(server, { path: '/api/cron/billing', method: 'GET', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const cronOtraVezData = JSON.parse(cronOtraVez.body);
    check('correr el cron de nuevo no lo manda dos veces', cronOtraVezData.regalosMandados === 0);

    // --- Fecha inválida (en el pasado) se ignora silenciosamente: manda igual, sin fecha programada ---
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const giftFechaInvalida = await request(server, { path: '/api/billing/gift-checkout', method: 'POST', body: { sendOn: ayer } }, cookieA);
    const giftFechaInvalidaData = JSON.parse(giftFechaInvalida.body);
    check('fecha en el pasado se ignora (no queda programada) y el correo se manda de una', !!giftRedemptions[giftFechaInvalidaData.code].email_sent_at);

    // --- El código dummy se puede canjear como cualquier otro ---
    const redeem = await request(server, { path: '/api/billing/redeem-gift', method: 'POST', body: { code: giftData.code } }, cookieB);
    check('el código generado en modo dummy se canjea normal -> 200', redeem.status === 200);
    check('la cuenta de B queda con el regalo activo', subscriptions[2] && subscriptions[2].status === 'active' && subscriptions[2].cancel_at_period_end === true);
  } finally {
    server.close();
    global.fetch = fetchOriginal;
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();

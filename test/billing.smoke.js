// Smoke test para la infraestructura de pagos (Wava) y activación
// recurrente (recordatorios por correo): checkout, verificación de firma
// del webhook, idempotencia, extensión del período según mensual/anual,
// el freno read_only sobre /api/next, login mágico, y que los cron
// quedan protegidos con CRON_SECRET.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ci-smoke-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://fake:fake@localhost/fake';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'fake';
process.env.WAVA_MERCHANT_KEY = 'test-merchant-key';
process.env.WAVA_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.RESEND_API_KEY = 'test-resend-key';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const PASSWORD_HASH = bcrypt.hashSync('miclave123', 4);

const users = {
  1: { id: 1, username: 'usuarioa', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Usuaria A', email: 'a@example.com' },
  // B es quien RECIBE el regalo — nunca inicia sesión como A, ni A como B:
  // prueba de verdad que comprador y narrador son cuentas distintas (P0.5).
  2: { id: 2, username: 'usuariob', password_hash: PASSWORD_HASH, token_version: 0, owner_user_id: null, name: 'Usuario B', email: null },
};

let subscriptions = {}; // user_id -> { id, plan_id, periodo, status, current_period_end, grace_until, cancel_at_period_end }
let nextSubId = 1;
let billingOrders = {}; // order_key -> { id, subscription_id, user_id, status, monto_cop, ... }
let nextOrderId = 1;
let giftRedemptions = {}; // code -> { code, billing_order_id, bought_by_user_id, plan_id, meses, redeemed_by_user_id, redeemed_at }
const correosEnviados = [];

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
  if (text.includes('SELECT username, token_version FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ username: u.username, token_version: u.token_version }] : []);
  }

  // --- billing/checkout ---
  if (text.includes('SELECT id FROM subscriptions WHERE user_id')) {
    const s = subscriptions[values[0]];
    return Promise.resolve(s ? [{ id: s.id }] : []);
  }
  if (text.includes('UPDATE subscriptions SET plan_id') && text.includes("cancel_at_period_end = true")) {
    // Canje de regalo sobre una suscripción YA existente -> 2 values: [planId, subId].
    const [planId, subId] = values;
    const s = Object.values(subscriptions).find((x) => x.id === subId);
    if (s) {
      s.plan_id = planId; s.status = 'active'; s.cancel_at_period_end = true; s.grace_until = null;
      const d = new Date(); d.setMonth(d.getMonth() + 12); s.current_period_end = d.toISOString();
    }
    return Promise.resolve([]);
  }
  if (text.includes('UPDATE subscriptions SET plan_id')) {
    const [planId, periodo, subId] = values;
    const s = Object.values(subscriptions).find((x) => x.id === subId);
    if (s) { s.plan_id = planId; s.periodo = periodo; }
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO subscriptions (user_id, plan_id, periodo, status, current_period_end, cancel_at_period_end)')) {
    // Canje de regalo SIN suscripción previa -> 2 values: [userId, planId] ('annual','active',INTERVAL,true son literales).
    const [userId, planId] = values;
    const id = nextSubId++;
    const d = new Date(); d.setMonth(d.getMonth() + 12);
    subscriptions[userId] = { id, user_id: userId, plan_id: planId, periodo: 'annual', status: 'active', current_period_end: d.toISOString(), grace_until: null, cancel_at_period_end: true };
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO subscriptions (user_id, plan_id, periodo, status)')) {
    // 'trialing' va como literal en el SQL, no como parámetro — solo 3 values.
    const [userId, planId, periodo] = values;
    const id = nextSubId++;
    subscriptions[userId] = { id, user_id: userId, plan_id: planId, periodo, status: 'trialing', current_period_end: null, grace_until: null, cancel_at_period_end: false };
    return Promise.resolve([{ id }]);
  }
  if (text.includes('INSERT INTO billing_orders') && text.includes('VALUES (NULL,')) {
    // Regalo: subscription_id, status y plan_id van todos como literales -> 6 values.
    const [userId, orderKey, wavaHash, wavaLink, concepto, montoCop] = values;
    const id = nextOrderId++;
    billingOrders[orderKey] = { id, subscription_id: null, user_id: userId, order_key: orderKey, wava_hash: wavaHash, wava_link: wavaLink, concepto, monto_cop: montoCop, status: 'pending', plan_id: 'regalo', paid_at: null };
    return Promise.resolve([]);
  }
  if (text.includes('INSERT INTO billing_orders')) {
    // 'pending' va como literal en el SQL, no como parámetro — 8 values (incluye plan_id).
    const [subscriptionId, userId, orderKey, wavaHash, wavaLink, concepto, montoCop, planId] = values;
    const id = nextOrderId++;
    billingOrders[orderKey] = { id, subscription_id: subscriptionId, user_id: userId, order_key: orderKey, wava_hash: wavaHash, wava_link: wavaLink, concepto, monto_cop: montoCop, status: 'pending', plan_id: planId, paid_at: null };
    return Promise.resolve([]);
  }
  if (text.includes('SELECT id, subscription_id, status, plan_id, user_id FROM billing_orders WHERE order_key')) {
    const o = billingOrders[values[0]];
    return Promise.resolve(o ? [{ id: o.id, subscription_id: o.subscription_id, status: o.status, plan_id: o.plan_id, user_id: o.user_id }] : []);
  }
  // --- Regalo: comprador y narrador distintos (P0.5) ---
  if (text.includes('SELECT 1 FROM gift_redemptions WHERE code')) {
    return Promise.resolve(giftRedemptions[values[0]] ? [{ '?column?': 1 }] : []);
  }
  if (text.includes('INSERT INTO gift_redemptions (code, billing_order_id, bought_by_user_id, plan_id, meses)')) {
    // plan_id ('regalo') y meses (12) van como literales -> 3 values: code, billing_order_id, bought_by_user_id.
    const [code, billingOrderId, boughtByUserId] = values;
    giftRedemptions[code] = { code, billing_order_id: billingOrderId, bought_by_user_id: boughtByUserId, plan_id: 'regalo', meses: 12, redeemed_by_user_id: null, redeemed_at: null };
    return Promise.resolve([]);
  }
  // El claim atómico (arregla la carrera de dos canjes simultáneos con el
  // mismo código, P1 de seguridad 2026-09-05): un solo UPDATE con el
  // filtro "redeemed_by_user_id IS NULL" adentro del WHERE, en vez del
  // viejo SELECT-para-chequear + UPDATE-para-marcar por separado.
  if (text.includes('UPDATE gift_redemptions') && text.includes('redeemed_by_user_id = ') && text.includes('IS NULL')) {
    const [userId, code] = values;
    const g = giftRedemptions[code];
    if (!g || g.redeemed_by_user_id) return Promise.resolve([]);
    g.redeemed_by_user_id = userId;
    g.redeemed_at = new Date().toISOString();
    return Promise.resolve([{ id: g.code, plan_id: g.plan_id }]);
  }
  // Solo se usa para armar el mensaje de error cuando el claim de arriba
  // no encontró fila (código inexistente vs. ya usado).
  if (text.includes('SELECT redeemed_by_user_id FROM gift_redemptions WHERE code')) {
    const g = giftRedemptions[values[0]];
    return Promise.resolve(g ? [{ redeemed_by_user_id: g.redeemed_by_user_id }] : []);
  }
  if (text.includes('SELECT email, name, username FROM users WHERE id')) {
    const u = users[values[0]];
    return Promise.resolve(u ? [{ email: u.email, name: u.name, username: u.username }] : []);
  }
  if (text.includes("UPDATE billing_orders SET status = 'paid'")) {
    // 'paid' y now() van como literales acá — solo 2 values: [raw_webhook, id].
    const [rawWebhook, id] = values;
    const orden = Object.values(billingOrders).find((o) => o.id === id);
    if (orden) { orden.status = 'paid'; orden.raw_webhook = rawWebhook; orden.paid_at = new Date().toISOString(); }
    return Promise.resolve([]);
  }
  if (text.includes('UPDATE billing_orders SET status = ') && text.includes('raw_webhook')) {
    // Caso "no confirmado": [estadoWava, raw_webhook, id].
    const [estado, rawWebhook, id] = values;
    const orden = Object.values(billingOrders).find((o) => o.id === id);
    if (orden) { orden.status = estado; orden.raw_webhook = rawWebhook; }
    return Promise.resolve([]);
  }
  if (text.includes('SELECT periodo FROM subscriptions WHERE id')) {
    const s = Object.values(subscriptions).find((x) => x.id === values[0]);
    return Promise.resolve(s ? [{ periodo: s.periodo }] : []);
  }
  if (text.includes("UPDATE subscriptions SET status = 'active'")) {
    const [intervalo, subId] = values;
    const s = Object.values(subscriptions).find((x) => x.id === subId);
    if (s) {
      s.status = 'active';
      const meses = intervalo === '1 month' ? 1 : 12;
      const d = new Date();
      d.setMonth(d.getMonth() + meses);
      s.current_period_end = d.toISOString();
      s.grace_until = null;
    }
    return Promise.resolve([]);
  }

  // --- billing/status y bloquearSiReadOnly ---
  if (text.includes('SELECT plan_id, periodo, status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id')) {
    const s = subscriptions[values[0]];
    return Promise.resolve(s ? [{ plan_id: s.plan_id, periodo: s.periodo, status: s.status, current_period_end: s.current_period_end, cancel_at_period_end: s.cancel_at_period_end }] : []);
  }
  if (text.includes('SELECT status FROM subscriptions WHERE user_id')) {
    const s = subscriptions[values[0]];
    return Promise.resolve(s ? [{ status: s.status }] : []);
  }

  // --- notification_preferences ---
  if (text.includes('SELECT recordatorios_activos, frecuencia_dias FROM notification_preferences')) {
    return Promise.resolve([]); // sin fila -> el default en el handler
  }
  if (text.includes('INSERT INTO notification_preferences')) {
    return Promise.resolve([]);
  }

  // --- crons: listas vacías alcanzan para probar la autenticación ---
  if (text.includes('FROM users u') || text.includes('FROM subscriptions s JOIN users u')) return Promise.resolve([]);

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

// fetch de Wava (crear link) y de Resend (mandar correo) — ambos van por
// fetch() directo, sin SDK, así que se mockea acá.
const fetchOriginal = global.fetch;
let wavaLinkCounter = 0;
global.fetch = async (url, opts) => {
  const urlStr = String(url);
  if (urlStr.includes('api.wava.co') && urlStr.endsWith('/links')) {
    wavaLinkCounter++;
    return {
      ok: true,
      json: async () => ({ result: { link: `https://checkout.wava.co/fake${wavaLinkCounter}`, hash: `fake${wavaLinkCounter}` } }),
      text: async () => '',
    };
  }
  if (urlStr.includes('api.resend.com')) {
    correosEnviados.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ id: 'fake-email-id' }) };
  }
  return fetchOriginal ? fetchOriginal(url, opts) : { ok: false };
};

const app = require(serverPath);

function request(server, opts, cookie) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(opts.body);
    const data = isBuffer ? opts.body : (opts.body ? JSON.stringify(opts.body) : null);
    const headers = Object.assign({}, opts.headers || {});
    // express.raw({type:'*/*'}) solo parsea el body si HAY algún
    // Content-Type (type-is no matchea "*/*" contra ausencia de header) —
    // sin esto, req.body le llega vacío al webhook y la firma nunca cierra.
    if (data && !headers['Content-Type']) headers['Content-Type'] = isBuffer ? 'application/octet-stream' : 'application/json';
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (cookie) headers['Cookie'] = cookie;
    const host = `127.0.0.1:${server.address().port}`;
    if (!headers['Origin']) headers['Origin'] = `http://${host}`;
    const r = http.request({ hostname: '127.0.0.1', port: server.address().port, path: opts.path, method: opts.method || 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bodyBuffer: Buffer.concat(chunks), body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(server, username) {
  const resp = await request(server, { path: '/api/login', method: 'POST', body: { username, password: 'miclave123' } });
  if (resp.status !== 200) throw new Error(`login falló para ${username}: ${resp.status} ${resp.body}`);
  return resp.headers['set-cookie'][0].split(';')[0];
}

let pasaron = 0;
let fallaron = 0;
function check(nombre, cond) {
  if (cond) { pasaron++; console.log('OK  -', nombre); }
  else { fallaron++; console.log('FAIL -', nombre); }
}

function firmarWava(bodyBuffer) {
  return crypto.createHmac('sha256', process.env.WAVA_WEBHOOK_SECRET).update(bodyBuffer).digest('hex');
}

(async () => {
  const server = app.listen(0);
  try {
    const cookieA = await login(server, 'usuarioa');

    // --- Planes públicos ---
    const planes = await request(server, { path: '/api/billing/plans' });
    check('billing/plans -> 200 sin sesión', planes.status === 200);
    check('billing/plans incluye legado_personal', JSON.parse(planes.body).planes.legado_personal.precioAnual === 399000);

    // --- Checkout ---
    const checkoutMal = await request(server, { path: '/api/billing/checkout', method: 'POST', body: { planId: 'no_existe' } }, cookieA);
    check('checkout con plan inválido -> 400', checkoutMal.status === 400);

    const checkoutOk = await request(server, { path: '/api/billing/checkout', method: 'POST', body: { planId: 'legado_personal', periodo: 'annual' } }, cookieA);
    check('checkout con plan válido -> 200', checkoutOk.status === 200);
    const checkoutData = JSON.parse(checkoutOk.body);
    check('checkout devuelve el link de Wava', checkoutData.link && checkoutData.link.startsWith('https://checkout.wava.co/'));
    check('checkout creó la suscripción en trialing', subscriptions[1] && subscriptions[1].status === 'trialing');
    const orderKey = Object.keys(billingOrders)[0];
    check('checkout guardó la orden como pending', billingOrders[orderKey].status === 'pending');

    // --- Webhook: firma inválida ---
    const bodyEvento = Buffer.from(JSON.stringify({ event: 'link_paid', id_external: orderKey, status: 'paid' }));
    const webhookFirmaMala = await request(server, { path: '/api/webhooks/wava', method: 'POST', body: bodyEvento, headers: { 'x-wava-signature': 'a'.repeat(64) } });
    check('webhook con firma inválida -> 401', webhookFirmaMala.status === 401);
    check('con firma inválida, la orden NO se marca paid', billingOrders[orderKey].status === 'pending');

    // --- Webhook: firma válida, pago confirmado ---
    const firmaBuena = firmarWava(bodyEvento);
    const webhookOk = await request(server, { path: '/api/webhooks/wava', method: 'POST', body: bodyEvento, headers: { 'x-wava-signature': firmaBuena } });
    check('webhook con firma válida -> 200', webhookOk.status === 200);
    check('la orden queda paid', billingOrders[orderKey].status === 'paid');
    check('la suscripción pasa a active', subscriptions[1].status === 'active');
    check('current_period_end quedó seteado (~1 año, no ~1 mes)', (() => {
      const dias = (new Date(subscriptions[1].current_period_end) - new Date()) / 86400000;
      return dias > 300; // anual: bastante más que un mes
    })());

    // --- Webhook: mismo evento de nuevo (idempotencia) ---
    const webhookRepetido = await request(server, { path: '/api/webhooks/wava', method: 'POST', body: bodyEvento, headers: { 'x-wava-signature': firmaBuena } });
    check('webhook repetido (ya paid) -> 200, no rompe nada', webhookRepetido.status === 200);

    // --- billing/status refleja la suscripción activa ---
    const status = await request(server, { path: '/api/billing/status' }, cookieA);
    const statusData = JSON.parse(status.body);
    check('billing/status -> active', statusData.status === 'active');

    // --- bloquearSiReadOnly: mientras está active, /api/next no se bloquea por esto ---
    subscriptions[1].status = 'active';
    // (no probamos /api/next completo acá — ya lo cubre next.smoke.js; alcanza con confirmar que el middleware no tira 402 por sí solo)

    // --- read_only bloquea agregar charlas nuevas ---
    subscriptions[1].status = 'read_only';
    const nextBloqueado = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieA);
    check('con la suscripción en read_only, /api/next -> 402', nextBloqueado.status === 402);
    subscriptions[1].status = 'active'; // se restaura para no afectar otros checks

    // --- Sin ninguna fila de suscripción, /api/next NO se bloquea por esto (cuentas viejas, nunca pagaron) ---
    delete subscriptions[1];
    const nextSinSuscripcion = await request(server, { path: '/api/next', method: 'POST', body: { history: [], mode: 'historia' } }, cookieA);
    check('sin fila de suscripción, el freno de pagos no bloquea (falla el resto por el mock de Anthropic, no por 402)', nextSinSuscripcion.status !== 402);

    // --- Preferencias de notificación ---
    const prefsGet = await request(server, { path: '/api/notification-preferences' }, cookieA);
    check('notification-preferences GET -> 200 con default', prefsGet.status === 200 && JSON.parse(prefsGet.body).frecuencia_dias === 14);
    const prefsSet = await request(server, { path: '/api/notification-preferences', method: 'POST', body: { recordatorios_activos: false, frecuencia_dias: 30 } }, cookieA);
    check('notification-preferences POST -> 200', prefsSet.status === 200);

    // --- Login mágico ---
    const linkInvalido = await request(server, { path: '/api/magic-login?token=basura' });
    check('magic-login con token basura -> redirige (no explota)', linkInvalido.status === 302);
    check('magic-login con token basura redirige con "vencido" o "invalido"', /magic=(vencido|invalido)/.test(linkInvalido.headers.location || ''));

    // --- Crons: protegidos con CRON_SECRET ---
    const cronSinAuth = await request(server, { path: '/api/cron/reminders' });
    check('cron/reminders sin Authorization -> 401', cronSinAuth.status === 401);
    const cronAuthMala = await request(server, { path: '/api/cron/reminders', headers: { Authorization: 'Bearer lo-que-sea' } });
    check('cron/reminders con secreto incorrecto -> 401', cronAuthMala.status === 401);
    const cronOk = await request(server, { path: '/api/cron/reminders', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check('cron/reminders con el secreto correcto -> 200', cronOk.status === 200);

    const cronBillingSinAuth = await request(server, { path: '/api/cron/billing' });
    check('cron/billing sin Authorization -> 401', cronBillingSinAuth.status === 401);
    const cronBillingOk = await request(server, { path: '/api/cron/billing', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check('cron/billing con el secreto correcto -> 200', cronBillingOk.status === 200);

    // --- Regalo: comprador (A) y narrador (B) son cuentas distintas (P0.5) ---
    const cookieB = await login(server, 'usuariob');
    delete subscriptions[1]; // no debería importarle nada de la suscripción de A esto

    const giftCheckout = await request(server, { path: '/api/billing/gift-checkout', method: 'POST' }, cookieA);
    check('gift-checkout -> 200', giftCheckout.status === 200);
    const giftLink = JSON.parse(giftCheckout.body).link;
    check('gift-checkout devuelve un link de Wava', typeof giftLink === 'string' && giftLink.startsWith('https://checkout.wava.co/'));
    const giftOrderKey = Object.keys(billingOrders).find((k) => billingOrders[k].plan_id === 'regalo');
    check('la orden de regalo se guardó SIN subscription_id', billingOrders[giftOrderKey].subscription_id === null);

    const giftEvento = Buffer.from(JSON.stringify({ event: 'link_paid', id_external: giftOrderKey, status: 'paid' }));
    const giftFirma = firmarWava(giftEvento);
    const correosAntes = correosEnviados.length;
    const giftWebhook = await request(server, { path: '/api/webhooks/wava', method: 'POST', body: giftEvento, headers: { 'x-wava-signature': giftFirma } });
    check('webhook del regalo -> 200', giftWebhook.status === 200);
    check('el webhook del regalo NO tocó ninguna suscripción (A sigue sin una)', !subscriptions[1]);
    check('se generó un código de canje', Object.keys(giftRedemptions).length === 1);
    const codigoRegalo = Object.keys(giftRedemptions)[0];
    check('el código de canje quedó atado a QUIEN COMPRÓ (A), no a nadie más', giftRedemptions[codigoRegalo].bought_by_user_id === 1);
    check('se mandó un correo con el código', correosEnviados.length === correosAntes + 1 && correosEnviados[correosEnviados.length - 1].html.includes(codigoRegalo));
    check('el correo del regalo fue AL COMPRADOR (a@example.com), no al narrador', correosEnviados[correosEnviados.length - 1].to[0] === 'a@example.com');

    // B (que nunca pagó nada) lo canjea en SU propia cuenta.
    const redeemMalo = await request(server, { path: '/api/billing/redeem-gift', method: 'POST', body: { code: 'NOEXISTE1' } }, cookieB);
    check('redeem-gift con código inexistente -> 404', redeemMalo.status === 404);

    const redeemOk = await request(server, { path: '/api/billing/redeem-gift', method: 'POST', body: { code: codigoRegalo } }, cookieB);
    check('redeem-gift con el código real -> 200', redeemOk.status === 200);
    check('la cuenta de B (narradora) queda con el plan activo', subscriptions[2] && subscriptions[2].status === 'active' && subscriptions[2].plan_id === 'regalo');
    check('el regalo NO se renueva solo (cancel_at_period_end)', subscriptions[2].cancel_at_period_end === true);
    check('la cuenta de A (compradora) sigue SIN suscripción propia', !subscriptions[1]);

    const redeemRepetido = await request(server, { path: '/api/billing/redeem-gift', method: 'POST', body: { code: codigoRegalo } }, cookieB);
    check('el mismo código no se puede canjear dos veces -> 400', redeemRepetido.status === 400);
  } finally {
    server.close();
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
})();

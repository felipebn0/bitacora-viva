// Verifica el enganche de Sentry en server.js: apagado por completo si no
// hay SENTRY_DSN (no debe ni intentar cargar el paquete), y si lo hay,
// que un console.error(err) — que es como ya reportan sus errores
// prácticamente todas las rutas de server.js — termine llamando a
// Sentry.captureException, sin haber tocado ninguna ruta para lograrlo.
//
// Corre en procesos hijos (como test/shutdown.smoke.js) porque necesita
// controlar el require.cache de @sentry/node ANTES de que server.js lo
// cargue, con una variable de entorno distinta en cada caso.
//
//   node test/sentry.smoke.js

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.resolve(__dirname, '..', 'server.js');
const BASE_ENV = {
  ...process.env,
  SESSION_SECRET: 'test-sentry-secret',
  DATABASE_URL: 'postgres://fake:fake@localhost/fake',
  ANTHROPIC_API_KEY: 'fake',
};

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

function runChildEval(script, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ timedOut: true, stdout, stderr, code: null }); }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => { clearTimeout(timer); resolve({ timedOut: false, stdout, stderr, code }); });
  });
}

async function main() {
  // --- 1) Sin SENTRY_DSN: server.js no debe intentar ni requerir @sentry/node ---
  const scriptSinDsn = `
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    let intentoRequerirSentry = false;
    Module.prototype.require = function (id) {
      if (id === '@sentry/node') intentoRequerirSentry = true;
      return originalRequire.apply(this, arguments);
    };
    require(${JSON.stringify(serverPath)});
    console.log('INTENTO_REQUERIR_SENTRY=' + intentoRequerirSentry);
  `;
  const r1 = await runChildEval(scriptSinDsn, { ...BASE_ENV }, 5000);
  check('sin SENTRY_DSN: no se llegó a requerir @sentry/node (queda apagado del todo)', /INTENTO_REQUERIR_SENTRY=false/.test(r1.stdout));

  // --- 2) Con SENTRY_DSN (fake, apuntando a nada): console.error(err) reenvía a Sentry.captureException ---
  const scriptConDsn = `
    const path = require('path');
    let capturedExceptions = 0;
    let capturedMessages = 0;
    let initCalledWithDsn = null;
    require.cache[require.resolve('@sentry/node')] = {
      id: require.resolve('@sentry/node'), filename: require.resolve('@sentry/node'), loaded: true,
      exports: {
        init: (opts) => { initCalledWithDsn = opts.dsn; },
        captureException: () => { capturedExceptions++; },
        captureMessage: () => { capturedMessages++; },
        flush: () => Promise.resolve(true),
      },
    };
    require(${JSON.stringify(serverPath)});
    console.error(new Error('error de prueba (no es un error real)'));
    console.error('un mensaje de error en texto, sin objeto Error');
    console.log('INIT_DSN=' + initCalledWithDsn);
    console.log('CAPTURED_EXCEPTIONS=' + capturedExceptions);
    console.log('CAPTURED_MESSAGES=' + capturedMessages);
  `;
  const r2 = await runChildEval(scriptConDsn, { ...BASE_ENV, SENTRY_DSN: 'https://fake@fake.ingest.sentry.io/123' }, 5000);
  check('con SENTRY_DSN: Sentry.init se llamó con ese mismo DSN', r2.stdout.includes('INIT_DSN=https://fake@fake.ingest.sentry.io/123'));
  check('con SENTRY_DSN: console.error(unError) llamó a Sentry.captureException (sin tocar ninguna ruta)', r2.stdout.includes('CAPTURED_EXCEPTIONS=1'));
  check('con SENTRY_DSN: console.error(texto sin Error) cae a Sentry.captureMessage', r2.stdout.includes('CAPTURED_MESSAGES=1'));

  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

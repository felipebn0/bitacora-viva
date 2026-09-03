// Prueba el mecanismo de apagarPorErrorFatal() en server.js: después de un
// error no capturado, el proceso tiene que loguearlo, dejar de aceptar
// tráfico y SALIR con código distinto de cero (para que systemd/pm2/lo que
// sea reinicie desde cero) — antes de este cambio el proceso quedaba
// colgado corriendo para siempre, y esto es justo lo que hay que probar en
// un proceso hijo real: no se puede tirar una excepción no capturada de
// verdad dentro del propio proceso de test sin matarlo a él también.
//
// Cubre las dos ramas del mecanismo:
//   1) Standalone (como corre en la Raspberry Pi/local, con `server` real
//      asignado por app.listen): tiene que cerrar el server y salir.
//   2) "Serverless" (como se requiere server.js desde Vercel o desde los
//      otros archivos de test, sin pasar por app.listen — `server` queda
//      null): tiene que salir directo, sin intentar cerrar nada que no
//      existe.
//
// El gancho TEST_FORZAR_ERROR_NO_CAPTURADO=1 (ver server.js) es lo que
// dispara el error a los 50ms; nunca se activa solo con requerir el módulo.
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const serverPath = path.resolve(__dirname, '..', 'server.js');

const BASE_ENV = {
  ...process.env,
  SESSION_SECRET: 'test-shutdown-secret',
  DATABASE_URL: 'postgres://fake:fake@localhost/fake',
  ANTHROPIC_API_KEY: 'fake',
  TEST_FORZAR_ERROR_NO_CAPTURADO: '1',
};

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`OK  - ${name}`); }
  else { failed++; console.log(`FAIL - ${name}`); }
}

// Corre un script en un proceso hijo y espera a que termine solo, con un
// límite de tiempo — si el mecanismo estuviera roto (proceso colgado para
// siempre, como antes de este cambio) esto lo detecta en vez de colgarse
// también el test.
function runChild(args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout, stderr });
    });
  });
}
function runChildEval(script, env, timeoutMs) {
  return runChild(['-e', script], env, timeoutMs);
}
function runChildFile(filePath, env, timeoutMs) {
  return runChild([filePath], env, timeoutMs);
}

async function main() {
  // --- 1) Rama "serverless": requerir el módulo sin pasar por app.listen ---
  // (require.main !== module, igual que hacen los otros archivos de test y
  // que hace Vercel al importar server.js desde api/index.js)
  const scriptServerless = `require(${JSON.stringify(serverPath)});`;
  const resultServerless = await runChildEval(scriptServerless, BASE_ENV, 5000);
  check('rama serverless: el proceso termina solo (no quedó colgado)', !resultServerless.timedOut);
  check('rama serverless: sale con código distinto de cero', resultServerless.code !== 0 && resultServerless.code !== null);
  check('rama serverless: logueó el error antes de salir', resultServerless.stderr.includes('Error no capturado') && resultServerless.stderr.includes('cerrando el proceso'));

  // --- 2) Rama standalone: correr server.js como si fuera `node server.js` ---
  // (require.main === module ahí adentro -> agarra un puerto real con
  // app.listen y asigna `server`)
  const portProbe = await new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const resultStandalone = await runChildFile(serverPath, { ...BASE_ENV, PORT: String(portProbe) }, 5000);
  check('rama standalone: el proceso termina solo (no quedó colgado)', !resultStandalone.timedOut);
  check('rama standalone: sale con código distinto de cero', resultStandalone.code !== 0 && resultStandalone.code !== null);
  check('rama standalone: logueó el error antes de salir', resultStandalone.stderr.includes('Error no capturado') && resultStandalone.stderr.includes('cerrando el proceso'));
  check('rama standalone: alcanzó a levantar el server antes de caerse (log de arranque)', resultStandalone.stdout.includes('corriendo en http://localhost'));

  console.log(`\n${passed} pasaron, ${failed} fallaron`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR EN EL SMOKE TEST DE APAGADO:', e);
  process.exit(1);
});

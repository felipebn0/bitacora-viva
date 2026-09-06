'use strict';
// Ayuda compartida por las suites de Playwright que levantan el server.js
// real (y por lo tanto reciben la política CSP de verdad, hoy en modo
// Content-Security-Policy-Report-Only — ver CSP_MODE_ENFORCE en
// server.js): detecta violaciones de CSP durante toda la navegación.
//
// El evento DOM 'securitypolicyviolation' se dispara igual en modo
// report-only que en modo enforce -- la única diferencia entre los dos
// modos es si el navegador además bloquea el recurso, no si avisa de la
// violación (ver la especificación de CSP3). Eso permite validar HOY,
// sin tocar CSP_MODE_ENFORCE, exactamente lo que se rompería el día que
// pase a true -- reusando el recorrido que cada suite YA hace (login,
// charla, árbol, colaborar, accesibilidad, landscape) en vez de escribir
// una suite nueva aparte.
//
// Nace de un reporte (2026-09-06) que señaló, antes de activar enforce,
// la falta de: (1) un recorrido autenticado completo con la política
// forzada, y (2) una prueba de CI que falle ante violaciones. Engancharse
// a las suites existentes cubre ambos pedidos con el recorrido que ya
// existe, sin duplicar navegación.
//
// Cobertura real: solo las suites que levantan server.js de verdad
// (accesibilidad, colaborar-sticky, landscape-safearea, responsive) usan
// esto -- las que sirven public/ con un express.static liso (arbol-
// conexiones, login-vacio, mic-denegado, pause-resume) no reciben ningún
// header de CSP para empezar, así que no hay nada real que detectar ahí
// sin además rehacer su arquitectura de servidor, que fue una decisión a
// propósito de esas suites (más rápidas, sin depender del backend).

function attachCspViolationCollector(context) {
  return context.addInitScript(() => {
    window.__cspViolations = window.__cspViolations || [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        directiva: e.violatedDirective,
        bloqueado: e.blockedURI,
        pagina: location.href,
      });
    });
  });
}

async function leerViolacionesCsp(page) {
  try {
    return await page.evaluate(() => window.__cspViolations || []);
  } catch (e) {
    // La página puede haber navegado o cerrado justo en este momento --
    // no es una violación real, así que no cuenta como fallo de la suite.
    return [];
  }
}

// Azúcar para el patrón repetido: leer + reportar con el check() propio de
// cada suite, describiendo cada violación si las hay (en vez de un booleano
// mudo que obliga a ir a buscar el detalle a mano).
async function checkSinViolacionesCsp(page, etiqueta, check) {
  const violaciones = await leerViolacionesCsp(page);
  check(violaciones.length === 0, `${etiqueta}: sin violaciones de CSP durante la navegación`);
  for (const v of violaciones) {
    console.log(`      - CSP violada: ${v.directiva} bloqueó ${v.bloqueado} en ${v.pagina}`);
  }
  return violaciones;
}

module.exports = { attachCspViolationCollector, leerViolacionesCsp, checkSinViolacionesCsp };

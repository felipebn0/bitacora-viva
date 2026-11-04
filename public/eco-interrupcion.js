/* Decide si lo que oye el micrófono mientras Eco piensa o habla es la persona queriendo seguir (y entonces Eco se calla)
 * o solo ruido: un ventilador, un golpe, una tos, el eco de la propia voz de Eco por el altavoz.
 * Una voz cuenta cuando suena más fuerte que el ruido de fondo (y que la fuga de Eco), tiene su energía en el rango de la voz
 * humana y se sostiene unos 0,3 segundos. No distingue una voz de otra: una televisión con gente hablando sí cuenta.
 */
(function (raiz) {
  'use strict';

  const UMBRAL_MIN = 0.03;
  const RATIO_VOZ_MIN = 0.5;
  const MS_VOZ_PENSANDO = 250;
  const MS_VOZ_HABLANDO = 300;
  const MS_CALIBRACION_ECO = 600;
  // La fuga de Eco por el altavoz nunca se da por más de esto: si la persona ya estaba hablando cuando Eco empezó, su voz
  // no puede subir el umbral hasta dejarla sin poder interrumpir.
  const FUGA_MAX = 0.06;
  const BANDA_VOZ = [250, 3400];
  const BANDA_TOTAL = [50, 8000];

  // Qué parte de la energía del sonido está en el rango de la voz (0 a 1). Recibe el espectro en dB, como lo da
  // AnalyserNode.getFloatFrequencyData.
  function razonDeVoz(espectroDb, frecuenciaDeMuestreo, tamanoFft) {
    const ancho = frecuenciaDeMuestreo / tamanoFft;
    let voz = 0;
    let total = 0;
    for (let i = 0; i < espectroDb.length; i++) {
      const f = i * ancho;
      if (f < BANDA_TOTAL[0] || f > BANDA_TOTAL[1]) continue;
      const db = espectroDb[i];
      const potencia = Number.isFinite(db) ? Math.pow(10, db / 10) : 0;
      total += potencia;
      if (f >= BANDA_VOZ[0] && f <= BANDA_VOZ[1]) voz += potencia;
    }
    return total > 0 ? voz / total : 0;
  }

  function crearDetector() {
    let piso = 0.01;
    let fuga = 0;
    let msEco = 0;
    let msVoz = 0;

    // eco: Eco está sonando por el altavoz en este momento.
    function alimentar({ rms, ratioVoz, dt, eco }) {
      const alfa = 1 - Math.exp(-dt / 1500);
      if (eco) {
        msEco += dt;
        if (msEco <= MS_CALIBRACION_ECO) {
          // Primeros instantes de la voz de Eco: todo lo que se oye es su fuga por el altavoz, no la persona.
          fuga = Math.min(FUGA_MAX, fuga + (rms - fuga) * (1 - Math.exp(-dt / 150)));
          return false;
        }
      }
      const umbral = Math.max(UMBRAL_MIN, piso * 2.5, eco ? fuga * 2 : 0);
      const esVoz = rms > umbral && ratioVoz >= RATIO_VOZ_MIN;
      if (esVoz) {
        msVoz += dt;
      } else {
        msVoz = Math.max(0, msVoz - dt * 2);
        piso += (rms - piso) * alfa;
        if (eco) fuga = Math.min(FUGA_MAX, fuga + (rms - fuga) * alfa);
      }
      return msVoz >= (eco ? MS_VOZ_HABLANDO : MS_VOZ_PENSANDO);
    }

    // Para el medidor de depuración de app.html (?debugvoz=1).
    function estado() { return { umbral: Math.max(UMBRAL_MIN, piso * 2.5, fuga * 2), msVoz, piso, fuga }; }

    return { alimentar, estado };
  }

  const api = { crearDetector, razonDeVoz };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.EcoInterrupcion = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Control de tamaño de letra, compartido por todas las páginas.
//
// Casi todo el tamaño de texto de esta app está en "rem" (relativo al
// tamaño de letra del <html>), así que agrandar/achicar ese único valor
// agranda o achica el texto de toda la página de una — sin tener que tocar
// cada regla de CSS una por una. Los tamaños fijos en píxeles (el círculo
// para hablar, los botones redondos del menú, el ancho de las tarjetas)
// no cambian, así que el diseño no se rompe con letra más grande, aunque
// el texto adentro de esos elementos sí crece.
//
// El control para cambiarlo (los botones "A-"/"A+") vive en un solo lugar
// — el menú de Cuenta de app.html — pero la preferencia se guarda acá y
// se aplica en TODAS las páginas, incluida la de login. Este archivo se
// carga en el <head> de cada página, antes de cualquier <style>, para que
// el tamaño correcto se aplique desde el primer instante y no haya un
// salto visible (texto chico que de repente crece) al terminar de cargar.
(function () {
  var KEY = 'bitacora-font-scale';
  var MIN = 100;
  var MAX = 140;
  var STEP = 10;
  var DEFAULT = 100;

  function leerGuardado() {
    try {
      var v = parseInt(localStorage.getItem(KEY), 10);
      if (!v || isNaN(v)) return DEFAULT;
      return Math.min(MAX, Math.max(MIN, v));
    } catch (e) {
      // localStorage puede fallar (navegación privada, storage bloqueado) —
      // en ese caso simplemente no se recuerda la preferencia entre visitas.
      return DEFAULT;
    }
  }

  function aplicar(v) {
    document.documentElement.style.fontSize = v + '%';
  }

  function guardar(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  // Se aplica ya mismo, apenas se carga este script (que va en el <head>,
  // antes del resto de la página) — así no hay parpadeo.
  var actual = leerGuardado();
  aplicar(actual);

  window.bitacoraFontSize = {
    get: function () { return actual; },
    set: function (v) {
      actual = Math.min(MAX, Math.max(MIN, v));
      aplicar(actual);
      guardar(actual);
      return actual;
    },
    increase: function () { return this.set(actual + STEP); },
    decrease: function () { return this.set(actual - STEP); },
    min: MIN,
    max: MAX,
  };
})();

(function () {
  'use strict';
  var libre = !!(document.currentScript && document.currentScript.hasAttribute('data-libre'));
  try {
    var o = window.screen && screen.orientation;
    if (o && libre && o.unlock) o.unlock();
    else if (o && o.lock) { var p = o.lock('portrait'); if (p && p.catch) p.catch(function () {}); }
  } catch (e) {}
  if (libre || !window.matchMedia) return;

  var consulta = window.matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 600px)');
  var aviso = null;
  function actualizar() { if (aviso) aviso.hidden = !consulta.matches; }
  function montar() {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/eco-orientacion.css?v=1';
    document.head.appendChild(css);
    aviso = document.createElement('div');
    aviso.className = 'eco-gira';
    aviso.setAttribute('role', 'alert');
    aviso.innerHTML = '<p class="eco-gira-icono" aria-hidden="true">📱</p><p class="eco-gira-titulo">Gira el celular</p><p class="eco-gira-texto">Eco se usa con el celular derecho, en vertical.</p>';
    document.body.appendChild(aviso);
    actualizar();
  }
  if (consulta.addEventListener) consulta.addEventListener('change', actualizar);
  else if (consulta.addListener) consulta.addListener(actualizar);
  if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
})();

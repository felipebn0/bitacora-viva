/* ECO Colaboraciones: sólo reordena los nodos existentes, sin cambiar IDs ni eventos. */
(() => {
  'use strict';
  function iniciar() {
    const header = document.querySelector('body > header');
    const main = document.querySelector('body > main.wrap');
    if (!header || !main || header.dataset.ecoColabOrdenado === '1') return;
    const volver = header.querySelector('a.volver[href="/app.html"]');
    const heading = header.querySelector('div');
    const cta = main.querySelector('a.aportar-ahora');
    if (!volver || !heading || !cta) return;
    heading.classList.add('eco-colab-heading');
    heading.insertBefore(volver, heading.firstChild);
    const acciones = document.createElement('div');
    acciones.className = 'eco-colab-actions';
    cta.parentNode.insertBefore(acciones, cta);
    acciones.appendChild(cta);
    header.dataset.ecoColabOrdenado = '1';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

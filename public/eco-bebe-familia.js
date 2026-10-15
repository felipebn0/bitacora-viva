/* Diario de un bebé, lado de la familia (colaborar.html): si la persona a quien aportas tiene un diario,
   se muestra un enlace para verlo. Solo se ve, no se edita. */
(() => {
  'use strict';
  const nombre = document.getElementById('ownerName');
  if (!nombre) return;
  const owner = new URLSearchParams(location.search).get('owner');
  const consulta = owner && /^\d+$/.test(owner) ? '?owner=' + owner : '';
  let intentado = false;

  async function buscar() {
    if (intentado || !nombre.textContent.replace(/\s| /g, '')) return;
    intentado = true;
    try {
      const resp = await fetch('/api/bebe' + consulta, { credentials: 'same-origin' });
      if (!resp.ok) return;
      const datos = await resp.json();
      if (!datos.config) return;
      const enlace = document.createElement('a');
      enlace.className = 'eco-bebe-enlace-familia';
      enlace.href = '/diario-bebe.html' + consulta;
      enlace.textContent = 'Ver el diario de ' + datos.config.nombre;
      nombre.insertAdjacentElement('afterend', enlace);
    } catch (e) { /* sin diario: la página sigue igual */ }
  }

  new MutationObserver(buscar).observe(nombre, { childList: true, characterData: true, subtree: true });
  buscar();
})();

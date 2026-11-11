/* Árbol: «Quiénes han colaborado». Cada familiar que aportó historias con su invitación aparece como una tarjeta que
   lleva a sus aportes (colaboraciones.html?colaborador=). Se había perdido al rehacer el árbol (V4).
   Sin colaboradores, o si la cuenta no puede verlos, la sección no aparece. */
(() => {
  'use strict';
  const seccion = document.getElementById('colabSection');
  const grilla = document.getElementById('colabGrid');
  if (!seccion || !grilla) return;
  const iniciales = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  const owner = new URLSearchParams(location.search).get('owner');
  const url = '/api/tree/colaboradores' + (owner ? '?owner=' + encodeURIComponent(owner) : '');
  fetch(url, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((datos) => {
      const lista = (datos && Array.isArray(datos.colaboradores)) ? datos.colaboradores : [];
      if (!lista.length) return;
      grilla.textContent = '';
      for (const c of lista) {
        const tarjeta = document.createElement('a');
        tarjeta.className = 'colab-card';
        tarjeta.href = '/colaboraciones.html?colaborador=' + encodeURIComponent(c.nombre) + (owner ? '&owner=' + encodeURIComponent(owner) : '');
        tarjeta.setAttribute('aria-label', 'Ver los aportes de ' + c.nombre);
        const avatar = document.createElement('span');
        avatar.className = 'colab-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = iniciales(c.nombre);
        const nombre = document.createElement('strong');
        nombre.textContent = c.nombre;
        tarjeta.append(avatar, nombre);
        if (c.parentesco) {
          const parentesco = document.createElement('span');
          parentesco.className = 'colab-parentesco';
          parentesco.textContent = c.parentesco;
          tarjeta.appendChild(parentesco);
        }
        const historias = document.createElement('span');
        historias.className = 'colab-historias';
        historias.textContent = c.historias === 1 ? '1 historia aportada' : c.historias + ' historias aportadas';
        tarjeta.appendChild(historias);
        grilla.appendChild(tarjeta);
      }
      seccion.hidden = false;
    })
    .catch(() => { /* sin red: la sección no aparece */ });
})();

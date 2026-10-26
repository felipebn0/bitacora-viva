/* Pantalla principal: un botón por cada bebé y mascota (no archivados) para entrar a contar su vida. */
(() => {
  'use strict';
  let hecho = false;

  async function arrancar() {
    if (hecho) return;
    hecho = true;
    // Solo en tu propia bitácora: dentro del perfil de otra persona o de una mascota no se muestra.
    if (window.bitacoraActivaId) return;
    try {
      const resp = await fetch('/api/subprofiles', { credentials: 'same-origin' });
      if (!resp.ok) return;
      const mascotas = ((await resp.json()).perfiles || []).filter((p) => p.tipo === 'mascota' || p.tipo === 'bebe');
      if (!mascotas.length) return;
      const C = window.EcoBebeComun;
      const fila = C.filaEspecial();
      if (!fila) return;
      mascotas.forEach((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'eco-bebe-pill ' + (m.tipo === 'bebe' ? 'eco-bebe-pill-bebe' : 'eco-mascota-pill');
        b.textContent = (m.tipo === 'bebe' ? C.emojiBebe(m.tratamiento) : C.emojiMascota(m.especie)) + ' ' + m.nombre;
        b.setAttribute('aria-label', 'Contar la vida de ' + m.nombre);
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const r = await fetch('/api/subprofiles/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) });
            if (r.ok) { location.reload(); return; }
          } catch (e) { /* se reintenta con otro toque */ }
          b.disabled = false;
        });
        fila.appendChild(b);
      });
    } catch (e) { /* sin mascotas: la pantalla sigue igual */ }
  }

  document.addEventListener('eco:app-lista', arrancar);
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') arrancar();
})();

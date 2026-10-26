/* Fila de perfiles arriba de la pantalla principal: la persona (verde), los bebés (rosado) y las mascotas (amarillo),
   uno al lado del otro. Sirve para pasar de un perfil a otro; el del perfil activo va resaltado. En el perfil de un
   bebé o de una mascota la fila trae también el botón para volver a la bitácora de la persona. */
(() => {
  'use strict';
  let hecho = false;

  async function arrancar() {
    if (hecho) return;
    hecho = true;
    const idActivo = window.bitacoraActivaId || null;
    const tipoActivo = window.bitacoraActivaTipo || null;
    // Dentro del perfil de otra persona (un familiar, por ejemplo) no se muestra la fila.
    if (idActivo && tipoActivo !== 'bebe' && tipoActivo !== 'mascota') return;
    try {
      const resp = await fetch('/api/subprofiles', { credentials: 'same-origin' });
      if (!resp.ok) return;
      const datos = await resp.json();
      const perfiles = datos.perfiles || [];
      // Diario de bebé creado dentro de tu propia bitácora (el modo anterior): fuera de ella también sale su botón.
      const diario = idActivo ? datos.diarioBebe : null;
      const especiales = perfiles.filter((p) => p.tipo === 'mascota' || p.tipo === 'bebe');
      if (!especiales.length && !diario) return;
      const C = window.EcoBebeComun;
      const fila = C.filaEspecial();
      if (!fila) return;
      const propia = perfiles.find((p) => p.esPropia);
      const lista = idActivo && propia ? [propia, ...especiales] : especiales;
      if (diario && propia) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'eco-bebe-pill eco-pill-bebe';
        d.textContent = C.emojiBebe(diario.genero) + ' ' + diario.nombre;
        d.setAttribute('aria-label', 'Abrir el diario de ' + diario.nombre);
        d.addEventListener('click', async () => {
          d.disabled = true;
          // Va a tu bitácora con el modo del diario abierto.
          try { localStorage.setItem('eco-bebe-activo', '1'); } catch (e) { /* nada */ }
          try {
            const r = await fetch('/api/subprofiles/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: propia.id }) });
            if (r.ok) { location.reload(); return; }
          } catch (e) { /* se reintenta con otro toque */ }
          d.disabled = false;
        });
        fila.appendChild(d);
      }
      lista.forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        const tipo = p.esPropia ? 'propia' : p.tipo === 'bebe' ? 'bebe' : 'mascota';
        b.className = 'eco-bebe-pill eco-pill-' + tipo;
        const nombre = p.esPropia ? String(p.nombre || 'Mi bitácora').split(/\s+/)[0] : p.nombre;
        b.textContent = (tipo === 'bebe' ? C.emojiBebe(p.tratamiento) + ' ' : tipo === 'mascota' ? C.emojiMascota(p.especie) + ' ' : '') + nombre;
        const activo = p.esPropia ? !idActivo : p.id === idActivo;
        if (activo) b.setAttribute('aria-current', 'true');
        b.setAttribute('aria-label', p.esPropia ? 'Volver a la bitácora de ' + nombre : 'Contar la vida de ' + p.nombre);
        b.addEventListener('click', async () => {
          if (activo) return;
          b.disabled = true;
          // Al cambiar de perfil se olvida el modo del diario de tu propia bitácora: si no, "ir a Felipe" volvía a abrir el del bebé.
          try { localStorage.setItem('eco-bebe-activo', '0'); } catch (e) { /* nada */ }
          try {
            const r = await fetch('/api/subprofiles/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) });
            if (r.ok) { location.reload(); return; }
          } catch (e) { /* se reintenta con otro toque */ }
          b.disabled = false;
        });
        fila.appendChild(b);
      });
    } catch (e) { /* sin bebés ni mascotas: la pantalla sigue igual */ }
  }

  document.addEventListener('eco:app-lista', arrancar);
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') arrancar();
})();

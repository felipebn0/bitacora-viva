/* Perfiles: agregar una mascota (perrito, gatito...). Quien la administra cuenta su vida. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const nombre = $('mascotaNombre');
  const especie = $('mascotaEspecie');
  const especieOtro = $('mascotaEspecieOtro');
  const raza = $('mascotaRaza');
  const sexo = $('mascotaSexo');
  const fecha = $('mascotaFecha');
  const boton = $('mascotaBtn');
  const msg = $('mascotaMsg');
  if (!boton) return;

  const avisar = (t, error) => { msg.textContent = t || ''; msg.classList.toggle('error', !!error); };

  especie.addEventListener('change', () => {
    especieOtro.hidden = especie.value !== 'otro';
    if (!especieOtro.hidden) especieOtro.focus();
  });

  boton.addEventListener('click', async () => {
    const nom = nombre.value.trim();
    if (!nom) { avisar('Falta el nombre.'); return; }
    if (!sexo.value) { avisar('Elige si es macho o hembra.'); return; }
    const esp = especie.value === 'otro' ? especieOtro.value.trim() : especie.value;
    if (!esp) { avisar('Escribe qué animal es.'); return; }
    boton.disabled = true;
    avisar('');
    try {
      const resp = await fetch('/api/subprofiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'mascota', nombre: nom, especie: esp, raza: raza.value.trim() || null, tratamiento: sexo.value, fechaNacimiento: fecha.value || null }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { avisar(data.error || 'No se pudo crear la mascota.', true); return; }
      nombre.value = raza.value = fecha.value = especieOtro.value = '';
      sexo.value = '';
      especie.value = 'perro';
      especieOtro.hidden = true;
      avisar(`✓ Se creó el perfil de ${data.nombre}.`);
      window.dispatchEvent(new CustomEvent('eco:perfil-creado', { detail: { id: data.id } }));
    } catch (e) {
      avisar('No se pudo conectar. Intenta de nuevo.', true);
    } finally {
      boton.disabled = false;
    }
  });
})();

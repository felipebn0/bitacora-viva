/* Perfiles: "Agregar un perfil". Un selector (familiar, mascota o bebé) muestra las opciones de cada tipo.
   El familiar lo crea el script de la propia página; aquí se crean la mascota y el bebé. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tipo = $('tipoPerfil');
  if (!tipo) return;

  const TEXTOS = {
    familiar: 'Para alguien que quieras administrar (ej. tu papá o tu mamá). No necesita usuario ni clave: le compartes un enlace permanente para que cuente sus propias historias.',
    mascota: 'Tú cuentas su vida: cómo llegó, sus travesuras, sus costumbres. Eco te pregunta por ella. Si quieres, compartes un enlace para que la familia sume sus recuerdos.',
    bebe: 'Su diario: fotos de cada día y lo que cuentes de él o ella. Tú hablas y Eco pregunta. Si quieres, compartes un enlace para que la familia sume sus recuerdos.',
  };
  const GRUPOS = { familiar: $('grupoFamiliar'), mascota: $('grupoMascota'), bebe: $('grupoBebe') };

  function mostrarTipo() {
    Object.entries(GRUPOS).forEach(([k, g]) => { g.hidden = k !== tipo.value; });
    $('nuevoSub').textContent = TEXTOS[tipo.value] || '';
  }
  tipo.addEventListener('change', mostrarTipo);
  mostrarTipo();

  async function crear(cuerpo, msg, boton, limpiar) {
    boton.disabled = true;
    msg.textContent = '';
    msg.classList.remove('error');
    try {
      const resp = await fetch('/api/subprofiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { msg.textContent = data.error || 'No se pudo crear el perfil.'; msg.classList.add('error'); return; }
      limpiar();
      msg.textContent = `✓ Se creó el perfil de ${data.nombre}.`;
      window.dispatchEvent(new CustomEvent('eco:perfil-creado', { detail: { id: data.id } }));
    } catch (e) {
      msg.textContent = 'No se pudo conectar. Intenta de nuevo.';
      msg.classList.add('error');
    } finally {
      boton.disabled = false;
    }
  }

  // --- Mascota ---
  const mEspecie = $('mascotaEspecie');
  const mEspecieOtro = $('mascotaEspecieOtro');
  mEspecie.addEventListener('change', () => {
    mEspecieOtro.hidden = mEspecie.value !== 'otro';
    if (!mEspecieOtro.hidden) mEspecieOtro.focus();
  });
  $('mascotaBtn').addEventListener('click', () => {
    const msg = $('mascotaMsg');
    const aviso = (t) => { msg.textContent = t; msg.classList.remove('error'); };
    const nombre = $('mascotaNombre').value.trim();
    if (!nombre) { aviso('Falta el nombre.'); return; }
    if (!$('mascotaSexo').value) { aviso('Elige si es macho o hembra.'); return; }
    const especie = mEspecie.value === 'otro' ? mEspecieOtro.value.trim() : mEspecie.value;
    if (!especie) { aviso('Escribe qué animal es.'); return; }
    crear({ tipo: 'mascota', nombre, especie, raza: $('mascotaRaza').value.trim() || null, tratamiento: $('mascotaSexo').value, fechaNacimiento: $('mascotaFecha').value || null }, msg, $('mascotaBtn'), () => {
      $('mascotaNombre').value = $('mascotaRaza').value = $('mascotaFecha').value = mEspecieOtro.value = '';
      $('mascotaSexo').value = '';
      mEspecie.value = 'perro';
      mEspecieOtro.hidden = true;
    });
  });

  // --- Bebé ---
  $('bebeNacio').addEventListener('change', () => {
    $('bebeFechaCampo').hidden = !$('bebeNacio').checked;
    if ($('bebeNacio').checked && !$('bebeFecha').value) $('bebeFecha').value = new Date().toISOString().slice(0, 10);
  });
  $('bebeBtn').addEventListener('click', () => {
    const msg = $('bebeMsg');
    const aviso = (t) => { msg.textContent = t; msg.classList.remove('error'); };
    const nombre = $('bebeNombre').value.trim();
    if (!nombre) { aviso('Falta el nombre.'); return; }
    const nacioEn = $('bebeNacio').checked ? $('bebeFecha').value : null;
    if ($('bebeNacio').checked && !nacioEn) { aviso('Pon la fecha de nacimiento.'); return; }
    crear({ tipo: 'bebe', nombre, tratamiento: $('bebeSexo').value || null, nacioEn }, msg, $('bebeBtn'), () => {
      $('bebeNombre').value = $('bebeFecha').value = '';
      $('bebeSexo').value = '';
      $('bebeNacio').checked = false;
      $('bebeFechaCampo').hidden = true;
    });
  });
})();

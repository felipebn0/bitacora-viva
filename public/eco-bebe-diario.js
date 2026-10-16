/* Página del diario de un bebé: la dueña crea el diario, sube fotos y notas; sus familiares invitados lo ven. */
(() => {
  'use strict';
  const C = window.EcoBebeComun;
  const $ = (id) => document.getElementById(id);
  const ownerParam = new URLSearchParams(location.search).get('owner');
  const consulta = ownerParam && /^\d+$/.test(ownerParam) ? '?owner=' + ownerParam : '';
  let estado = null;

  const E = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = texto; return x; };
  function aviso(texto, error) { const s = $('estado'); s.textContent = texto || ''; s.classList.toggle('error', !!error); }

  function pintarEntradas() {
    const lista = $('lista');
    lista.textContent = '';
    estado.entradas.forEach((x) => {
      const li = E('li', 'eco-bebe-entrada');
      if (x.fotoUrl) {
        const img = E('img');
        img.src = x.fotoUrl;
        img.loading = 'lazy';
        img.alt = x.texto ? 'Foto: ' + x.texto.slice(0, 80) : 'Foto del diario de ' + estado.config.nombre;
        li.appendChild(img);
      }
      const cuerpo = E('div', 'cuerpo');
      if (x.texto) cuerpo.appendChild(E('p', '', x.texto));
      cuerpo.appendChild(E('span', 'eco-bebe-fecha', C.fechaLarga(x.creadaEn)));
      if (estado.puedeEditar) {
        const b = E('button', 'eco-bebe-borrar', 'Borrar');
        b.type = 'button';
        b.addEventListener('click', () => borrar(x));
        cuerpo.appendChild(b);
      }
      li.appendChild(cuerpo);
      lista.appendChild(li);
    });
    const vacio = $('vacio');
    vacio.hidden = estado.entradas.length > 0;
    vacio.textContent = estado.puedeEditar
      ? 'Todavía no hay nada. Sube la primera foto o escribe cómo fue hoy.'
      : 'Todavía no hay nada en el diario. Cuando se suba algo, lo verás aquí.';
  }

  async function borrar(x) {
    if (!window.confirm('¿Borrar esto del diario? No se puede deshacer.')) return;
    const r = await fetch('/api/bebe/entradas/' + x.id, { method: 'DELETE' });
    if (!r.ok) { aviso('No se pudo borrar. Intenta de nuevo.', true); return; }
    estado.entradas = estado.entradas.filter((y) => y.id !== x.id);
    pintarEntradas();
    aviso('');
  }

  function pintarCabecera() {
    const cfg = estado.config;
    $('titulo').textContent = 'Diario de ' + cfg.nombre;
    $('subtitulo').textContent = C.etiqueta(cfg);
    document.title = 'Diario de ' + cfg.nombre + ' · Eco';
  }

  function precargarForm() {
    const cfg = estado.config;
    $('cfgNombre').value = cfg ? cfg.nombre : '';
    $('cfgGenero').value = cfg && cfg.genero ? cfg.genero : '';
    $('cfgNacio').checked = !!(cfg && cfg.nacioEn);
    $('cfgFecha').value = cfg && cfg.nacioEn ? cfg.nacioEn : '';
    $('cfgFechaCampo').hidden = !$('cfgNacio').checked;
  }

  function mostrar() {
    const cfg = estado.config;
    $('vistaCrear').hidden = !!cfg || !estado.puedeEditar;
    $('vistaDiario').hidden = !cfg;
    if (!cfg) {
      if (!estado.puedeEditar) aviso('Todavía no hay un diario para ver.');
      else { aviso(''); precargarForm(); $('formConfig').hidden = false; }
      return;
    }
    aviso('');
    pintarCabecera();
    $('nuevaEntrada').hidden = !estado.puedeEditar;
    $('ajustes').hidden = !estado.puedeEditar;
    $('avisoPrivacidad').textContent = estado.puedeEditar
      ? 'Lo que subes aquí lo ven solo los familiares que invitaste a tu bitácora. Lo que cuentas por voz va a tu libro y no se publica en el diario.'
      : 'Este diario lo comparte contigo su familia. No lo reenvíes sin permiso.';
    if (estado.puedeEditar) {
      $('ajustesForm').appendChild($('formConfig'));
      precargarForm();
    }
    $('volver').href = estado.puedeEditar ? '/app.html' : '/colaboraciones.html';
    pintarEntradas();
  }

  async function cargar() {
    try {
      const r = await fetch('/api/bebe' + consulta, { credentials: 'same-origin' });
      if (r.status === 401) { location.href = '/app.html'; return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { aviso(d.error || 'No se pudo abrir el diario.', true); return; }
      estado = d;
      mostrar();
    } catch (e) { aviso('Hubo un problema para conectar.', true); }
  }

  $('cfgNacio').addEventListener('change', () => {
    $('cfgFechaCampo').hidden = !$('cfgNacio').checked;
    if ($('cfgNacio').checked && !$('cfgFecha').value) $('cfgFecha').value = new Date().toISOString().slice(0, 10);
  });

  $('formConfig').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = $('cfgNombre').value.trim();
    if (!nombre) { aviso('Escribe el nombre del bebé.', true); $('cfgNombre').focus(); return; }
    const nacioEn = $('cfgNacio').checked ? $('cfgFecha').value : null;
    if ($('cfgNacio').checked && !nacioEn) { aviso('Pon la fecha de nacimiento.', true); return; }
    $('cfgGuardar').disabled = true;
    aviso('Guardando…');
    try {
      const r = await fetch('/api/bebe', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, genero: $('cfgGenero').value || null, nacioEn }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
      estado.config = d.config;
      $('vistaCrear').appendChild($('formConfig'));
      mostrar();
      aviso('Guardado.');
    } catch (e) { aviso(e.message, true); }
    $('cfgGuardar').disabled = false;
  });

  const voz = C.botonVoz($('textoNota'), 600);
  $('campoNota').insertBefore(voz.caja, $('textoNota'));

  $('botonFoto').addEventListener('click', () => $('inputFoto').click());
  let fotoElegida = null;
  $('inputFoto').addEventListener('change', () => {
    fotoElegida = $('inputFoto').files && $('inputFoto').files[0];
    $('inputFoto').value = '';
    if (fotoElegida) $('botonFoto').textContent = 'Foto lista: ' + fotoElegida.name.slice(0, 30);
  });

  $('guardarNota').addEventListener('click', async () => {
    if (voz.ocupado()) { aviso('Termina de contar primero: toca el botón de ECO.', true); return; }
    const texto = $('textoNota').value.trim();
    if (!fotoElegida && !texto) { aviso('Sube una foto o cuéntale algo a ECO.', true); return; }
    $('guardarNota').disabled = $('botonFoto').disabled = true;
    aviso('Guardando…');
    try {
      const entrada = fotoElegida ? await C.subirFoto(fotoElegida, texto) : await C.guardarEntrada({ texto });
      estado.entradas.unshift(entrada);
      fotoElegida = null;
      voz.reiniciar();
      $('botonFoto').textContent = 'Subir una foto de hoy';
      pintarEntradas();
      aviso('Guardado en el diario.');
    } catch (e) { aviso(e.message || 'No se pudo guardar.', true); }
    $('guardarNota').disabled = $('botonFoto').disabled = false;
  });

  cargar();
})();

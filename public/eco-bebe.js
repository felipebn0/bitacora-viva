/* Diario de un bebé, dentro de la sesión (app.html): un botón con el nombre del bebé activa un modo
   rosado tenue donde la charla se enfoca en el día a día y se invita a subir fotos. */
(() => {
  'use strict';
  const CLAVE = 'eco-bebe-activo';
  const html = document.documentElement;
  const C = () => window.EcoBebeComun;
  let config = null;
  let activo = false;
  let pill = null;
  let fila = null;
  let chip = null;
  let edad = null;
  let panel = null;

  const E = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = texto; return x; };

  window.EcoBebe = {
    activo: () => !!(activo && config),
    // El servidor avisa (data.bebe en /api/next) cuando en la charla contó que el bebé ya nació.
    actualizar(nuevo) {
      if (!config || !nuevo || !chip) return;
      config = Object.assign({}, config, nuevo);
      C().aplicarColor(config);
      pintarEdad();
    },
  };

  function leerGuardado() { try { return localStorage.getItem(CLAVE) === '1'; } catch (e) { return false; } }
  function recordar(v) { try { localStorage.setItem(CLAVE, v ? '1' : '0'); } catch (e) { /* nada */ } }

  // Nombre de la persona principal (el del saludo), para volver a su perfil desde el modo del bebé.
  function nombrePrincipal() {
    const el = document.getElementById('greetingName');
    const completo = (el && el.textContent || '').trim();
    return completo ? completo.split(/\s+/)[0] : '';
  }

  // Fuera del modo, el botón lleva el nombre del bebé (entrar a su modo); dentro, el de la persona
  // principal (volver a su perfil).
  // Esquina superior derecha de la tarjeta: "Edad" y los días desde que nació (solo si ya nació).
  function pintarEdad() {
    if (!edad) return;
    const dias = C().diasDeVida(config.nacioEn);
    edad.hidden = !activo || dias === null;
    // Con la edad a la vista, el estado va corto ("Rafaela, ya llegó") y la fila le deja espacio.
    chip.textContent = dias === null ? C().etiqueta(config) : config.nombre + ', ya llegó';
    fila.classList.toggle('con-edad', !edad.hidden);
    if (dias === null) return;
    edad.querySelector('.eco-bebe-edad-num').textContent = dias === 0 ? 'Hoy' : String(dias);
    edad.querySelector('.eco-bebe-edad-unidad').textContent = dias === 0 ? 'nació' : dias === 1 ? 'día' : 'días';
    edad.setAttribute('aria-label', dias === 0 ? 'Edad: nació hoy' : 'Edad: ' + dias + (dias === 1 ? ' día' : ' días'));
  }

  function pintarEstado() {
    html.classList.toggle('eco-bebe-activo', activo);
    pill.setAttribute('aria-pressed', activo ? 'true' : 'false');
    const principal = nombrePrincipal();
    pill.textContent = activo ? (principal || 'Volver a mi perfil') : config.nombre;
    pill.setAttribute('aria-label', activo
      ? (principal ? 'Volver al perfil de ' + principal : 'Volver a mi perfil')
      : 'Entrar al diario de ' + config.nombre);
    panel.hidden = !activo;
    chip.hidden = !activo;
    pintarEdad();
  }

  function cambiar(valor) {
    activo = valor;
    recordar(valor);
    pintarEstado();
  }

  function pintarTira(entradas) {
    const tira = panel.querySelector('.eco-bebe-tira');
    tira.textContent = '';
    entradas.filter((x) => x.fotoUrl).slice(0, 4).forEach((x) => {
      const li = E('li');
      const img = E('img');
      img.src = x.fotoUrl;
      img.alt = x.texto ? 'Foto: ' + x.texto.slice(0, 80) : 'Foto del diario';
      img.loading = 'lazy';
      li.appendChild(img);
      tira.appendChild(li);
    });
    tira.hidden = !tira.children.length;
  }

  function armarPanel(entradas) {
    panel = E('section', 'eco-bebe-panel');
    panel.id = 'ecoBebePanel';
    panel.setAttribute('aria-label', 'Diario de ' + config.nombre);
    const tira = E('ul', 'eco-bebe-tira');
    const foto = E('button', 'eco-bebe-grande', 'Subir una foto de hoy');
    foto.type = 'button';
    foto.id = 'ecoBebeFoto';
    const input = E('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.setAttribute('aria-label', 'Elegir una foto');
    const ver = E('a', 'eco-bebe-enlace', 'Ver el diario completo');
    ver.href = '/diario-bebe.html';
    const msg = E('p', 'eco-bebe-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    panel.append(tira, foto, input, ver, msg);

    const aviso = (t, error) => { msg.textContent = t; msg.classList.toggle('error', !!error); };

    foto.addEventListener('click', () => {
      // Se aprovecha el toque para habilitar el audio y el micrófono: la charla arranca sola
      // cuando la foto termina de subir, y el celular solo deja sonar audio tras un toque.
      if (window.ecoPrepararAudio) window.ecoPrepararAudio();
      input.click();
    });
    // La foto se guarda en el diario apenas se elige y la charla grande de ECO arranca sola para
    // contar la historia de esa foto (lo que se cuente queda en el libro y pegado a esa foto).
    input.addEventListener('change', async () => {
      const archivo = input.files && input.files[0];
      input.value = '';
      if (!archivo) return;
      foto.disabled = true;
      aviso('Guardando la foto…');
      try {
        const entrada = await C().subirFoto(archivo, '');
        entradas.unshift(entrada);
        pintarTira(entradas);
        aviso('Foto guardada. Cuéntale a ECO qué pasó.');
        if (window.ecoFotoDelDiario) window.ecoFotoDelDiario(entrada.id, entrada.fotoUrl);
      } catch (e) {
        aviso(e.message || 'No se pudo subir la foto. Intenta de nuevo.', true);
      }
      foto.disabled = false;
    });
    pintarTira(entradas);
  }

  function montar(entradas) {
    const area = document.querySelector('.body-area');
    if (!area || pill) return;
    pill = E('button', 'eco-bebe-pill', config.nombre);
    pill.type = 'button';
    pill.id = 'ecoBebePill';
    pill.setAttribute('aria-pressed', 'false');
    pill.setAttribute('aria-controls', 'ecoBebePanel');
    pill.addEventListener('click', () => cambiar(!activo));
    // El estado del bebé ("Roma, en camino") va en la misma fila del botón.
    chip = E('p', 'eco-bebe-chip', C().etiqueta(config));
    fila = E('div', 'eco-bebe-fila');
    fila.append(pill, chip);
    edad = E('div', 'eco-bebe-edad');
    edad.setAttribute('role', 'note');
    edad.append(E('span', 'eco-bebe-edad-label', 'Edad'), E('span', 'eco-bebe-edad-num'), E('span', 'eco-bebe-edad-unidad'));
    (area.closest('.device') || area).appendChild(edad);
    armarPanel(entradas);
    const saludo = document.getElementById('greeting');
    area.insertBefore(fila, area.firstChild);
    area.insertBefore(panel, saludo ? saludo.nextSibling : fila.nextSibling);
    activo = leerGuardado();
    pintarEstado();
  }

  async function arrancar() {
    if (pill) return;
    try {
      const resp = await fetch('/api/bebe', { credentials: 'same-origin' });
      if (!resp.ok) return;
      const datos = await resp.json();
      if (!datos.config || !datos.puedeEditar) return;
      config = datos.config;
      C().aplicarColor(config);
      montar(datos.entradas || []);
    } catch (e) { /* sin diario: la sesión sigue igual */ }
  }

  document.addEventListener('eco:app-lista', arrancar);
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') arrancar();
})();

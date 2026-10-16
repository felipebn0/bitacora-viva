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
  let panel = null;

  const E = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = texto; return x; };

  window.EcoBebe = { activo: () => !!(activo && config) };

  function leerGuardado() { try { return localStorage.getItem(CLAVE) === '1'; } catch (e) { return false; } }
  function recordar(v) { try { localStorage.setItem(CLAVE, v ? '1' : '0'); } catch (e) { /* nada */ } }

  function pintarEstado() {
    html.classList.toggle('eco-bebe-activo', activo);
    pill.setAttribute('aria-pressed', activo ? 'true' : 'false');
    panel.hidden = !activo;
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
    const chip = E('p', 'eco-bebe-chip', C().etiqueta(config));
    const pregunta = E('p', 'eco-bebe-pregunta', config.estado === 'nacida'
      ? 'Guarda un momento de hoy con ' + config.nombre + '.'
      : 'Cuéntame cómo te sientes hoy, y guarda una foto de este día.');
    const tira = E('ul', 'eco-bebe-tira');
    const foto = E('button', 'eco-bebe-grande', 'Subir una foto de hoy');
    foto.type = 'button';
    foto.id = 'ecoBebeFoto';
    const input = E('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.setAttribute('aria-label', 'Elegir una foto');
    const nota = E('div', 'eco-bebe-nota');
    nota.hidden = true;
    const texto = E('textarea');
    texto.maxLength = 600;
    texto.placeholder = 'Qué pasó en esta foto (opcional)';
    texto.setAttribute('aria-label', 'Qué pasó en esta foto');
    const invitacion = E('p', 'eco-bebe-invitacion', 'Cuéntale a ECO qué pasó en esta foto (si quieres).');
    const voz = C().botonVoz(texto, 600);
    const guardar = E('button', 'eco-bebe-grande', 'Guardar en el diario');
    guardar.type = 'button';
    nota.append(invitacion, voz.caja, texto, guardar);
    const hablar = E('button', 'eco-bebe-secundario', 'Contar mi día con ' + config.nombre);
    hablar.type = 'button';
    hablar.id = 'ecoBebeHablar';
    const ver = E('a', 'eco-bebe-enlace', 'Ver el diario completo');
    ver.href = '/diario-bebe.html';
    const msg = E('p', 'eco-bebe-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    panel.append(chip, pregunta, tira, foto, input, nota, hablar, ver, msg);

    let elegida = null;
    const aviso = (t, error) => { msg.textContent = t; msg.classList.toggle('error', !!error); };

    foto.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      elegida = input.files && input.files[0];
      input.value = '';
      if (!elegida) return;
      voz.reiniciar();
      nota.hidden = false;
      aviso('');
      invitacion.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    guardar.addEventListener('click', async () => {
      if (!elegida) return;
      if (voz.ocupado()) { aviso('Termina de contar primero: toca el botón de ECO.', true); return; }
      const archivo = elegida;
      guardar.disabled = foto.disabled = true;
      aviso('Subiendo…');
      try {
        const entrada = await C().subirFoto(archivo, texto.value.trim());
        entradas.unshift(entrada);
        pintarTira(entradas);
        elegida = null;
        voz.reiniciar();
        nota.hidden = true;
        aviso('Guardada en el diario.');
      } catch (e) {
        aviso(e.message || 'No se pudo subir la foto. Intenta de nuevo.', true);
      }
      guardar.disabled = foto.disabled = false;
    });
    hablar.addEventListener('click', () => {
      const orbe = document.getElementById('orb');
      if (!orbe) return;
      if (orbe.dataset.state === 'idle') orbe.click();
      else orbe.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    armarPanel(entradas);
    const saludo = document.getElementById('greeting');
    area.insertBefore(pill, area.firstChild);
    area.insertBefore(panel, saludo ? saludo.nextSibling : pill.nextSibling);
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
      montar(datos.entradas || []);
    } catch (e) { /* sin diario: la sesión sigue igual */ }
  }

  document.addEventListener('eco:app-lista', arrancar);
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') arrancar();
})();

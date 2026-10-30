/* Recordatorio diario dentro de la app del celular (Capacitor): una notificación local a la hora que la persona
   elija. En el navegador no hace nada. La preferencia se guarda en este celular. */
(() => {
  'use strict';
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
  const LN = cap.Plugins && cap.Plugins.LocalNotifications;
  if (!LN) return;

  const CLAVE = 'eco-recordatorio-app';
  const ID_DIARIO = 1700;
  const ID_PRUEBA = 1701;
  const TITULO = '¿Le damos un ratico a Eco? 🌿';
  const CUERPO = 'Con 5 minutos basta: cuéntame algo de tu día y lo guardamos como un recuerdo.';

  function leer() {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (g && typeof g.activo === 'boolean' && /^\d{2}:\d{2}$/.test(g.hora)) return g;
    } catch (e) { /* sin preferencia guardada */ }
    return { activo: true, hora: '17:00' };
  }
  function guardar(p) { try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch (e) { /* nada */ } }

  async function conPermiso() {
    let estado = await LN.checkPermissions();
    if (estado.display === 'prompt' || estado.display === 'prompt-with-rationale') estado = await LN.requestPermissions();
    return estado.display === 'granted';
  }

  async function aplicar() {
    const p = leer();
    try {
      await LN.cancel({ notifications: [{ id: ID_DIARIO }] });
      if (!p.activo) return true;
      if (!(await conPermiso())) return false;
      const [hour, minute] = p.hora.split(':').map(Number);
      await LN.schedule({ notifications: [{ id: ID_DIARIO, title: TITULO, body: CUERPO, schedule: { on: { hour, minute }, allowWhileIdle: true } }] });
      return true;
    } catch (e) { return false; }
  }

  async function probar() {
    if (!(await conPermiso())) return false;
    await LN.schedule({ notifications: [{ id: ID_PRUEBA, title: TITULO, body: CUERPO, schedule: { at: new Date(Date.now() + 10000) } }] });
    return true;
  }

  const E = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = texto; return x; };

  function montarPanel() {
    const seccion = document.getElementById('umSecRecordatorios');
    if (!seccion || document.getElementById('umRecordatorioApp')) return;
    const p = leer();
    const caja = E('div', 'um-recordatorio-app');
    caja.id = 'umRecordatorioApp';
    const titulo = E('p', 'um-field-label', 'Recordatorio diario en esta app');
    const etiqueta = E('label', 'um-hint um-recordatorio-app-fila');
    const check = E('input');
    check.type = 'checkbox';
    check.id = 'umRecordatorioAppActivo';
    check.checked = p.activo;
    etiqueta.append(check, document.createTextNode(' Avisarme todos los días'));
    const horaEtiqueta = E('label', 'um-field-label', 'A qué hora');
    horaEtiqueta.htmlFor = 'umRecordatorioAppHora';
    const hora = E('input');
    hora.type = 'time';
    hora.id = 'umRecordatorioAppHora';
    hora.value = p.hora;
    const guardarBtn = E('button', 'um-btn', 'Guardar recordatorio');
    guardarBtn.type = 'button';
    const probarBtn = E('button', 'um-btn um-plain', 'Enviarme una de prueba (llega en 10 segundos)');
    probarBtn.type = 'button';
    const msg = E('p', 'um-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    caja.append(titulo, etiqueta, horaEtiqueta, hora, guardarBtn, probarBtn, msg);
    seccion.prepend(caja);

    guardarBtn.addEventListener('click', async () => {
      const nueva = { activo: check.checked, hora: /^\d{2}:\d{2}$/.test(hora.value) ? hora.value : '17:00' };
      guardar(nueva);
      const bien = await aplicar();
      msg.textContent = !nueva.activo ? 'Listo, no te voy a avisar.'
        : bien ? 'Listo, te aviso todos los días a las ' + nueva.hora + '.'
        : 'No tengo permiso para enviarte avisos. Actívalo en Ajustes > Notificaciones > Eco.';
    });
    probarBtn.addEventListener('click', async () => {
      const bien = await probar();
      msg.textContent = bien ? 'Te llega en 10 segundos.' : 'No tengo permiso para enviarte avisos. Actívalo en Ajustes > Notificaciones > Eco.';
    });
  }

  let aplicado = false;
  function iniciar() {
    montarPanel();
    if (aplicado) return;
    aplicado = true;
    aplicar();
  }
  document.addEventListener('eco:app-lista', iniciar);
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') iniciar();
  else document.addEventListener('DOMContentLoaded', montarPanel);
})();

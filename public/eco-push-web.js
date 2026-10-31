/* Avisos push en el celular (Web Push): un bloque dentro de Recordatorios para activarlos, apagarlos, encender o apagar el
   recordatorio diario y mandarse uno de prueba. En la app de Xcode (Capacitor) no aplica: ahí hay recordatorios locales. */
(() => {
  'use strict';
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return;

  const E = (tag, clase, texto) => { const x = document.createElement(tag); if (clase) x.className = clase; if (texto !== undefined) x.textContent = texto; return x; };
  const compatible = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const esIphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const claveABytes = (b64) => {
    const relleno = '='.repeat((4 - (b64.length % 4)) % 4);
    const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
  };
  const enviarJson = (ruta, cuerpo) => fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(cuerpo) });

  async function montar() {
    const seccion = document.getElementById('umSecRecordatorios');
    if (!seccion || document.getElementById('umPushWeb')) return;
    let cfg = null;
    try { cfg = await (await fetch('/api/push/clave', { credentials: 'same-origin' })).json(); } catch (e) { return; }
    if (!cfg || !cfg.habilitado) return;

    const caja = E('div', 'um-push-web');
    caja.id = 'umPushWeb';
    caja.append(E('p', 'um-field-label', 'Avisos de aportes en este celular'));
    const msg = E('p', 'um-msg');
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    seccion.prepend(caja);

    if (!compatible) {
      caja.append(E('p', 'um-hint', esIphone && !instalada
        ? 'En iPhone, instala Eco primero: toca Compartir y luego "Añadir a pantalla de inicio", y ábrela desde ahí para activar los avisos.'
        : 'Este navegador no permite avisos.'));
      return;
    }

    const activar = E('button', 'um-btn', 'Activar avisos (aportes de familiares y recordatorio diario)');
    const apagar = E('button', 'um-btn um-plain', 'Dejar de avisarme en este celular');
    const probar = E('button', 'um-btn um-plain', 'Mandarme un aviso de prueba');
    const diario = E('button', 'um-btn um-plain', '');
    [activar, apagar, probar, diario].forEach((b) => { b.type = 'button'; });
    caja.append(activar, probar, diario, apagar, msg);
    let diarioActivo = true;

    async function suscripcionActual() {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return reg ? reg.pushManager.getSubscription() : null;
    }
    async function pintar() {
      let sub = null;
      try { sub = await suscripcionActual(); } catch (e) { /* sin suscripción */ }
      const activo = !!sub && Notification.permission === 'granted';
      activar.hidden = activo;
      apagar.hidden = !activo;
      probar.hidden = !activo;
      diario.hidden = !activo;
      if (activo) {
        try { const d = await (await fetch('/api/push/recordatorio', { credentials: 'same-origin' })).json(); diarioActivo = d.activo !== false; } catch (e) { /* queda como estaba */ }
        diario.textContent = diarioActivo ? 'Apagar el recordatorio diario de las 5 pm' : 'Encender el recordatorio diario de las 5 pm';
      }
      if (Notification.permission === 'denied') msg.textContent = 'Los avisos están bloqueados. Actívalos en Ajustes > Notificaciones > Eco (o en los permisos del sitio).';
    }

    activar.addEventListener('click', async () => {
      try {
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') { msg.textContent = 'No diste permiso para los avisos.'; return pintar(); }
        const reg = await navigator.serviceWorker.register('/eco-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(cfg.clave) });
        const r = await enviarJson('/api/push/suscribir', { subscription: sub.toJSON() });
        msg.textContent = r.ok ? 'Listo, te avisamos cuando un familiar cuente una historia y te recordamos charlar cada día a las 5 pm.' : 'No se pudieron activar los avisos. Intenta de nuevo.';
      } catch (e) {
        msg.textContent = 'No se pudieron activar los avisos en este celular.';
      }
      pintar();
    });
    apagar.addEventListener('click', async () => {
      try {
        const sub = await suscripcionActual();
        if (sub) { await enviarJson('/api/push/baja', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
        msg.textContent = 'Listo, no te vamos a avisar en este celular.';
      } catch (e) { msg.textContent = 'No se pudo apagar. Intenta de nuevo.'; }
      pintar();
    });
    diario.addEventListener('click', async () => {
      const r = await enviarJson('/api/push/recordatorio', { activo: !diarioActivo }).catch(() => null);
      if (r && r.ok) { diarioActivo = !diarioActivo; msg.textContent = diarioActivo ? 'Listo, te recordamos cada día a las 5 pm.' : 'Listo, no te mandamos el recordatorio diario. Los avisos de aportes siguen.'; }
      else msg.textContent = 'No se pudo cambiar. Intenta de nuevo.';
      pintar();
    });
    probar.addEventListener('click', async () => {
      const r = await enviarJson('/api/push/prueba', {}).catch(() => null);
      const d = r && r.ok ? await r.json().catch(() => ({})) : {};
      msg.textContent = d.enviados ? 'Te lo mandamos, debería llegar en unos segundos.' : 'No se pudo mandar el aviso de prueba.';
    });
    pintar();
  }

  document.addEventListener('eco:app-lista', montar);
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') montar();
})();

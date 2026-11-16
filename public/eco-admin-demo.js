/* Panel de admin: analítica de la demo pública de un minuto (/demo). Datos de /api/admin/demo (demo-routes.js). */
(() => {
  'use strict';
  const wrap = document.getElementById('demoWrap');
  if (!wrap) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('es-CO');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  let dias = 30;

  const PASOS = [
    ['visita', 'Abrieron /demo', 'Visitas a la página (una por pestaña).'],
    ['empezo', 'Empezaron', 'Escribieron su nombre y arrancó la charla.'],
    ['saludo', 'Eco los saludó', 'La IA y la voz respondieron.'],
    ['hablo', 'Hablaron', 'Dijeron algo al menos una vez.'],
    ['completo', 'Terminaron el minuto', 'Escucharon la despedida de Eco.'],
    ['popup', 'Vieron la invitación', 'Les salió la ventana de registro al final (o si la demo se cortó).'],
    ['clic_registro', 'Tocaron «Crear mi cuenta»', 'Fueron al registro desde la demo.'],
    ['cuentas', 'Crearon la cuenta', 'Cuentas nuevas con origen «demo».'],
  ];

  function pintar(d) {
    const t = d.totales || {};
    const max = Math.max(1, ...PASOS.map(([k]) => Number(t[k]) || 0));
    const embudo = PASOS.map(([k, titulo, ayuda], i) => {
      const anterior = i ? Number(t[PASOS[i - 1][0]]) || 0 : 0;
      return `<li class="dm-paso">
        <div class="dm-paso__texto"><strong>${esc(titulo)}</strong><span>${esc(ayuda)}</span></div>
        <div class="dm-paso__barra"><span data-ancho="${(Number(t[k]) || 0) / max}"></span></div>
        <div class="dm-paso__num"><strong>${num(t[k])}</strong><span>${i ? pct(Number(t[k]) || 0, anterior) + ' del paso anterior' : ''}</span></div>
      </li>`;
    }).join('');
    const turnosPorDemo = t.hablo ? (t.turno_persona / t.hablo).toFixed(1) : '—';
    const filas = (d.porDia || []).map((f) => `<tr>
      <td>${esc(f.dia)}</td><td>${num(f.visita)}</td><td>${num(f.empezo)}</td><td>${num(f.hablo)}</td>
      <td>${num(f.completo)}</td><td>${num(f.clic_registro)}</td><td>${num(f.cuentas)}</td>
      <td>${num(f.mic_negado + f.limite + f.cupo + f.error_ia)}</td></tr>`).join('');
    const botones = [7, 30, 90].map((n) => `<button type="button" class="range-btn${n === dias ? ' active' : ''}" data-dias="${n}">${n} días</button>`).join('');
    wrap.innerHTML = `
      <section class="panel">
        <h2>Demo pública de un minuto (/demo)${d.apagada ? ' · APAGADA' : ''}</h2>
        <p class="sub">Cuánta gente prueba la demo y hasta dónde llega. Solo se cuentan pasos: nunca quién fue ni qué dijo. Tus propias pruebas cuentan igual. Días en hora de Colombia.</p>
        <div class="dm-rango">${botones}</div>
        <div class="stats-row">
          <div class="stat-card"><p class="label">Conversión total</p><p class="value">${pct(t.cuentas, t.empezo)}</p><p class="sub">de quienes empezaron crearon cuenta</p></div>
          <div class="stat-card"><p class="label">Terminan el minuto</p><p class="value">${pct(t.completo, t.empezo)}</p><p class="sub">de quienes empezaron</p></div>
          <div class="stat-card"><p class="label">Respuestas por demo</p><p class="value">${turnosPorDemo}</p><p class="sub">veces que habló la persona, en promedio</p></div>
          <div class="stat-card"><p class="label">«Ahora no»</p><p class="value">${num(t.ahora_no)}</p><p class="sub">cerraron la invitación</p></div>
        </div>
        <ol class="dm-embudo">${embudo}</ol>
        <h3 class="dm-sub">Problemas</h3>
        <div class="stats-row">
          <div class="stat-card"><p class="label">Micrófono negado</p><p class="value">${num(t.mic_negado)}</p><p class="sub">no dieron permiso</p></div>
          <div class="stat-card"><p class="label">Frenados por red</p><p class="value">${num(t.limite)}</p><p class="sub">más de ${num(d.limites && d.limites.porRed)} demos en un día</p></div>
          <div class="stat-card"><p class="label">Frenados por cupo</p><p class="value">${num(t.cupo)}</p><p class="sub">ya iban ${num(d.limites && d.limites.alDia)} demos ese día</p></div>
          <div class="stat-card"><p class="label">Fallas de la IA</p><p class="value">${num(t.error_ia)}</p><p class="sub">Eco no pudo responder (por ejemplo, sin saldo)</p></div>
        </div>
        ${filas ? `<div class="dm-tabla"><table class="pr-tabla"><thead><tr><th>Día</th><th>Abrieron</th><th>Empezaron</th><th>Hablaron</th><th>Terminaron</th><th>Tocaron registro</th><th>Cuentas</th><th>Problemas</th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="ab-note">Nadie ha usado la demo en este período.</p>'}
      </section>`;
    wrap.querySelectorAll('[data-ancho]').forEach((el) => { el.style.width = (Number(el.dataset.ancho) * 100).toFixed(1) + '%'; });
  }

  function cargar() {
    fetch('/api/admin/demo?dias=' + dias)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(pintar)
      .catch((status) => {
        if (status === 401 || status === 403) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = '<section class="panel"><h2>Demo pública de un minuto</h2><p class="sub">No se pudo cargar esta sección.</p></section>';
      });
  }

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dias]');
    if (!b) return;
    dias = Number(b.dataset.dias) || 30;
    cargar();
  });
  cargar();
})();

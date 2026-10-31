/* Al abrir Eco (o volver a ella), avisa con una franja si hay aportes de familiares que todavía no viste. */
(() => {
  'use strict';
  const CLAVE = 'eco-aviso-aportes';
  let enCurso = false;

  function frase(nombres) {
    if (nombres.length === 1) return nombres[0] + ' contó una historia';
    if (nombres.length === 2) return nombres[0] + ' y ' + nombres[1] + ' contaron historias';
    return nombres[0] + ', ' + nombres[1] + ' y ' + (nombres.length - 2) + ' más contaron historias';
  }

  function mostrar(nombres) {
    if (document.getElementById('ecoAvisoAportes')) return;
    const franja = document.createElement('div');
    franja.id = 'ecoAvisoAportes';
    franja.className = 'eco-aviso-aportes';
    franja.setAttribute('role', 'status');
    const texto = document.createElement('span');
    texto.textContent = frase(nombres) + '.';
    const ver = document.createElement('a');
    ver.href = '/colaboraciones.html';
    ver.textContent = 'Verlas';
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar aviso');
    cerrar.textContent = '×';
    cerrar.addEventListener('click', () => franja.remove());
    franja.append(texto, ver, cerrar);
    document.body.appendChild(franja);
  }

  async function revisar() {
    if (enCurso) return;
    enCurso = true;
    try {
      const resp = await fetch('/api/aportes/pending', { credentials: 'same-origin' });
      if (!resp.ok) return;
      const nombres = ((await resp.json()).names || []).filter((n) => typeof n === 'string' && n.trim());
      if (!nombres.length) { try { sessionStorage.removeItem(CLAVE); } catch (e) { /* nada */ } return; }
      const firma = nombres.join('|');
      let visto = null;
      try { visto = sessionStorage.getItem(CLAVE); } catch (e) { /* nada */ }
      if (visto === firma) return;
      try { sessionStorage.setItem(CLAVE, firma); } catch (e) { /* nada */ }
      mostrar(nombres);
    } catch (e) { /* sin aviso */ } finally { enCurso = false; }
  }

  document.addEventListener('eco:app-lista', revisar);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.getElementById('appContent') && document.getElementById('appContent').style.display === 'flex') revisar(); });
  const contenido = document.getElementById('appContent');
  if (contenido && contenido.style.display === 'flex') revisar();
})();

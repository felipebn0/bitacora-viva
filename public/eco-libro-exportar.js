/* Mi libro: botón "Exportar en PDF". Si la compra de prueba no está aprobada, abre la ventana de compra;
   al aprobarse (o si ya estaba) prepara el libro completo y abre de una vez la ventana de impresión,
   donde se elige "Guardar como PDF". También se exporta de una vez al comprar desde el editor. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  let ocupado = false, boton = null, mensaje = null;

  function aviso(texto, error) {
    if (!mensaje) return;
    mensaje.textContent = texto || '';
    mensaje.classList.toggle('eco-libro-exportar-error', !!error);
  }

  async function esperarHasta(condicion, ms) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { const v = condicion(); if (v) return v; await esperar(150); }
    return null;
  }

  const paginas = () => document.querySelectorAll('#ecoEditorialBook .eco-editorial-page').length;

  // Deja el libro completo armado en el editor (abriéndolo si hace falta) y devuelve si hay que cerrarlo después.
  async function prepararLibro() {
    let abiertoAqui = false;
    const dialogo = $('ecoEditorialDialog');
    if (!dialogo || dialogo.hidden) {
      const abrir = $('ecoEditorialOpen');
      if (!abrir) throw new Error('No se pudo abrir el libro. Recarga la página e intenta de nuevo.');
      abrir.click();
      abiertoAqui = true;
    }
    const listo = await esperarHasta(() => {
      const estado = ($('ecoEditorialStatus') || {}).textContent || '';
      if (/Inicia sesión|No se pudo/.test(estado)) return 'error:' + estado;
      return estado.includes('✓') ? 'ok' : null;
    }, 20000);
    if (!listo || listo.startsWith('error:')) throw new Error(listo ? listo.slice(6) : 'El libro tardó demasiado en cargar. Intenta de nuevo.');
    const vista = document.querySelector('#ecoEditorialDialog [data-view="preview"]');
    if (vista) vista.click();
    if (!(await esperarHasta(() => paginas() > 0, 8000))) throw new Error('Todavía no hay páginas en tu libro. Genera tus capítulos primero.');
    const imagenes = [...document.querySelectorAll('#ecoEditorialBook img')];
    await Promise.all(imagenes.map((im) => im.complete ? null : Promise.race([
      new Promise((ok) => { im.addEventListener('load', ok, { once: true }); im.addEventListener('error', ok, { once: true }); }),
      esperar(5000),
    ])));
    return abiertoAqui;
  }

  async function exportar({ yaAprobada = false } = {}) {
    if (ocupado) return;
    ocupado = true;
    const texto = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.textContent = 'Preparando tu libro…'; }
    aviso('');
    let cerrarDespues = false;
    try {
      if (!yaAprobada) {
        // Antes de pedir pago: tiene que haber capítulos que exportar.
        let hay = true;
        try { const r = await fetch('/api/chapters', { credentials: 'same-origin' }); if (r.ok) hay = ((await r.json()).chapters || []).length > 0; } catch (e) { /* sin conexión: se intenta igual */ }
        if (!hay) { aviso('Todavía no tienes capítulos. Genera tus capítulos primero y luego exporta tu libro.', true); return; }
      }
      if (!yaAprobada && window.EcoLibroCompra && !(await window.EcoLibroCompra.asegurar())) { aviso('Para exportar el PDF primero hay que completar la compra de prueba.'); return; }
      aviso('Preparando tu libro…');
      cerrarDespues = await prepararLibro();
      aviso('Se abrió la ventana de impresión: elige «Guardar como PDF» para descargarlo.');
      if (cerrarDespues) window.addEventListener('afterprint', () => { $('ecoEditorialClose')?.click(); }, { once: true });
      window.print();
    } catch (e) {
      aviso(e.message || 'No se pudo preparar el PDF.', true);
      if (cerrarDespues) $('ecoEditorialClose')?.click();
    } finally {
      ocupado = false;
      if (boton) { boton.disabled = false; boton.textContent = texto; }
    }
  }

  function montar() {
    if ($('ecoLibroExportar')) return;
    const abrir = $('ecoEditorialOpen');
    if (!abrir) return;
    boton = document.createElement('button');
    boton.type = 'button';
    boton.id = 'ecoLibroExportar';
    boton.className = 'eco-libro-exportar';
    boton.textContent = 'Exportar en PDF';
    boton.addEventListener('click', () => exportar());
    mensaje = document.createElement('p');
    mensaje.id = 'ecoLibroExportarMsg';
    mensaje.className = 'eco-libro-exportar-msg';
    mensaje.setAttribute('role', 'status');
    mensaje.setAttribute('aria-live', 'polite');
    abrir.insertAdjacentElement('afterend', boton);
    boton.insertAdjacentElement('afterend', mensaje);
  }

  // Compra aprobada desde el botón del editor: se descarga de una vez.
  window.addEventListener('eco:compra-aprobada', () => exportar({ yaAprobada: true }));

  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();

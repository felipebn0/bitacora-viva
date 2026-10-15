/* Diario de un bebé: piezas que comparten la sesión (app.html) y la página del diario. */
(() => {
  'use strict';
  const MAX_BYTES = 4 * 1024 * 1024;
  const LADO_MAXIMO = 1600;

  async function comprimir(archivo) {
    if (archivo.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(archivo.type)) return archivo;
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      const escala = Math.min(1, LADO_MAXIMO / Math.max(bmp.width, bmp.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(bmp.width * escala));
      lienzo.height = Math.max(1, Math.round(bmp.height * escala));
      lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
      if (blob) return blob;
    } catch (e) { /* se intenta con el archivo original */ }
    if (archivo.size <= MAX_BYTES) return archivo;
    throw new Error('Esa foto pesa demasiado. Prueba con otra.');
  }

  async function subirFoto(archivo, texto) {
    if (!archivo || !/^image\//.test(archivo.type || '')) throw new Error('Elige una foto.');
    const listo = await comprimir(archivo);
    const r1 = await fetch('/api/bebe/foto', { method: 'POST', headers: { 'Content-Type': listo.type || 'image/jpeg' }, body: listo });
    const d1 = await r1.json().catch(() => ({}));
    if (!r1.ok) throw new Error(d1.error || 'No se pudo subir la foto.');
    return guardarEntrada({ texto, fotoUrl: d1.url });
  }

  async function guardarEntrada(cuerpo) {
    const r = await fetch('/api/bebe/entradas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
    return d.entrada;
  }

  function edadTexto(nacioEn) {
    const dias = Math.floor((Date.now() - Date.parse(nacioEn + 'T12:00:00')) / 86400000);
    if (dias <= 0) return 'nació hoy';
    if (dias === 1) return '1 día';
    if (dias < 14) return dias + ' días';
    if (dias < 90) return Math.floor(dias / 7) + ' semanas';
    const meses = Math.floor(dias / 30.4);
    return meses === 1 ? '1 mes' : meses + ' meses';
  }

  function etiqueta(config) {
    if (!config) return '';
    if (config.estado === 'nacida') {
      const edad = edadTexto(config.nacioEn);
      return config.nombre + ', ya llegó' + (edad === 'nació hoy' ? ' hoy' : ' (' + edad + ')');
    }
    return config.nombre + ', en camino';
  }

  function fechaLarga(iso) {
    try { return new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; }
  }

  window.EcoBebeComun = { subirFoto, guardarEntrada, etiqueta, edadTexto, fechaLarga };
})();

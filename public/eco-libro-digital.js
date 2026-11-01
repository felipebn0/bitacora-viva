/* Mi libro: "Descargar libro digital" (lo llama el estudio del libro). Arma un solo archivo HTML (sin internet, se abre en
   cualquier navegador) con la estantería de capítulos de public/libro-digital-plantilla.txt: títulos y textos ya editados,
   fotos reducidas, los audios originales de cada capítulo y las tipografías incluidas. El texto del libro va también como
   página de lectura, para que se vea donde no corre JavaScript (la vista previa de Archivos del iPhone). */
(() => {
  'use strict';
  const MAX_FOTOS = 36, MAX_FOTOS_POR_CAPITULO = 6, LADO_MAX = 1100, BYTES_MAX = 14 * 1024 * 1024;
  const AUDIO_BYTES_MAX = 30 * 1024 * 1024, AUDIO_UNO_MAX = 8 * 1024 * 1024;
  const FUENTES = [
    ['Source Serif 4', 'normal', '200 900', 'source-serif-4-latin-standard-normal.woff2'],
    ['Source Serif 4', 'italic', '200 900', 'source-serif-4-latin-standard-italic.woff2'],
    ['Atkinson Hyperlegible', 'normal', '400', 'atkinson-hyperlegible-latin-400-normal.woff2'],
    ['Atkinson Hyperlegible', 'normal', '700', 'atkinson-hyperlegible-latin-700-normal.woff2'],
  ];
  let ocupado = false;

  const pedirJson = (url) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('No se pudo cargar tu libro. Intenta de nuevo.'))));
  const aBase64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

  async function cssDeFuentes() {
    const partes = await Promise.all(FUENTES.map(async ([familia, estilo, peso, archivo]) => {
      const r = await fetch('/fonts/files/' + archivo);
      if (!r.ok) return '';
      return `@font-face{font-family:"${familia}";font-style:${estilo};font-weight:${peso};font-display:swap;src:url(data:font/woff2;base64,${aBase64(await r.arrayBuffer())}) format("woff2")}`;
    }));
    return partes.join('\n');
  }

  // Foto -> JPEG reducido en base64 (las fotos originales pesan mucho para un archivo que se manda por WhatsApp).
  async function fotoReducida(url) {
    try {
      const r = await fetch('/api/media-file?u=' + encodeURIComponent(url), { credentials: 'same-origin' });
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob());
      const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(bmp.width * k)); lienzo.height = Math.max(1, Math.round(bmp.height * k));
      const cx = lienzo.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, lienzo.width, lienzo.height);
      cx.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
      if (bmp.close) bmp.close();
      return lienzo.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }

  // Audio original -> data URL. Los audios de una charla son livianos (unos 5 KB por segundo), pero se pone un tope
  // para que el archivo siga cabiendo en un correo o en WhatsApp.
  async function audioEnLinea(url) {
    try {
      const r = await fetch('/api/media-file?u=' + encodeURIComponent(url), { credentials: 'same-origin' });
      if (!r.ok) return { fallo: true };
      const blob = await r.blob();
      if (blob.size > AUDIO_UNO_MAX) return { grande: true, bytes: blob.size };
      const tipo = blob.type && blob.type.startsWith('audio') ? blob.type : (blob.type.startsWith('video') ? blob.type : 'audio/webm');
      const src = await new Promise((ok, mal) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = mal; f.readAsDataURL(new Blob([blob], { type: tipo })); });
      return { src, bytes: blob.size };
    } catch (e) { return { fallo: true }; }
  }

  // conAudios: false para el PDF (que no lleva audios): así no se bajan. soloEnlace: true para el enlace en línea, que no
  // necesita bajar ni reducir fotos y audios (solo sus direcciones).
  async function armarDatos({ conAudios = true, soloEnlace = false } = {}) {
    const [c, d, h] = await Promise.all([pedirJson('/api/chapters'), pedirJson('/api/book-editor/draft').catch(() => ({})), pedirJson('/api/story-log').catch(() => ({}))]);
    const capitulos = Array.isArray(c.chapters) ? c.chapters : [];
    const estado = (d && d.book) || {};
    const historias = Array.isArray(h.stories) ? h.stories : [];
    const ids = capitulos.map((x) => String(x.id));
    const orden = [...(Array.isArray(estado.order) ? estado.order.map(String).filter((x) => ids.includes(x)) : []), ...ids.filter((x) => !(estado.order || []).map(String).includes(x))];
    const ordenados = orden.map((id) => capitulos.find((x) => String(x.id) === id)).filter(Boolean);

    let fotosPedidas = 0, bytes = 0, bytesAudio = 0, audiosOmitidos = 0;
    const lista = [];
    for (const ch of ordenados) {
      const ed = (estado.edits && estado.edits[String(ch.id)]) || {};
      const incluidas = window.EcoLibroFotos ? window.EcoLibroFotos.incluidas(ch, estado, historias) : [];
      const fotos = [];
      for (const f of soloEnlace ? [] : incluidas.slice(0, MAX_FOTOS_POR_CAPITULO)) {
        if (fotosPedidas >= MAX_FOTOS || bytes >= BYTES_MAX) break;
        fotosPedidas++;
        const src = await fotoReducida(f.url);
        if (src) { bytes += src.length; fotos.push({ src, pie: f.caption || '' }); }
      }
      const audios = [];
      const urls = conAudios && Array.isArray(ch.audios) ? ch.audios : [];
      // Para el enlace para compartir: todas las fotos del libro y todos los audios (en el enlace no hay tope de peso).
      const enlace = {
        fotos: incluidas.slice(0, 12).map((f) => ({ url: f.url, pie: f.caption || '' })),
        audios: urls.slice(0, 40).map((u, k) => ({ url: u, pregunta: String((ch.preguntas && ch.preguntas[k]) || '').trim() })),
      };
      for (let k = 0; k < (soloEnlace ? 0 : urls.length); k++) {
        if (bytesAudio >= AUDIO_BYTES_MAX) { audiosOmitidos += urls.length - k; break; }
        const a = await audioEnLinea(urls[k]);
        if (a.src && bytesAudio + a.bytes <= AUDIO_BYTES_MAX) { bytesAudio += a.bytes; audios.push({ src: a.src, pregunta: String((ch.preguntas && ch.preguntas[k]) || '').trim() }); }
        else audiosOmitidos++;
      }
      lista.push({ id: ch.id, titulo: String(ed.title ?? ch.title ?? 'Capítulo').trim() || 'Capítulo', tema: String(ch.theme || '').trim(), texto: String(ed.text ?? ch.generated_text ?? ''), fotos, audios, enlace });
    }
    return {
      audiosOmitidos,
      titulo: String(estado.title || 'Mi historia familiar').trim(),
      subtitulo: String(estado.subtitle || '').trim(),
      dedicatoria: String(estado.dedication || '').trim(),
      fecha: new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }),
      capitulos: lista,
    };
  }

  // Lo que se manda al enlace para compartir: el texto y la dirección de cada foto y audio (no los archivos, que ya están guardados).
  function datosParaEnlace(datos) {
    return {
      titulo: datos.titulo, subtitulo: datos.subtitulo, dedicatoria: datos.dedicatoria, fecha: datos.fecha,
      capitulos: datos.capitulos.map((c) => ({ id: c.id, titulo: c.titulo, tema: c.tema, texto: c.texto, fotos: c.enlace.fotos, audios: c.enlace.audios })),
    };
  }
  // Deja listo (o actualiza) el enlace del libro. Si falla, la descarga ya se hizo igual.
  async function actualizarEnlace(datos) {
    try {
      const r = await fetch('/api/libro-compartido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ datos: datosParaEnlace(datos) }) });
      const d = await r.json().catch(() => ({}));
      return r.ok && d.url ? d.url : null;
    } catch (e) { return null; }
  }

  const nombreDeArchivo = (titulo) => (titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'mi-libro') + '-eco.html';

  async function exportar(opciones) {
    const boton = opciones && opciones.boton;
    const avisar = (opciones && opciones.aviso) || (() => {});
    if (ocupado) return;
    ocupado = true;
    const texto = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.textContent = 'Preparando tu libro…'; }
    avisar('');
    try {
      let hay = true;
      try { const r = await fetch('/api/chapters', { credentials: 'same-origin' }); if (r.ok) hay = ((await r.json()).chapters || []).length > 0; } catch (e) { /* sin conexión: se intenta igual */ }
      if (!hay) { avisar('Todavía no tienes capítulos. Genera tus capítulos primero y luego exporta tu libro.', true); return; }
      if (!(opciones && opciones.yaPagado) && window.EcoLibroCompra && !(await window.EcoLibroCompra.asegurar())) { avisar('Para exportar el libro primero hay que completar la compra de prueba.'); return; }
      if (!window.EcoLibroPagina) throw new Error('No se pudo preparar el libro. Recarga la página e intenta de nuevo.');
      avisar('Preparando tu libro: reduciendo las fotos y juntando los audios…');
      const [datos, fuentes, plantilla] = await Promise.all([
        armarDatos(), cssDeFuentes(),
        fetch('/libro-digital-plantilla.txt').then((r) => (r.ok ? r.text() : Promise.reject(new Error('No se pudo preparar el libro. Intenta de nuevo.')))),
      ]);
      const omitidos = datos.audiosOmitidos || 0;
      delete datos.audiosOmitidos;
      const html = window.EcoLibroPagina.armar({ plantilla, fuentes, datos });
      const archivo = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(archivo);
      const a = document.createElement('a');
      a.href = url; a.download = nombreDeArchivo(datos.titulo);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      avisar('Libro descargado (' + (archivo.size / 1048576).toFixed(1) + ' MB). Preparando tu enlace para compartir…');
      const enlace = await actualizarEnlace(datos);
      if (enlace && opciones && opciones.alEnlace) opciones.alEnlace(enlace);
      avisar('Listo: se descargó tu libro digital (' + (archivo.size / 1048576).toFixed(1) + ' MB).' + (omitidos ? ' ' + (omitidos === 1 ? 'Un audio pesaba demasiado y no se incluyó en el archivo.' : omitidos + ' audios pesaban demasiado y no se incluyeron en el archivo.') : '') + (enlace ? ' Tu enlace para compartir quedó actualizado: cualquiera que lo tenga puede ver el libro y oír los audios.' : ' No se pudo dejar listo el enlace para compartir; intenta de nuevo.'));
    } catch (e) {
      avisar(e.message || 'No se pudo preparar el libro digital.', true);
    } finally {
      ocupado = false;
      if (boton) { boton.disabled = false; boton.textContent = texto; }
    }
  }

  // Crea o actualiza el enlace en línea del libro, sin descargar el archivo. Devuelve la dirección o null.
  async function compartirEnLinea() {
    try { return await actualizarEnlace(await armarDatos({ soloEnlace: true })); } catch (e) { return null; }
  }

  window.EcoLibroDigital = { exportar, armarDatos, compartirEnLinea };

})();

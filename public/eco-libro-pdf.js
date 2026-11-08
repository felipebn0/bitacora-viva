/* ECO · PDF del libro. Arma el PDF (hoja A4) en el navegador y lo descarga de una, sin ventana de impresión: así funciona igual
   en el celular y en el computador. Usa PDFKit (public/vendor/pdfkit), que se carga solo cuando se pide el PDF. Lleva portada,
   dedicatoria, contenido con enlaces, cada capítulo en su página con sus fotos y su QR de voz, y número de página. */
(() => {
  'use strict';
  const ANCHO = 595.28, ALTO = 841.89;                        // A4 en puntos
  const MARGEN = { top: 56, bottom: 62, left: 56, right: 56 };
  const AREA = ANCHO - MARGEN.left - MARGEN.right;
  const COLOR = { musgo: '#4d6542', oscuro: '#293d30', tinta: '#302d25', suave: '#777568', linea: '#dadaca', dorado: '#b7791f' };
  // TTF (la librería del navegador no lee WOFF2): se generan con tools/generar-fuentes-pdf.py
  const FUENTES = {
    Serif: 'source-serif-4-400.ttf',
    SerifSemi: 'source-serif-4-600.ttf',
    SerifCursiva: 'source-serif-4-400-italic.ttf',
    Sans: 'atkinson-hyperlegible-400.ttf',
    SansNegrita: 'atkinson-hyperlegible-700.ttf',
  };
  let carga = null;

  function cargarLibreria() {
    if (window.PDFDocument) return Promise.resolve();
    if (!carga) carga = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = '/vendor/pdfkit/pdfkit.standalone.js?v=1';
      s.onload = () => (window.PDFDocument ? ok() : mal(new Error('No se pudo preparar el PDF.')));
      s.onerror = () => { carga = null; mal(new Error('No se pudo cargar el generador de PDF. Revisa tu conexión e intenta de nuevo.')); };
      document.head.appendChild(s);
    });
    return carga;
  }

  async function bytesDe(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('No se pudo cargar una tipografía del PDF.');
    return r.arrayBuffer();
  }

  // El QR llega como imagen SVG: se pasa a PNG para poder ponerlo en el PDF.
  async function qrComoPng(token) {
    try {
      const r = await fetch('/api/book-qr/image/' + encodeURIComponent(token) + '.svg', { credentials: 'same-origin' });
      if (!r.ok) return null;
      const url = URL.createObjectURL(new Blob([await r.text()], { type: 'image/svg+xml' }));
      const png = await new Promise((ok) => {
        const im = new Image();
        im.onload = () => {
          const c = document.createElement('canvas'); c.width = c.height = 360;
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 360, 360); x.drawImage(im, 0, 0, 360, 360);
          ok(c.toDataURL('image/png'));
        };
        im.onerror = () => ok(null);
        im.src = url;
      });
      URL.revokeObjectURL(url);
      return png;
    } catch (e) { return null; }
  }

  const dosDigitos = (n) => String(n).padStart(2, '0');
  const limpio = (t) => String(t == null ? '' : t).replace(/\r/g, '').replace(/[​-‍﻿]/g, '');

  // datos: { titulo, subtitulo, dedicatoria, capitulos: [{ id, titulo, texto, fotos: [{ src, pie }] }] }; qr: { [idCapitulo]: { token } }
  async function crear(crudos, qr = {}) {
    // Cuenta en inglés: textos del PDF en inglés y los títulos que quedaron por defecto en español, también.
    const EN = document.documentElement.lang === 'en';
    const T = (es, en) => (EN ? en : es);
    const DEF = { 'Mi historia familiar': 'My family story', 'Mi libro': 'My book', 'Recuerdos para las próximas generaciones': 'Memories for the generations to come', 'Capítulo': 'Chapter' };
    const d = (t) => (EN && DEF[t]) || t;
    const datos = { ...crudos, titulo: d(crudos.titulo), subtitulo: d(crudos.subtitulo), capitulos: (crudos.capitulos || []).map((c) => ({ ...c, titulo: d(c.titulo) })) };
    await cargarLibreria();
    const buffers = {};
    await Promise.all(Object.entries(FUENTES).map(async ([nombre, archivo]) => { buffers[nombre] = await bytesDe('/fonts/pdf/' + archivo); }));
    const qrPng = {};
    await Promise.all((datos.capitulos || []).map(async (c) => { const t = qr && qr[String(c.id)] && qr[String(c.id)].token; if (t && /^[a-f0-9]{48}$/.test(t)) qrPng[String(c.id)] = await qrComoPng(t); }));

    const doc = new window.PDFDocument({
      size: 'A4', margins: MARGEN, bufferPages: true, autoFirstPage: false,
      info: { Title: limpio(datos.titulo) || T('Mi libro', 'My book'), Author: 'Eco', Creator: 'Eco', Producer: 'Eco' },
    });
    Object.entries(buffers).forEach(([n, b]) => doc.registerFont(n, b));
    const partes = [];
    doc.on('data', (p) => partes.push(p));
    const terminado = new Promise((ok) => doc.on('end', ok));
    const fondoUtil = () => ALTO - MARGEN.bottom;
    const hayEspacio = (alto) => doc.y + alto <= fondoUtil();

    // — Portada
    doc.addPage();
    doc.lineWidth(9).strokeColor(COLOR.musgo).rect(22, 22, ANCHO - 44, ALTO - 44).stroke();
    doc.font('SansNegrita').fontSize(9).fillColor(COLOR.musgo).text(T('ECO · BITÁCORA VIVA', 'ECO · LIVING JOURNAL'), 90, 290, { width: ANCHO - 180, align: 'center', characterSpacing: 2.4 });
    doc.font('SerifSemi').fontSize(36).fillColor(COLOR.oscuro).text(limpio(datos.titulo) || T('Mi historia familiar', 'My family story'), 90, doc.y + 34, { width: ANCHO - 180, align: 'center', lineGap: 2 });
    if (limpio(datos.subtitulo).trim()) doc.font('Serif').fontSize(16).fillColor(COLOR.suave).text(limpio(datos.subtitulo), 90, doc.y + 14, { width: ANCHO - 180, align: 'center' });
    const yAdorno = Math.min(doc.y + 64, ALTO - 120);
    doc.strokeColor(COLOR.musgo).lineWidth(1.2).moveTo(ANCHO / 2 - 34, yAdorno).lineTo(ANCHO / 2 - 8, yAdorno).stroke().moveTo(ANCHO / 2 + 8, yAdorno).lineTo(ANCHO / 2 + 34, yAdorno).stroke();
    doc.circle(ANCHO / 2, yAdorno, 3.4).fill(COLOR.dorado);

    // — Dedicatoria (solo si la hay)
    if (limpio(datos.dedicatoria).trim()) {
      doc.addPage();
      doc.font('SansNegrita').fontSize(9).fillColor(COLOR.musgo).text(T('DEDICATORIA', 'DEDICATION'), MARGEN.left, 250, { width: AREA, align: 'center', characterSpacing: 2.2 });
      doc.font('SerifCursiva').fontSize(17).fillColor(COLOR.tinta).text(limpio(datos.dedicatoria), MARGEN.left + 30, doc.y + 24, { width: AREA - 60, align: 'center', lineGap: 5 });
    }

    // — Contenido, con enlaces a cada capítulo
    doc.addPage();
    doc.font('SerifSemi').fontSize(28).fillColor(COLOR.oscuro).text(T('Contenido', 'Contents'), MARGEN.left, MARGEN.top, { width: AREA });
    doc.moveDown(1.1);
    (datos.capitulos || []).forEach((c, i) => {
      if (!hayEspacio(34)) { doc.addPage(); doc.y = MARGEN.top; }
      const y = doc.y;
      doc.font('SansNegrita').fontSize(11).fillColor(COLOR.dorado).text(dosDigitos(i + 1), MARGEN.left, y + 3, { width: 30, lineBreak: false });
      doc.font('Serif').fontSize(13.5).fillColor(COLOR.tinta).text(limpio(c.titulo) || T('Capítulo', 'Chapter'), MARGEN.left + 34, y, { width: AREA - 34, lineGap: 2 });
      const fin = doc.y + 7;
      doc.strokeColor(COLOR.linea).lineWidth(0.8).moveTo(MARGEN.left, fin).lineTo(ANCHO - MARGEN.right, fin).stroke();
      doc.goTo(MARGEN.left, y - 4, AREA, fin - y + 6, 'cap-' + (i + 1));
      doc.y = fin + 9;
    });
    if (!(datos.capitulos || []).length) doc.font('Serif').fontSize(13).fillColor(COLOR.suave).text(T('Los capítulos aparecerán aquí cuando los generes.', 'Chapters will appear here once you generate them.'), MARGEN.left, doc.y, { width: AREA });

    // — Capítulos
    (datos.capitulos || []).forEach((c, i) => {
      doc.addPage();
      doc.addNamedDestination('cap-' + (i + 1));
      doc.font('SansNegrita').fontSize(8.5).fillColor(COLOR.musgo).text(T('CAPÍTULO ', 'CHAPTER ') + dosDigitos(i + 1), MARGEN.left, MARGEN.top, { width: AREA, characterSpacing: 1.8 });
      doc.moveDown(0.5);
      doc.font('SerifSemi').fontSize(25).fillColor(COLOR.oscuro).text(limpio(c.titulo) || T('Capítulo', 'Chapter'), MARGEN.left, doc.y, { width: AREA, lineGap: 2 });
      doc.moveDown(1.1);

      const pars = limpio(c.texto).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
      const fotos = (c.fotos || []).filter((f) => f && f.src);
      const antes = new Map();
      fotos.forEach((f, k) => { const j = pars.length ? Math.min(pars.length - 1, Math.round((k * pars.length) / fotos.length)) : 0; if (!antes.has(j)) antes.set(j, []); antes.get(j).push(f); });
      const poner = (f) => {
        let img;
        try { img = doc.openImage(f.src); } catch (e) { return; }
        const w = Math.min(AREA * 0.62, img.width), h0 = (img.height / img.width) * w, h = Math.min(h0, 300), w2 = (h / h0) * w;
        const pie = limpio(f.pie).trim();
        const total = h + (pie ? 26 : 12);
        if (!hayEspacio(total)) { doc.addPage(); doc.y = MARGEN.top; }
        const x = MARGEN.left + (AREA - w2) / 2;
        doc.image(f.src, x, doc.y + 4, { width: w2, height: h });
        doc.y += h + 10;
        if (pie) doc.font('SerifCursiva').fontSize(9.5).fillColor(COLOR.suave).text(pie, MARGEN.left + 40, doc.y, { width: AREA - 80, align: 'center' });
        doc.moveDown(0.8);
      };
      pars.forEach((p, j) => {
        (antes.get(j) || []).forEach(poner);
        doc.font('Serif').fontSize(11.5).fillColor(COLOR.tinta).text(p, MARGEN.left, doc.y, { width: AREA, align: 'justify', lineGap: 4.4, paragraphGap: 9 });
      });
      if (!pars.length) fotos.forEach(poner);

      const png = qrPng[String(c.id)];
      if (png) {
        if (!hayEspacio(104)) { doc.addPage(); doc.y = MARGEN.top; }
        doc.moveDown(0.6);
        const y = doc.y + 6;
        doc.strokeColor(COLOR.linea).lineWidth(0.8).moveTo(MARGEN.left, y - 6).lineTo(ANCHO - MARGEN.right, y - 6).stroke();
        doc.image(png, MARGEN.left, y + 4, { width: 88, height: 88 });
        doc.font('SansNegrita').fontSize(11).fillColor(COLOR.oscuro).text(T('Escucha la voz original', 'Listen to the original voice'), MARGEN.left + 104, y + 26, { width: AREA - 104 });
        doc.font('Sans').fontSize(9.5).fillColor(COLOR.suave).text(T('Escanea con tu teléfono para escuchar la grabación.', 'Scan with your phone to listen to the recording.'), MARGEN.left + 104, doc.y + 3, { width: AREA - 104 });
      }
    });

    // — Número de página (menos en la portada)
    const rango = doc.bufferedPageRange();
    for (let n = 1; n < rango.count; n++) {
      doc.switchToPage(rango.start + n);
      doc.page.margins.bottom = 0;
      doc.font('Sans').fontSize(9).fillColor(COLOR.suave).text(String(n + 1), 0, ALTO - 40, { width: ANCHO, align: 'center', lineBreak: false });
    }
    doc.end();
    await terminado;
    return new Blob(partes, { type: 'application/pdf' });
  }

  const nombreDeArchivo = (titulo) => (String(titulo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'mi-libro') + '-eco.pdf';

  async function descargar(datos, qr) {
    const pdf = await crear(datos, qr);
    const url = URL.createObjectURL(pdf);
    const a = document.createElement('a');
    a.href = url; a.download = nombreDeArchivo(datos.titulo);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { bytes: pdf.size, nombre: a.download };
  }

  window.EcoLibroPdf = { crear, descargar };
})();

/* ECO · Página del libro digital. Arma el HTML final del libro a partir de public/libro-digital-plantilla.txt y los datos del
   libro. Lo usan dos lados con el mismo código: el navegador (el archivo que se descarga, con fotos y audios dentro) y el
   servidor (la página con enlace para compartir, con fotos y audios que se piden aparte). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.EcoLibroPagina = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // A cada foto y audio se le pone un número (ref). La página de lectura los tiene UNA sola vez y los datos de la estantería
  // solo apuntan a ese número, para no repetir lo pesado.
  function numerar(datos) {
    return {
      ...datos,
      capitulos: datos.capitulos.map((c, i) => ({
        ...c,
        fotos: (c.fotos || []).map((f, k) => ({ ...f, ref: 'f-' + i + '-' + k })),
        audios: (c.audios || []).map((a, k) => ({ ...a, ref: 'a-' + i + '-' + k })),
      })),
    };
  }
  const sinPeso = (datos) => ({
    titulo: datos.titulo, subtitulo: datos.subtitulo, dedicatoria: datos.dedicatoria, fecha: datos.fecha, idioma: datos.idioma === 'en' ? 'en' : 'es',
    capitulos: datos.capitulos.map((c) => ({
      id: c.id, titulo: c.titulo, tema: c.tema, texto: c.texto,
      fotos: c.fotos.map((f) => ({ ref: f.ref, pie: f.pie })),
      audios: c.audios.map((a) => ({ ref: a.ref, pregunta: a.pregunta })),
    })),
  });

  // Versión de lectura: el libro como página simple (portada, contenido con enlaces y cada capítulo en su tarjeta). Es lo que
  // se ve donde no corre JavaScript, como la vista previa de Archivos del iPhone; con JavaScript se esconde y su contenido
  // pasa a la estantería. "ligero": las fotos no se cargan hasta que se necesitan y los audios no se piden hasta darles play.
  function versionDeLectura(datos, ligero) {
    const T = (es, en) => (datos.idioma === 'en' ? en : es);
    const p = [];
    p.push('<main class="plano"><header class="plano-portada"><p class="plano-marca">ECO</p><h1>' + esc(datos.titulo) + '</h1><p class="sub">' + esc(datos.subtitulo || T('Una historia contada con Eco', 'A story told with Eco')) + '</p>');
    if (datos.dedicatoria) p.push('<p class="dedic">' + esc(datos.dedicatoria) + '</p>');
    p.push('</header>');
    if (datos.capitulos.length) {
      p.push('<nav class="plano-indice" id="contenido-lectura" aria-label="' + T('Contenido', 'Contents') + '"><h2>' + T('Contenido', 'Contents') + '</h2><ol>');
      datos.capitulos.forEach((c, i) => p.push('<li><a href="#cap-' + (i + 1) + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(c.titulo) + '</span></a></li>'));
      p.push('</ol></nav>');
    }
    datos.capitulos.forEach((c, i) => {
      p.push('<section class="plano-cap" id="cap-' + (i + 1) + '"><p class="n">' + T('CAPÍTULO ', 'CHAPTER ') + (i + 1) + '</p><h2>' + esc(c.titulo) + '</h2>' + (c.tema ? '<p class="tema">' + esc(c.tema) + '</p>' : ''));
      const pars = String(c.texto || '').split(/\n\s*\n/).filter((x) => x.trim());
      const fotos = c.fotos || [];
      const antes = new Map();
      fotos.forEach((f, k) => { const j = pars.length ? Math.min(pars.length - 1, Math.round((k * pars.length) / fotos.length)) : 0; if (!antes.has(j)) antes.set(j, []); antes.get(j).push(f); });
      const figura = (f) => '<figure><img id="' + f.ref + '"' + (ligero ? ' loading="lazy"' : '') + ' src="' + esc(f.src) + '" alt="' + esc(f.pie || T('Foto familiar', 'Family photo')) + '">' + (f.pie ? '<figcaption>' + esc(f.pie) + '</figcaption>' : '') + '</figure>';
      pars.forEach((t, j) => { (antes.get(j) || []).forEach((f) => p.push(figura(f))); p.push('<p>' + esc(t.trim()) + '</p>'); });
      if (!pars.length) fotos.forEach((f) => p.push(figura(f)));
      const audios = c.audios || [];
      if (audios.length) p.push('<h3 class="tema">' + (audios.length === 1 ? T('Escucha la historia original', 'Listen to the original story') : T('Escucha las historias originales', 'Listen to the original stories')) + '</h3>');
      audios.forEach((a) => { if (a.pregunta) p.push('<p class="pregunta">' + esc(a.pregunta) + '</p>'); p.push('<audio id="' + a.ref + '" controls preload="' + (ligero ? 'none' : 'metadata') + '" src="' + esc(a.src) + '"></audio>'); });
      p.push('<a class="subir" href="#contenido-lectura">↑ ' + T('Volver al contenido', 'Back to contents') + '</a></section>');
    });
    p.push('<p class="aviso">' + T('Para recorrer tu libro como una estantería, ábrelo en un navegador (Safari o Chrome). En la vista previa de Archivos del iPhone se ve así, como un texto para leer.', 'To browse your book as a bookshelf, open it in a browser (Safari or Chrome). In the iPhone Files preview it looks like this, as text to read.') + '</p></main>');
    return p.join('');
  }

  // plantilla: el texto de libro-digital-plantilla.txt. fuentes: CSS de @font-face. datos: el libro con sus fotos y audios
  // (cada uno con su dirección en "src"). enlace: true para la página compartida (sin buscadores, con vista previa al compartir).
  // Libro de una cuenta en inglés: los títulos que quedaron con el valor por defecto en español se pasan a inglés.
  const POR_DEFECTO_EN = { 'Mi historia familiar': 'My family story', 'Mi libro': 'My book', 'Recuerdos para las próximas generaciones': 'Memories for the generations to come', 'Capítulo': 'Chapter' };
  function enIdioma(datos) {
    if (datos.idioma !== 'en') return datos;
    const d = (t) => POR_DEFECTO_EN[t] || t;
    return { ...datos, titulo: d(datos.titulo), subtitulo: d(datos.subtitulo), capitulos: datos.capitulos.map((c) => ({ ...c, titulo: d(c.titulo) })) };
  }

  function armar({ plantilla, fuentes, datos: crudos, enlace = false }) {
    const datos = enIdioma(crudos);
    const numerados = numerar(datos);
    const json = JSON.stringify(sinPeso(numerados)).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ');
    let html = plantilla
      .replace('<!--__ESTATICO__-->', () => versionDeLectura(numerados, enlace))
      .replace('/*__FUENTES__*/', () => fuentes)
      .replace(/(<script type="application\/json" id="datos">)[\s\S]*?(<\/script>)/, (m, a, b) => a + json + b);
    if (datos.idioma === 'en') html = html.replace(/<html lang="es"/, '<html lang="en"');
    if (enlace) {
      const titulo = esc(datos.titulo || (datos.idioma === 'en' ? 'My book' : 'Mi libro'));
      html = html
        .replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + titulo + ' · Eco</title>')
        .replace('</head>', () => '<meta name="robots" content="noindex, nofollow">\n<meta property="og:title" content="' + titulo + '">\n<meta property="og:description" content="' + (datos.idioma === 'en' ? 'A book of memories made with Eco. Open it to read it and listen to the original stories.' : 'Un libro de recuerdos hecho con Eco. Ábrelo para leerlo y escuchar las historias originales.') + '">\n<meta property="og:type" content="book">\n</head>');
    }
    return html;
  }

  return { armar, esc };
});

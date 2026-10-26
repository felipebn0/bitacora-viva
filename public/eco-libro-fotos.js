/* ECO · Fotos del libro, una sola manera de colocarlas: la primera arriba a la derecha dentro del
   texto (el texto la rodea) y, si hay más, repartidas a lo largo del capítulo. Lo usan el estudio
   "Diseñar mi libro", la vista del libro y "Leer capítulo", para que se vean igual en los tres. */
(() => {
  'use strict';
  const https = (u) => typeof u === 'string' && /^https:\/\//i.test(u);

  // Todas las fotos que puede llevar un capítulo: las de sus historias originales y las subidas al libro.
  function opciones(capitulo, estado, historias) {
    const ids = new Set((capitulo.story_ids || []).map(String));
    const vistas = new Set();
    const lista = [];
    for (const h of historias || []) {
      if (!ids.has(String(h.id))) continue;
      for (const m of Array.isArray(h.media_urls) ? h.media_urls : []) {
        if (!m || m.type === 'video' || !https(m.url) || vistas.has(m.url)) continue;
        vistas.add(m.url);
        lista.push({ url: m.url, caption: String(m.caption || '').slice(0, 180) });
      }
    }
    for (const p of (estado && estado.bookPhotos && estado.bookPhotos[String(capitulo.id)]) || []) {
      if (p && https(p.url) && !vistas.has(p.url)) { vistas.add(p.url); lista.push({ url: p.url, caption: p.caption || '', uploaded: true }); }
    }
    return lista;
  }

  // Las que van en el libro (todas menos las que se quitaron), con su pie de foto ya editado.
  function incluidas(capitulo, estado, historias) {
    const elegido = (estado && estado.media && estado.media[String(capitulo.id)]) || {};
    return opciones(capitulo, estado, historias)
      .filter((p) => !elegido[p.url] || elegido[p.url].pos !== 'hide')
      .map((p) => ({ url: p.url, caption: elegido[p.url] && elegido[p.url].caption != null ? elegido[p.url].caption : p.caption }));
  }

  function figura(foto) {
    const fig = document.createElement('figure');
    fig.className = 'eco-foto-flota';
    const img = document.createElement('img');
    img.src = '/api/media-file?u=' + encodeURIComponent(foto.url);
    img.alt = foto.caption || 'Foto familiar';
    img.loading = 'lazy';
    img.decoding = 'async';
    fig.appendChild(img);
    if (foto.caption) {
      const cap = document.createElement('figcaption');
      cap.textContent = foto.caption;
      fig.appendChild(cap);
    }
    return fig;
  }

  // Pone en el contenedor los párrafos del capítulo con sus fotos. La primera foto va antes del primer
  // párrafo (arriba a la derecha); las demás se reparten en partes iguales.
  function armarTexto(contenedor, texto, fotos, clasePar) {
    const parrafos = String(texto || '').split(/\n\s*\n/).filter((p) => p.trim());
    const antes = new Map();
    fotos.forEach((f, k) => {
      const i = parrafos.length ? Math.min(parrafos.length - 1, Math.round((k * parrafos.length) / fotos.length)) : 0;
      if (!antes.has(i)) antes.set(i, []);
      antes.get(i).push(f);
    });
    parrafos.forEach((t, i) => {
      (antes.get(i) || []).forEach((f) => contenedor.appendChild(figura(f)));
      const p = document.createElement('p');
      p.className = clasePar;
      p.textContent = t;
      contenedor.appendChild(p);
    });
    if (!parrafos.length) fotos.forEach((f) => contenedor.appendChild(figura(f)));
    const fin = document.createElement('div');
    fin.className = 'eco-foto-fin';
    contenedor.appendChild(fin);
  }

  window.EcoLibroFotos = { opciones, incluidas, armarTexto };
})();

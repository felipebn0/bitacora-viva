/* ECO · Idioma ES / EN.
   El español es el texto original de cada página. Con la bandera en inglés,
   cada texto (y los atributos alt, aria-label, placeholder, title) que aparezca
   como clave en window.ECO_EN se cambia por su traducción. Al volver a español
   se restaura el original. Sin voces nuevas: las voces de ElevenLabs siguen en inglés. */
(() => {
  'use strict';
  // En el landing el idioma lo elige la bandera. Dentro de la bitácora lo manda
  // la cuenta (se eligió al crearla) y no hay botón para cambiarlo: esas páginas
  // llevan data-idioma-cuenta en <html>.
  const POR_CUENTA = document.documentElement.hasAttribute('data-idioma-cuenta');
  const CLAVE = POR_CUENTA ? 'eco-idioma-cuenta' : 'eco-idioma';
  // data-ph: el texto guía de los campos editables del libro (se muestra con CSS content: attr(data-ph)).
  const ATRIBUTOS = ['alt', 'aria-label', 'placeholder', 'title', 'data-ph'];
  // characterData: hay textos (el saludo de la pantalla principal, los contadores)
  // que cambian el contenido de un nodo que ya existe, sin agregar nodos nuevos.
  // attributes: el aria-label/placeholder que la app cambia después de cargar
  // (p. ej. el del círculo según el estado de la charla) también se traduce.
  const OBSERVAR = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS };
  const OMITIR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const origenTexto = new WeakMap();
  const origenAtributo = new WeakMap();
  const origenHtml = new WeakMap();
  let idioma = 'es';
  let observador = null;

  function leer() { try { return localStorage.getItem(CLAVE) === 'en' ? 'en' : 'es'; } catch (e) { return 'es'; } }
  function guardar(v) { try { localStorage.setItem(CLAVE, v); } catch (e) { /* sin almacenamiento: solo esta vista */ } }
  function dic() { return (window.ECO_EN && typeof window.ECO_EN === 'object') ? window.ECO_EN : {}; }

  // Frases armadas con un nombre o un número en medio: la clave lleva {} donde va
  // el pedazo variable. Se usan solo cuando no hay traducción exacta.
  let patronesCompilados = null;
  function patrones() {
    if (patronesCompilados) return patronesCompilados;
    const crudos = (window.ECO_EN_PATRONES && typeof window.ECO_EN_PATRONES === 'object') ? window.ECO_EN_PATRONES : {};
    patronesCompilados = Object.keys(crudos).map((clave) => ({
      re: new RegExp('^' + clave.split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)') + '$'),
      en: crudos[clave]
    }));
    return patronesCompilados;
  }

  function traducir(clave) {
    const exacta = dic()[clave];
    if (exacta) return exacta;
    for (const p of patrones()) {
      const m = clave.match(p.re);
      if (!m) continue;
      let i = 1;
      // Lo que cae en el hueco suele ser un nombre propio, que se deja igual,
      // pero a veces es una palabra nuestra ("Yo"): esa sí se traduce.
      return p.en.replace(/\{\}/g, () => {
        const pedazo = m[i++];
        if (pedazo === undefined) return '';
        return dic()[norm(pedazo)] || pedazo;
      });
    }
    return null;
  }

  function esInteractivo(el) {
    return !!el.querySelector('button,input,select,textarea,a[href],[tabindex],[onclick]');
  }

  function traducirNodo(nodo) {
    if (nodo.nodeType === 3) {
      const texto = nodo.nodeValue;
      const clave = norm(texto);
      if (!clave) return;
      if (idioma === 'en') {
        const en = traducir(clave);
        if (en && !origenTexto.has(nodo)) origenTexto.set(nodo, texto);
        if (en) nodo.nodeValue = texto.replace(clave, en);
      } else if (origenTexto.has(nodo)) {
        nodo.nodeValue = origenTexto.get(nodo);
      }
      return;
    }
    if (nodo.nodeType !== 1) return;
    // Del cuadro de texto no se toca lo que escribió la persona, pero sí su placeholder.
    if (OMITIR.has(nodo.tagName) && nodo.tagName !== 'TEXTAREA') return;
    if (nodo.hasAttribute('data-no-idioma')) return;
    for (const attr of ATRIBUTOS) {
      if (!nodo.hasAttribute(attr)) continue;
      const valor = nodo.getAttribute(attr);
      const clave = norm(valor);
      if (idioma === 'en') {
        const en = traducir(clave);
        if (en) {
          if (!origenAtributo.has(nodo)) origenAtributo.set(nodo, {});
          const o = origenAtributo.get(nodo);
          if (!(attr in o)) o[attr] = valor;
          nodo.setAttribute(attr, en);
        }
      } else if (origenAtributo.has(nodo) && attr in origenAtributo.get(nodo)) {
        nodo.setAttribute(attr, origenAtributo.get(nodo)[attr]);
      }
    }
    if (nodo.tagName === 'TEXTAREA') return;
    // Elemento completo (p. ej. un titular con <em>) solo si no tiene controles dentro.
    if (!esInteractivo(nodo) && nodo.children.length) {
      const claveHtml = norm(nodo.innerHTML);
      if (idioma === 'en') {
        const en = traducir(claveHtml);
        if (en) {
          if (!origenHtml.has(nodo)) origenHtml.set(nodo, nodo.innerHTML);
          nodo.innerHTML = en;
          return;
        }
      } else if (origenHtml.has(nodo)) {
        nodo.innerHTML = origenHtml.get(nodo);
        return;
      }
    }
    for (const hijo of Array.from(nodo.childNodes)) traducirNodo(hijo);
  }

  // Un atributo que la app acaba de cambiar: el valor nuevo pasa a ser el original.
  function traducirAtributo(el, attr) {
    if (idioma !== 'en' || !el.hasAttribute(attr) || el.closest('[data-no-idioma]')) return;
    const valor = el.getAttribute(attr);
    const en = traducir(norm(valor));
    if (!en) return;
    if (!origenAtributo.has(el)) origenAtributo.set(el, {});
    origenAtributo.get(el)[attr] = valor;
    el.setAttribute(attr, en);
  }

  function aplicar(raiz) {
    if (observador) observador.disconnect();
    traducirNodo(raiz);
    if (observador) observador.observe(document.body, OBSERVAR);
  }

  function marcarIdioma() {
    document.documentElement.lang = idioma;
    // La bandera solo vive en el landing: se borra la cookie vieja que usaba la IA.
    try { document.cookie = "eco_idioma=; path=/; max-age=0"; } catch (e) { /* sin cookies */ }
    const titulo = document.title;
    if (!document.documentElement.hasAttribute('data-es-titulo')) document.documentElement.setAttribute('data-es-titulo', titulo);
    const t = idioma === 'en' ? (dic()[norm(document.documentElement.getAttribute('data-es-titulo'))] || document.documentElement.getAttribute('data-es-titulo')) : document.documentElement.getAttribute('data-es-titulo');
    document.title = t;
    const boton = document.getElementById('ecoIdiomaBtn');
    if (boton) {
      boton.textContent = idioma === 'en' ? '🇪🇸 ESP' : '🇬🇧 ENG';
      boton.setAttribute('aria-label', idioma === 'en' ? 'Switch to Spanish' : 'Cambiar a inglés');
      boton.title = idioma === 'en' ? 'Switch to Spanish' : 'Cambiar a inglés';
    }
    // "Crear cuenta": si la página está en inglés, el idioma de la bitácora arranca
    // en inglés. Si la persona ya lo cambió a mano, no se le toca.
    const campoIdioma = document.getElementById('suIdioma');
    if (campoIdioma && !campoIdioma.dataset.elegido) campoIdioma.value = idioma;
  }

  function cambiar(nuevo) {
    idioma = nuevo;
    guardar(nuevo);
    marcarIdioma();
    aplicar(document.body);
  }

  // Los avisos del navegador (confirm, alert, prompt) no pasan por el DOM: el
  // observador no los ve, así que se traduce el mensaje antes de mostrarlo.
  // Se intenta con el mensaje completo y, si no está, párrafo por párrafo.
  function traducirMensaje(mensaje) {
    const texto = String(mensaje == null ? '' : mensaje);
    if (idioma !== 'en' || !texto.trim()) return mensaje;
    const entera = traducir(norm(texto));
    if (entera) return entera;
    const partes = texto.split(/(\n+)/);
    let hubo = false;
    const traducidas = partes.map((p) => {
      if (/^\n+$/.test(p) || !p.trim()) return p;
      const en = traducir(norm(p));
      if (en) hubo = true;
      return en || p;
    });
    return hubo ? traducidas.join('') : mensaje;
  }

  function envolverAvisos() {
    for (const nombre of ['confirm', 'alert', 'prompt']) {
      const original = window[nombre];
      if (typeof original !== 'function' || original.ecoIdioma) continue;
      const envuelto = function (mensaje, ...resto) {
        return original.call(window, traducirMensaje(mensaje), ...resto);
      };
      envuelto.ecoIdioma = true;
      try { window[nombre] = envuelto; } catch (e) { /* navegador que no deja reemplazarlo */ }
    }
  }

  // El idioma guardado en la cuenta manda sobre la copia local.
  function consultarCuenta() {
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((datos) => {
        if (!datos) return;
        const deLaCuenta = datos.idioma === 'en' ? 'en' : 'es';
        if (deLaCuenta !== idioma) cambiar(deLaCuenta);
        else guardar(deLaCuenta);
      })
      .catch(() => { /* sin red: queda el último idioma conocido */ });
  }

  function crearBoton() {
    if (POR_CUENTA || document.getElementById('ecoIdiomaBtn')) return;
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.id = 'ecoIdiomaBtn';
    boton.className = 'eco-idioma-btn';
    boton.addEventListener('click', () => cambiar(idioma === 'en' ? 'es' : 'en'));
    document.body.prepend(boton);
  }

  function iniciar() {
    idioma = leer();
    crearBoton();
    const campoIdioma = document.getElementById('suIdioma');
    if (campoIdioma) campoIdioma.addEventListener('change', () => { campoIdioma.dataset.elegido = '1'; });
    marcarIdioma();
    envolverAvisos();
    observador = new MutationObserver((muts) => {
      observador.disconnect();
      for (const m of muts) {
        if (m.type === 'characterData') traducirNodo(m.target);
        else if (m.type === 'attributes') traducirAtributo(m.target, m.attributeName);
        else for (const n of m.addedNodes) traducirNodo(n);
      }
      observador.observe(document.body, OBSERVAR);
    });
    if (idioma === 'en') aplicar(document.body);
    else observador.observe(document.body, OBSERVAR);
    if (POR_CUENTA) consultarCuenta();
  }

  window.EcoIdioma = { cambiar, actual: () => idioma };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

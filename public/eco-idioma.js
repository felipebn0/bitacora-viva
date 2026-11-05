/* ECO · Idioma ES / EN.
   El español es el texto original de cada página. Con la bandera en inglés,
   cada texto (y los atributos alt, aria-label, placeholder, title) que aparezca
   como clave en window.ECO_EN se cambia por su traducción. Al volver a español
   se restaura el original. Sin voces nuevas: las voces de ElevenLabs siguen en inglés. */
(() => {
  'use strict';
  const CLAVE = 'eco-idioma';
  const ATRIBUTOS = ['alt', 'aria-label', 'placeholder', 'title'];
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

  function esInteractivo(el) {
    return !!el.querySelector('button,input,select,textarea,a[href],[tabindex],[onclick]');
  }

  function traducirNodo(nodo) {
    if (nodo.nodeType === 3) {
      const texto = nodo.nodeValue;
      const clave = norm(texto);
      if (!clave) return;
      if (idioma === 'en') {
        const en = dic()[clave];
        if (en && !origenTexto.has(nodo)) origenTexto.set(nodo, texto);
        if (en) nodo.nodeValue = texto.replace(clave, en);
      } else if (origenTexto.has(nodo)) {
        nodo.nodeValue = origenTexto.get(nodo);
      }
      return;
    }
    if (nodo.nodeType !== 1 || OMITIR.has(nodo.tagName)) return;
    if (nodo.hasAttribute('data-no-idioma')) return;
    for (const attr of ATRIBUTOS) {
      if (!nodo.hasAttribute(attr)) continue;
      const valor = nodo.getAttribute(attr);
      const clave = norm(valor);
      if (idioma === 'en') {
        const en = dic()[clave];
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
    // Elemento completo (p. ej. un titular con <em>) solo si no tiene controles dentro.
    if (!esInteractivo(nodo) && nodo.children.length) {
      const claveHtml = norm(nodo.innerHTML);
      if (idioma === 'en') {
        const en = dic()[claveHtml];
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

  function aplicar(raiz) {
    if (observador) observador.disconnect();
    traducirNodo(raiz);
    if (observador) observador.observe(document.body, { childList: true, subtree: true });
  }

  function marcarIdioma() {
    document.documentElement.lang = idioma;
    // Cookie para que el servidor escriba resúmenes y capítulos en el mismo idioma.
    try { document.cookie = "eco_idioma=" + idioma + "; path=/; max-age=31536000; SameSite=Lax"; } catch (e) { /* sin cookies */ }
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
  }

  function cambiar(nuevo) {
    idioma = nuevo;
    guardar(nuevo);
    marcarIdioma();
    aplicar(document.body);
  }

  function crearBoton() {
    if (document.getElementById('ecoIdiomaBtn')) return;
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
    marcarIdioma();
    observador = new MutationObserver((muts) => {
      observador.disconnect();
      for (const m of muts) for (const n of m.addedNodes) traducirNodo(n);
      observador.observe(document.body, { childList: true, subtree: true });
    });
    if (idioma === 'en') aplicar(document.body);
    else observador.observe(document.body, { childList: true, subtree: true });
  }

  window.EcoIdioma = { cambiar, actual: () => idioma };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

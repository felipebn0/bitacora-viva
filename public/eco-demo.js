(() => {
  'use strict';
  const seccion = document.getElementById('demo');
  const caja = document.getElementById('demoCaja');
  if (!seccion || !caja) return;
  const chat = document.getElementById('demoChat');
  const accion = document.getElementById('demoAccion');
  const barras = Array.prototype.slice.call(caja.querySelectorAll('.demo-eco__progreso li'));
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEGUNDOS = 20;
  let timers = [];
  let nombre = '';

  function esperar(ms, fn) { timers.push(window.setTimeout(fn, ms)); }
  function limpiar() { timers.forEach(window.clearTimeout); timers.forEach(window.clearInterval); timers = []; }

  function el(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function progreso(n) { barras.forEach((b, i) => b.classList.toggle('is-on', i < n)); }

  function enfasis(on) {
    seccion.classList.toggle('is-enfasis', on);
    chat.classList.toggle('is-atenuado', on && chat.children.length > 0);
  }

  function escribir(nodo, texto, listo) {
    if (reducir) { nodo.textContent = texto; if (listo) listo(); return; }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      nodo.textContent = texto.slice(0, i);
      if (i >= texto.length) { window.clearInterval(id); if (listo) listo(); }
    }, 26);
    timers.push(id);
  }

  function burbuja(quien, texto, listo) {
    const b = el('div', 'demo-eco__burbuja demo-eco__burbuja--' + quien);
    chat.appendChild(b);
    if (quien === 'eco') escribir(b, texto, listo);
    else { b.textContent = texto; if (listo) listo(); }
    return b;
  }

  function boton(texto, clase, alClic) {
    const b = el('button', 'btn ' + clase, texto);
    b.type = 'button';
    b.addEventListener('click', alClic);
    return b;
  }

  function vaciarAccion() { accion.textContent = ''; }

  function inicio() {
    limpiar();
    nombre = '';
    chat.textContent = '';
    enfasis(false);
    progreso(0);
    vaciarAccion();
    const fila = el('div', 'demo-eco__fila');
    fila.appendChild(boton('Empezar la demo', 'btn-primary', bienvenida));
    accion.appendChild(fila);
    accion.appendChild(el('p', 'demo-eco__nota', 'Dura cerca de un minuto. Es un ejemplo: no graba tu voz ni guarda nada.'));
  }

  function bienvenida() {
    vaciarAccion();
    progreso(1);
    if (!reducir) caja.scrollIntoView({ block: 'center', behavior: 'smooth' });
    burbuja('eco', 'Hola, soy Eco. Qué bueno que estés aquí.', () => {
      esperar(900, () => burbuja('eco', 'Antes de empezar, ¿cómo te llamas?', pedirNombre));
    });
  }

  function pedirNombre() {
    progreso(2);
    vaciarAccion();
    const form = el('form', 'demo-eco__accion');
    form.noValidate = true;
    const etiqueta = el('label', null, 'Tu nombre');
    etiqueta.htmlFor = 'demoNombre';
    const campo = el('input');
    campo.id = 'demoNombre';
    campo.type = 'text';
    campo.maxLength = 30;
    campo.autocomplete = 'given-name';
    campo.placeholder = 'Escribe tu nombre';
    const fila = el('div', 'demo-eco__fila');
    const seguir = el('button', 'btn btn-primary', 'Continuar');
    seguir.type = 'submit';
    fila.appendChild(seguir);
    fila.appendChild(boton('Seguir sin nombre', 'btn-secondary', () => saludo('')));
    form.appendChild(etiqueta);
    form.appendChild(campo);
    form.appendChild(fila);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saludo(campo.value.trim().slice(0, 30));
    });
    accion.appendChild(form);
    campo.focus({ preventScroll: true });
  }

  function saludo(n) {
    nombre = n;
    vaciarAccion();
    if (nombre) burbuja('tu', nombre);
    esperar(500, () => {
      burbuja('eco', nombre ? 'Mucho gusto, ' + nombre + '.' : 'Mucho gusto.', () => esperar(1100, pregunta));
    });
  }

  function pregunta() {
    progreso(3);
    enfasis(true);
    const bloque = el('div', 'demo-eco__pregunta');
    bloque.appendChild(el('small', null, 'Eco te pregunta'));
    const p = el('p');
    bloque.appendChild(p);
    chat.appendChild(bloque);
    const texto = (nombre ? nombre + ', ¿' : '¿') + 'qué historia de tu familia no quisieras que se perdiera?';
    escribir(p, texto, mostrarRespuesta);
  }

  function mostrarRespuesta() {
    vaciarAccion();
    const reloj = el('div', 'demo-eco__reloj');
    reloj.setAttribute('aria-hidden', 'true');
    reloj.innerHTML = '<svg viewBox="0 0 100 100"><circle class="pista" cx="50" cy="50" r="46"/><circle class="avance" cx="50" cy="50" r="46"/></svg>';
    const num = el('b', null, String(SEGUNDOS));
    reloj.appendChild(num);
    const etiqueta = el('label', null, 'Cuéntame con tus palabras (opcional)');
    etiqueta.htmlFor = 'demoRespuesta';
    const campo = el('textarea');
    campo.id = 'demoRespuesta';
    campo.maxLength = 280;
    campo.placeholder = 'Puedes escribir aquí. Se queda en tu pantalla.';
    const fila = el('div', 'demo-eco__fila');
    let listo = false;
    const terminar = () => {
      if (listo) return;
      listo = true;
      limpiar();
      seguimiento(campo.value.trim());
    };
    fila.appendChild(boton('Listo, ya respondí', 'btn-primary', terminar));
    accion.appendChild(reloj);
    accion.appendChild(etiqueta);
    accion.appendChild(campo);
    accion.appendChild(fila);
    accion.appendChild(el('p', 'demo-eco__nota', 'En la app real hablarías y Eco te escucharía. Aquí es una simulación.'));
    campo.focus({ preventScroll: true });
    let resta = SEGUNDOS;
    const id = window.setInterval(() => {
      resta -= 1;
      num.textContent = String(Math.max(resta, 0));
      if (resta <= 0) terminar();
    }, 1000);
    timers.push(id);
  }

  function seguimiento(respuesta) {
    progreso(4);
    vaciarAccion();
    enfasis(false);
    chat.textContent = '';
    if (respuesta) burbuja('tu', respuesta);
    esperar(600, () => {
      const texto = respuesta
        ? 'Gracias por contármelo. ¿Quién más estaba ahí? Cuéntame un detalle: cómo sonaba o cómo olía ese momento.'
        : 'Cuando quieras, cuéntamelo con tus palabras. Yo escucho con calma.';
      burbuja('eco', texto, () => esperar(1800, () => cierre(respuesta)));
    });
  }

  function cierre(respuesta) {
    progreso(5);
    vaciarAccion();
    const tarjeta = el('div', 'demo-eco__guardado');
    tarjeta.appendChild(el('span', null, 'Recuerdo guardado (ejemplo)'));
    const frase = respuesta
      ? '“' + (respuesta.length > 140 ? respuesta.slice(0, 140) + '…' : respuesta) + '”'
      : '“La casa de los abuelos, los domingos, el olor del café…”';
    tarjeta.appendChild(el('p', null, frase));
    accion.appendChild(tarjeta);
    accion.appendChild(el('p', 'demo-eco__nota', 'Así empieza un recuerdo. Con tu familia es igual: ellos hablan y Eco pregunta. Aquí no se guardó nada.'));
    const fila = el('div', 'demo-eco__fila');
    const crear = el('a', 'btn btn-primary', 'Crear mi cuenta');
    crear.href = '/index-portada.html#registro-form';
    fila.appendChild(crear);
    fila.appendChild(boton('Repetir la demo', 'btn-secondary', inicio));
    accion.appendChild(fila);
  }

  inicio();
})();

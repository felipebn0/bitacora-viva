/* ECO · Detección de contenido sensible y banner de recursos de ayuda (Colombia)
 *
 * En una app de memorias se cuentan muchas cosas difíciles del PASADO ("mi papá me pegaba",
 * "mi tío se suicidó en el 90"). Por eso el texto se clasifica en tres casos:
 *   - directo:   suena a algo que pasa AHORA ("me quiero morir", "me está pegando") -> banner de una.
 *   - verificar: menciona algo delicado pero en pasado o ambiguo -> se pregunta con calma si está
 *                pasando ahora; solo si la persona dice que sí, aparece el banner.
 *   - nada:      expresiones sin riesgo ("me mato de la risa", "se me pega") o la muerte de otra
 *                persona contada como recuerdo.
 * Sirve para lo que se escribe (cualquier <textarea>) y para lo que se dice por voz
 * (window.ecoCrisisCheck(texto, elementoCercano), que colaborar.html llama tras transcribir), y a la
 * marca que pone el servidor cuando ECO detecta un riesgo actual (window.ecoCrisisAyuda, en app.html y
 * colaborar.html).
 */
(()=>{
'use strict';

// ── Líneas de atención ────────────────────────────────────────────────────────
// Verificadas el 2026-10-16 contra fuentes oficiales (Secretaría de Salud y de la Mujer de Bogotá,
// Secretaría de Cultura, Policía Nacional, ICBF). Antes de agregar o cambiar un número, confirmarlo en
// la fuente oficial: un número equivocado aquí lo marca alguien en crisis.
const LINES_SUICIDE = [
  { num:'106',           label:'Salud Mental',       desc:'24/7 · gratuita · nacional' },
  { num:'018000423614',   label:'Línea Calma',         desc:'hombres · apoyo emocional · Bogotá' },
  { num:'123',            label:'Emergencias',         desc:'peligro inmediato' },
];
const LINES_VIOLENCE = [
  { num:'155',           label:'Violencia de género', desc:'24/7 · gratuita · nacional' },
  { num:'018000112137',  label:'Línea Púrpura',       desc:'mujeres · 24/7 · Bogotá' },
  { num:'141',           label:'ICBF',                desc:'niños y adolescentes' },
  { num:'123',           label:'Emergencias',         desc:'peligro inmediato' },
];

// ── Clasificación ─────────────────────────────────────────────────────────────
// Se compara sin tildes ni mayúsculas, así "está", "esta" y "ESTÁ" son lo mismo.
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

// Frases que se quitan antes de buscar: hablan de morir o pegar sin ningún riesgo.
const INOFENSIVAS = [
  /\b(me )?(muero|mato|morir|matar(me)?|moria|mataba) de (la )?(risa|hambre|sueno|calor|frio|ganas|amor|pena|verguenza|aburrimiento)\b/g,
  /\bme (voy a )?matar (estudiando|trabajando)\b/g,
  /\bse me (pega|pegaba|pego|pegan)\b/g,
  /\bme (pega|pegaba|pego) (el sol|la gripa|la musica|la cancion|duro el sol)\b/g,
  /\b(el sol|la gripa|la gripe|el frio|la musica|la cancion|esa cancion|el guayabo|el trago) me (pega|pegaba|pego)\b/g,
];

// SUICIDIO / AUTOLESIÓN
const SUICIDIO_AHORA = [
  /\b(me )?quiero (morir(me)?|matarme|suicidarme|quitarme la vida|hacerme dano)\b/,
  /\bme quiero (matar|suicidar|morir)\b/,
  /\bvoy a (matarme|suicidarme|quitarme la vida)\b/,
  /\bme voy a (matar|suicidar|quitar la vida)\b/,
  /\b(estoy pensando|pienso|he pensado|he estado pensando|ando pensando) en (el )?(suicid\w*|matarme|quitarme la vida|morir(me)?|hacerme dano)\b/,
  /\b(tengo|he tenido) (pensamientos|ideas) (suicidas|de (matarme|suicidarme|quitarme la vida|morir))\b/,
  /\bya no (quiero|aguanto) (vivir|seguir viviendo|estar aqui|seguir aqui|mas la vida)\b/,
  /\bno quiero (vivir|seguir viviendo) (mas|ya)\b/,
  /\b(la vida )?no tiene sentido (vivir|seguir)\b/,
  /\bmejor (estaria|estar|estuviera) muert[oa]\b/,
  /\bme (estoy haciendo|hago) dano\b/,
  /\bacabar con mi vida\b/,
];
const SUICIDIO_MENCION = [
  /\bsuicid\w*/,
  /\b(quise|queria|quisiera|pense en|intente|trate de) (morir(me)?|matarme|suicidarme|quitarme la vida|hacerme dano)\b/,
  /\b(matarme|quitarme la vida|hacerme dano)\b/,
  /\bno queria (vivir|seguir viviendo)\b/,
  /\bquiero desaparecer\b/, // muchas veces es solo "irme lejos un rato": se pregunta
];
// La muerte de otra persona contada como recuerdo: no se pregunta nada.
const SUICIDIO_DE_OTRO = /\bse (suicido|quito la vida|mato)\b/;

// VIOLENCIA
const VIOLENCIA_AHORA = [
  /\bme (esta|estan|sigue|siguen) (pegando|golpeando|maltratando|amenazando|abusando|lastimando|agrediendo|violando|haciendo dano)\b/,
  /\bme (va|van) a (pegar|golpear|matar|hacer dano|violar)\b/,
  /\bme (quiere|quieren) (matar|pegar|hacer dano)\b/,
  /\b(sigo|estoy|vivo) (sufriendo|viviendo|en) (violencia|maltrato|abuso)\b/,
  /\b(todavia|aun|todos los dias|cada vez que|hoy|anoche|ayer) (me )?(pega|golpea|maltrata|amenaza|abusa|agrede|pego|golpeo|amenazo|agredio|violo)\b/,
  /\b(me|nos) (pega|golpea|maltrata|amenaza|abusa|agrede) (todavia|aun|todos los dias|cada dia|siempre)\b/,
  /\btengo miedo (de que|que) me (pegue|mate|haga dano|golpee)\b/,
];
const VIOLENCIA_MENCION = [
  /\bme (pega|pegaba|pego|golpea|golpeaba|golpeo|maltrata|maltrataba|maltrato|amenaza|amenazaba|amenazo|abusa|abusaba|abuso|lastima|lastimaba|agrede|agredia|agredio|violo|forzo|pone la mano|ponia la mano)\b/,
  /\babuso de mi\b/,
  /\bviolencia (domestica|de genero|intrafamiliar|sexual)\b/,
  /\babuso sexual\b/,
];

function clasificar(texto) {
  let t = norm(texto);
  if (!t.trim()) return null;
  INOFENSIVAS.forEach((re) => { t = t.replace(re, ' '); });
  const hay = (lista) => lista.some((re) => re.test(t));
  if (hay(SUICIDIO_AHORA)) return { tipo: 'suicide', modo: 'directo' };
  if (hay(VIOLENCIA_AHORA)) return { tipo: 'violence', modo: 'directo' };
  if (hay(SUICIDIO_MENCION) && !(SUICIDIO_DE_OTRO.test(t) && !/\b(matarme|suicidarme|quitarme la vida|hacerme dano)\b/.test(t))) {
    return { tipo: 'suicide', modo: 'verificar' };
  }
  if (hay(VIOLENCIA_MENCION)) return { tipo: 'violence', modo: 'verificar' };
  return null;
}

// Solo la parte que se puede probar sin navegador (test/crisis-banner.smoke.js).
if (typeof module !== 'undefined' && module.exports) { module.exports = { clasificar }; }
if (typeof document === 'undefined') return;
window.ecoCrisisClasificar = clasificar;

// ── Mensajes ──────────────────────────────────────────────────────────────────
const MSGS = {
  suicide:  'Lo que sientes importa. Si estás cargando algo muy difícil, hay personas disponibles para escucharte ahora mismo, sin juzgarte.',
  violence: 'Lo que describes merece atención. Hay personas especializadas disponibles para acompañarte ahora mismo.',
};
const PREGUNTA = {
  suicide:  'Mencionaste algo delicado. ¿Es algo que estás sintiendo ahora?',
  violence: 'Mencionaste algo delicado. ¿Es algo que te está pasando ahora?',
};

// Respuesta "es un recuerdo" por tipo: no se vuelve a preguntar en esta visita (sí se muestra el
// banner si después aparece algo que suena a presente).
const yaRespondioRecuerdo = { suicide: false, violence: false };

const quitar = (sel) => document.querySelectorAll(sel).forEach((n) => n.remove());

function createBanner(type) {
  const lines = type === 'suicide' ? LINES_SUICIDE : LINES_VIOLENCE;
  const banner = document.createElement('div');
  banner.className = 'eco-crisis-banner eco-crisis-' + type;
  banner.setAttribute('role','alert');
  banner.innerHTML = `
    <button type="button" class="eco-crisis-close" aria-label="Cerrar">×</button>
    <p class="eco-crisis-msg">${MSGS[type]}</p>
    <ul class="eco-crisis-lines">
      ${lines.map(l=>`<li>
        <span class="eco-crisis-num">${l.num}</span>
        <span class="eco-crisis-label">${l.label}</span>
        <span class="eco-crisis-desc">· ${l.desc}</span>
      </li>`).join('')}
    </ul>
    <button type="button" class="eco-crisis-eco-btn">Seguir hablando con Eco →</button>`;

  banner.querySelector('.eco-crisis-close').addEventListener('click', ()=>banner.remove());
  banner.querySelector('.eco-crisis-eco-btn').addEventListener('click', ()=>{
    banner.remove();
    const chat = document.querySelector('.aporte-chat, #ecoChat, [data-eco-chat]');
    if(chat){
      chat.style.removeProperty('display');
      chat.hidden = false;
      chat.scrollIntoView({behavior:'smooth',block:'center'});
      chat.querySelector('textarea,input')?.focus();
    }
    document.dispatchEvent(new CustomEvent('eco:crisis-chat',{detail:{type}}));
  });
  return banner;
}

function createPregunta(type, alConfirmar) {
  const caja = document.createElement('div');
  caja.className = 'eco-crisis-check eco-crisis-' + type;
  caja.setAttribute('role', 'group');
  caja.setAttribute('aria-label', 'Pregunta de cuidado');
  const p = document.createElement('p');
  p.className = 'eco-crisis-msg';
  p.textContent = PREGUNTA[type];
  const fila = document.createElement('div');
  fila.className = 'eco-crisis-check-botones';
  const si = document.createElement('button');
  si.type = 'button';
  si.className = 'eco-crisis-eco-btn';
  si.textContent = 'Sí, ahora';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'eco-crisis-recuerdo';
  no.textContent = 'No, es un recuerdo';
  fila.append(si, no);
  caja.append(p, fila);
  si.addEventListener('click', () => { caja.remove(); alConfirmar(); });
  no.addEventListener('click', () => { yaRespondioRecuerdo[type] = true; caja.remove(); });
  return caja;
}

// Muestra lo que corresponda junto a "ancla". Devuelve lo que se mostró (para pruebas y depuración).
function mostrar(resultado, ancla) {
  if (!resultado) return null;
  const { tipo, modo } = resultado;
  const poner = (nodo) => ancla.insertAdjacentElement('afterend', nodo);
  if (modo === 'directo') {
    if (document.querySelector('.eco-crisis-banner.eco-crisis-' + tipo)) return 'banner';
    quitar('.eco-crisis-banner, .eco-crisis-check');
    poner(createBanner(tipo));
    return 'banner';
  }
  if (yaRespondioRecuerdo[tipo] || document.querySelector('.eco-crisis-banner, .eco-crisis-check')) return null;
  const pregunta = createPregunta(tipo, () => poner(createBanner(tipo)));
  poner(pregunta);
  pregunta.querySelector('button')?.focus({ preventScroll: true });
  return 'pregunta';
}

// ── Lo que se escribe ─────────────────────────────────────────────────────────
function watchTextarea(ta) {
  if(!ta || ta.dataset.ecocrisisAttached) return;
  ta.dataset.ecocrisisAttached = '1';
  let timer = null;
  ta.addEventListener('input', ()=>{
    clearTimeout(timer);
    timer = setTimeout(()=>{
      const r = clasificar(ta.value);
      const anchor = ta.closest('.aportes, .orb-zone, .write-row, form') || ta.parentElement;
      if (r) mostrar(r, anchor);
      else quitar('.eco-crisis-check'); // si borró lo que dijo, la pregunta ya no aplica
    }, 900);
  });
}

// ── Lo que se dice por voz ────────────────────────────────────────────────────
window.ecoCrisisCheck = function(text, nearEl){
  const anchor = nearEl || document.querySelector('.orb-zone, .aportes, main') || document.body;
  return mostrar(clasificar(text), anchor);
};

// ── Lo que responde ECO ───────────────────────────────────────────────────────
// El servidor marca la respuesta cuando ECO detecta un riesgo actual (ayuda = 'suicide' | 'violence').
// Respaldo: si ECO recomienda una línea de ayuda o ayuda profesional sin la marca, el banner sale igual.
const RECOMIENDA_AYUDA = /\b(106|123|155|141)\b|\blinea (de )?(ayuda|atencion|apoyo)|\bayuda profesional\b|\bprofesional de (la )?salud mental\b|\bnumeros? de ayuda\b/;
window.ecoCrisisAyuda = function(ayuda, textoEco, textoPersona, nearEl){
  let tipo = ayuda === 'suicide' || ayuda === 'violence' ? ayuda : null;
  if (!tipo && RECOMIENDA_AYUDA.test(norm(textoEco))) {
    const r = clasificar(textoPersona);
    tipo = r ? r.tipo : (/violencia|maltrat|agred|golpe|abus/.test(norm(textoEco)) ? 'violence' : 'suicide');
  }
  if (!tipo) return null;
  const anchor = nearEl || document.querySelector('.orb-zone, .aportes, main') || document.body;
  return mostrar({ tipo, modo: 'directo' }, anchor);
};

function init(){
  document.querySelectorAll('textarea').forEach(watchTextarea);
  new MutationObserver(()=>{
    document.querySelectorAll('textarea:not([data-ecocrisis-attached])').forEach(watchTextarea);
  }).observe(document.body,{childList:true,subtree:true});
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();

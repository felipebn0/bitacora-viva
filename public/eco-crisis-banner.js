/* ECO · Detección de contenido sensible y banner de recursos de ayuda (Colombia) */
(()=>{
'use strict';

// ── Líneas de atención ────────────────────────────────────────────────────────
const LINES_SUICIDE = [
  { num:'106',           label:'Salud Mental',       desc:'24/7 · gratuita · nacional' },
  { num:'192 opción 4',  label:'Min. Salud',          desc:'24/7 · gratuita · nacional' },
  // { num:'XXXX', label:'Línea Calma', desc:'...' }, // TODO: confirmar número
  { num:'123',           label:'Emergencias',         desc:'peligro inmediato' },
];
const LINES_VIOLENCE = [
  { num:'155',           label:'Violencia de género', desc:'24/7 · gratuita · nacional' },
  { num:'195',           label:'Línea Púrpura',       desc:'mujeres · Bogotá' },
  { num:'141',           label:'ICBF',                desc:'niños y adolescentes' },
  { num:'123',           label:'Emergencias',         desc:'peligro inmediato' },
];

// ── Palabras clave ────────────────────────────────────────────────────────────
const PATTERNS = {
  suicide: /suicid|quitarme\s+la\s+vida|no\s+quiero\s+vivir|acabar\s+con\s+todo|hacerme\s+da[ñn]o|matarme|ya\s+no\s+quiero\s+estar|desaparecer\s+para\s+siempre|no\s+tiene\s+sentido\s+vivir|quiero\s+morir|terminar\s+con\s+mi\s+vida/i,
  violence: /me\s+golpea|me\s+pega|me\s+maltrata|me\s+abusa|me\s+hiere|me\s+amenaza|me\s+lastima|violencia\s+dom[eé]stica|violencia\s+de\s+g[eé]nero|me\s+pone\s+la\s+mano|me\s+agrede|me\s+abusó|me\s+viol[oó]|abuso\s+sexual|me\s+forz[oó]/i,
};

// ── Mensajes del banner ───────────────────────────────────────────────────────
const MSGS = {
  suicide:  'Lo que sientes importa. Si estás cargando algo muy difícil, hay personas disponibles para escucharte ahora mismo, sin juzgarte.',
  violence: 'Lo que describes merece atención. Hay personas especializadas disponibles para acompañarte ahora mismo.',
};

// ── Crear banner ──────────────────────────────────────────────────────────────
function createBanner(type) {
  const lines = type === 'suicide' ? LINES_SUICIDE : LINES_VIOLENCE;
  const banner = document.createElement('div');
  banner.className = 'eco-crisis-banner eco-crisis-' + type;
  banner.setAttribute('role','alert');
  banner.setAttribute('aria-live','polite');
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
    // Intenta activar el chat de Eco si existe en la página
    const chat = document.querySelector('.aporte-chat, #ecoChat, [data-eco-chat]');
    if(chat){
      chat.style.removeProperty('display');
      chat.hidden = false;
      chat.scrollIntoView({behavior:'smooth',block:'center'});
      chat.querySelector('textarea,input')?.focus();
    }
    // Dispara evento por si la app quiere manejarlo externamente
    document.dispatchEvent(new CustomEvent('eco:crisis-chat',{detail:{type}}));
  });

  return banner;
}

// ── Insertar banner cerca del área de escritura ───────────────────────────────
function insertBanner(textarea, type) {
  // Quitar banner previo
  document.querySelector('.eco-crisis-banner')?.remove();
  const banner = createBanner(type);
  // Buscar contenedor más cercano relevante
  const anchor = textarea.closest('.aportes, .orb-zone, .write-row, form') || textarea.parentElement;
  anchor.insertAdjacentElement('afterend', banner);
}

// ── Vigilar un textarea ───────────────────────────────────────────────────────
function watchTextarea(ta) {
  if(!ta || ta.dataset.ecocrisisAttached) return;
  ta.dataset.ecocrisisAttached = '1';
  let lastType = null;
  let timer = null;

  ta.addEventListener('input', ()=>{
    clearTimeout(timer);
    timer = setTimeout(()=>{
      const val = ta.value;
      let type = null;
      if(PATTERNS.suicide.test(val))  type = 'suicide';
      else if(PATTERNS.violence.test(val)) type = 'violence';

      if(type && type !== lastType){
        insertBanner(ta, type);
        lastType = type;
      } else if(!type && lastType){
        document.querySelector('.eco-crisis-banner')?.remove();
        lastType = null;
      }
    }, 900);
  });
}

// ── También vigilar texto que llega de transcripciones de voz ────────────────
// La app puede llamar esto externamente: window.ecoCrisisCheck('texto transcrito')
window.ecoCrisisCheck = function(text, nearEl){
  let type = null;
  if(PATTERNS.suicide.test(text))  type = 'suicide';
  else if(PATTERNS.violence.test(text)) type = 'violence';
  if(!type) return;
  if(document.querySelector('.eco-crisis-banner')) return; // ya hay uno
  const anchor = nearEl || document.querySelector('.aportes, main') || document.body;
  const banner = createBanner(type);
  anchor.insertAdjacentElement('afterend', banner);
};

// ── Init ──────────────────────────────────────────────────────────────────────
function init(){
  document.querySelectorAll('textarea').forEach(watchTextarea);
  new MutationObserver(()=>{
    document.querySelectorAll('textarea:not([data-ecocrisis-attached])').forEach(watchTextarea);
  }).observe(document.body,{childList:true,subtree:true});
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();

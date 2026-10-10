/* ECO Colaboración · vista compacta sobre elementos originales.
   Los IDs, eventos de guardado, botones de privacidad, audio y filtros se conservan. */
(()=>{'use strict';
 function init(){
  const main=document.querySelector('body>main.wrap');
  if(!main||main.dataset.ecoVistaCompacta)return;
  const cta=main.querySelector('.aportar-ahora');
  const tabs=main.querySelector('.tabs-row');
  if(!cta||!tabs)return;
  main.dataset.ecoVistaCompacta='1';
  const bar=document.createElement('div');
  bar.className='eco-c-actionbar';
  tabs.parentNode.insertBefore(bar,tabs);
  bar.append(cta,tabs);
  cta.textContent='Aportar una historia';

  // Familiares: cerrar la lista larga, pero dejar visible el botón de invitar.
  const section=document.getElementById('colaboradoresSection');
  const people=document.getElementById('colaboradoresLista');
  if(section&&people){
   const heading=section.querySelector('h2');
   const sub=section.querySelector('p.sub');
   const b=document.createElement('button');
   b.type='button';b.className='eco-c-section-toggle';
   b.setAttribute('aria-expanded','false');
   b.setAttribute('aria-controls','colaboradoresLista');
   b.textContent='Ver colaboradores ▾';
   if(sub)sub.insertAdjacentElement('afterend',b);
   else if(heading)heading.insertAdjacentElement('afterend',b);
   people.classList.add('eco-c-people-closed');
   b.addEventListener('click',()=>{
    const expanded=b.getAttribute('aria-expanded')!=='true';
    b.setAttribute('aria-expanded',String(expanded));
    b.textContent=expanded?'Ocultar colaboradores ▴':'Ver colaboradores ▾';
    people.classList.toggle('eco-c-people-closed',!expanded);
   });
  }

  // Vista previa por aporte. No modifica la estructura de cada tarjeta salvo añadir
  // un botón de expansión. Los nodos de audio y acciones siguen intactos.
  const lists=['aportesLista','dadosLista'].map(id=>document.getElementById(id)).filter(Boolean);
  const shorten=(t,n)=>t.length>n?t.slice(0,n-1).trimEnd()+'…':t;
  function enhance(list){
   for(const card of list.querySelectorAll('.aporte-item:not([data-eco-compact])')){
    card.dataset.ecoCompact='1';
    card.classList.add('eco-c-story-card');
    const name=card.querySelector('.quien')?.textContent?.trim()||'Historia familiar';
    const body=card.querySelector('.texto')?.textContent?.trim()||'';
    const toggle=document.createElement('button');
    toggle.type='button';toggle.className='eco-c-story-toggle';
    toggle.setAttribute('aria-expanded','false');
    const nameSpan=document.createElement('strong');nameSpan.className='eco-c-story-person';nameSpan.textContent=shorten(name,95);
    const excerpt=document.createElement('span');excerpt.className='eco-c-story-excerpt';excerpt.textContent=body?shorten(body.replace(/\s+/g,' '),125):'Toca para ver el recuerdo';
    const arrow=document.createElement('span');arrow.className='eco-c-story-arrow';arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');
    toggle.append(nameSpan,excerpt,arrow);
    card.insertBefore(toggle,card.firstChild);
    card.classList.add('eco-c-is-closed');
    toggle.addEventListener('click',()=>{
      const next=toggle.getAttribute('aria-expanded')!=='true';
      toggle.setAttribute('aria-expanded',String(next));
      card.classList.toggle('eco-c-is-closed',!next);
      arrow.textContent=next?'⌃':'⌄';
    });
   }
  }
  for(const list of lists){
   const observer=new MutationObserver(()=>enhance(list));
   observer.observe(list,{childList:true});
   enhance(list);
  }
  // Títulos y presentaciones editoriales sin añadir bloques de estadísticas falsas.
  const aportes=document.getElementById('aportesSection');
  const title=aportes?.querySelector('h2');
  if(title)title.textContent='Aportes recibidos';
  const sub=aportes?.querySelector('p.sub');
  if(sub)sub.textContent='Selecciona una historia para leerla, escucharla o administrar sus permisos.';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

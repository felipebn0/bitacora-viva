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
  // Dos cosas distintas: ACTUAR (aportar a una historia) y MIRAR (lo que dijeron de mí / lo que yo dije de otros).
  const bar=document.createElement('div');
  bar.className='eco-c-actionbar';
  tabs.parentNode.insertBefore(bar,tabs);
  const nota=document.createElement('p');
  nota.className='eco-c-cta-nota';
  nota.textContent='Cuenta un recuerdo en la bitácora de otra persona.';
  bar.append(cta,nota);
  cta.textContent='Aportar a una historia';
  tabs.classList.add('eco-c-menu');
  tabs.setAttribute('aria-label','Historias');
  const rotulo=document.createElement('h2');
  rotulo.className='eco-c-rotulo';
  rotulo.textContent='Historias';
  tabs.parentNode.insertBefore(rotulo,tabs);

  // Familiares: "Quiénes han colaborado" es lo mismo que "Aportes recibidos", así que solo queda
  // el botón de invitar.
  const section=document.getElementById('colaboradoresSection');
  if(section){
   section.classList.add('eco-c-solo-invitar');
   const btnRow=document.createElement('div');
   btnRow.className='eco-c-colabs-btnrow';
   section.insertBefore(btnRow,section.firstChild);
   const invOrig=document.getElementById('invitarToggle');
   const invPanel=document.getElementById('invitarPanel');
   if(invOrig&&invPanel){
    const invBtn=invOrig.cloneNode(true);
    btnRow.appendChild(invBtn);
    invOrig.remove();
    const modal=document.createElement('div');
    modal.id='ecoInvitarModal';
    modal.className='eco-c-modal-overlay';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','ecoInvitarModalTitle');
    modal.hidden=true;
    const box=document.createElement('div');
    box.className='eco-c-modal-box';
    const mHead=document.createElement('div');
    mHead.className='eco-c-modal-header';
    const mTitle=document.createElement('h3');
    mTitle.id='ecoInvitarModalTitle';
    mTitle.textContent='Invitar familiares';
    const mClose=document.createElement('button');
    mClose.type='button';mClose.className='eco-c-modal-close';
    mClose.setAttribute('aria-label','Cerrar');mClose.textContent='×';
    mHead.append(mTitle,mClose);
    invPanel.hidden=false;
    box.append(mHead,invPanel);
    modal.appendChild(box);
    document.body.appendChild(modal);
    const openModal=()=>{
     invBtn.setAttribute('aria-expanded','true');
     modal.hidden=false;
     document.body.classList.add('eco-c-modal-open');
     requestAnimationFrame(()=>mClose.focus());
     if(typeof cargarInvitaciones==='function')cargarInvitaciones();
    };
    const closeModal=()=>{
     invBtn.setAttribute('aria-expanded','false');
     modal.hidden=true;
     document.body.classList.remove('eco-c-modal-open');
     invBtn.focus();
    };
    invBtn.setAttribute('aria-expanded','false');
    invBtn.setAttribute('aria-controls','ecoInvitarModal');
    invBtn.addEventListener('click',openModal);
    mClose.addEventListener('click',closeModal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
    document.addEventListener('keydown',e=>{if(!modal.hidden&&e.key==='Escape'){e.preventDefault();closeModal();}});
   }
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

  // Filtro por colaborador en #aportesLista
  const aportesListaEl=document.getElementById('aportesLista');
  if(aportes&&aportesListaEl){
   const filterRow=document.createElement('div');
   filterRow.className='eco-c-filter-row';
   const filterSel=document.createElement('select');
   filterSel.className='eco-c-filter-sel';
   filterSel.setAttribute('aria-label','Filtrar aportes por persona');
   filterRow.appendChild(filterSel);
   (sub||title)?.insertAdjacentElement('afterend',filterRow);

   function rebuildFilter(){
    const prev=filterSel.value;
    const names=new Set();
    for(const card of aportesListaEl.querySelectorAll('.aporte-item')){
     const n=card.querySelector('.quien')?.textContent?.trim()||'';
     if(n)names.add(n);
    }
    filterSel.innerHTML='';
    const all=document.createElement('option');
    all.value='';all.textContent='Listado completo';
    filterSel.appendChild(all);
    [...names].sort().forEach(n=>{
     const o=document.createElement('option');
     o.value=n;o.textContent=n;filterSel.appendChild(o);
    });
    if(prev&&names.has(prev))filterSel.value=prev;
    applyFilter();
   }
   function applyFilter(){
    const v=filterSel.value;
    for(const card of aportesListaEl.querySelectorAll('.aporte-item')){
     const n=card.querySelector('.quien')?.textContent?.trim()||'';
     card.hidden=!!(v&&n!==v);
    }
   }
   filterSel.addEventListener('change',applyFilter);
   new MutationObserver(rebuildFilter).observe(aportesListaEl,{childList:true});
   rebuildFilter();
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

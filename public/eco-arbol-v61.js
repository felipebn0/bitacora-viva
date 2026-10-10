/* ECO Árbol V6.1 — navegación reparada y presentación compacta.
 * Complemento de V6 + V5: no altera datos, posiciones ni relaciones.
 */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 let current='family';
 let nav,modeChoice;
 function setup(){
  const toolbar=document.querySelector('.toolbar'),root=$('ecoV6Root'),stage=$('stage'),list=$('listPanel');
  if(!toolbar||!root||!stage||!list||$('ecoV61Nav'))return;
  nav=document.createElement('div');nav.id='ecoV61Nav';nav.className='eco-v61-nav';nav.setAttribute('role','group');nav.setAttribute('aria-label','Vista del árbol familiar');
  const make=(id,name,fn)=>{const b=document.createElement('button');b.type='button';b.id=id;b.className='btn';b.textContent=name;b.onclick=fn;nav.appendChild(b);return b};
  make('ecoV61Family','Vista familiar',()=>switchMode('family'));
  make('ecoV61Tree','Árbol completo',()=>switchMode('tree'));
  toolbar.append(nav);
  modeChoice=document.createElement('div');modeChoice.className='eco-v61-subnav';modeChoice.id='ecoV61Subnav';
  const tree=document.createElement('button');tree.type='button';tree.id='ecoV61Map';tree.textContent='Diagrama';tree.onclick=()=>switchMode('tree');
  const listing=document.createElement('button');listing.type='button';listing.id='ecoV61List';listing.textContent='Lista de familiares';listing.onclick=()=>switchMode('list');
  modeChoice.append(tree,listing);root.insertAdjacentElement('afterend',modeChoice);
  const originalReset=$('resetPlaces');if(originalReset)originalReset.hidden=true;
  const note=document.querySelector('.notice');if(note){note.classList.add('eco-v61-notice');note.innerHTML='Las personas, fotografías y vínculos se guardan en tu cuenta. <strong>Organizar el árbol solo cambia la posición de las tarjetas.</strong>'}
  root.addEventListener('click',e=>{if(e.target.closest('.eco-v6-card'))setTimeout(()=>{switchMode('tree',true)},0)});
  new MutationObserver(()=>{decorate(root)}).observe(root,{childList:true,subtree:true});
  decorate(root);
  switchMode('family');
 }
 function switchMode(next,keepSelection=false){
  current=next;
  const root=$('ecoV6Root'),stage=$('stage'),panel=$('listPanel'),grid=$('listGrid');
  if(!root||!stage||!panel)return;
  if(next==='family'){
   $('ecoV6Compact')?.click();
   root.hidden=false;stage.classList.add('hidden');panel.classList.remove('visible');panel.classList.add('hidden');grid?.classList.remove('visible');
  }else{
   $('ecoV6Full')?.click();
   if(next==='list')$('listBtn')?.onclick?.();
   else $('treeBtn')?.onclick?.();
   root.hidden=true;
   if(next==='list'){
    stage.classList.add('hidden');panel.classList.remove('hidden');panel.classList.add('visible');grid?.classList.add('visible');
   }else{
    stage.classList.remove('hidden');panel.classList.remove('visible');panel.classList.add('hidden');grid?.classList.remove('visible');
   }
  }
  if(nav){for(const b of nav.querySelectorAll('button')){const on=(b.id==='ecoV61Family'&&next==='family')||(b.id==='ecoV61Tree'&&next!=='family');b.setAttribute('aria-pressed',String(on))}}
  if(modeChoice){modeChoice.hidden=next==='family';$('ecoV61Map')?.setAttribute('aria-pressed',String(next==='tree'));$('ecoV61List')?.setAttribute('aria-pressed',String(next==='list'))}
  for(const id of ['zoomIn','zoomOut','zoomReset','zoomText']){const e=$(id);if(e)e.hidden=next!=='tree'}
 }
 function decorate(root){
  root.querySelectorAll('.eco-v6-branch').forEach((branch,i)=>{
   const b=branch.querySelector('.eco-v6-expand');if(!b)return;
   const text=b.textContent||'';const count=(text.match(/\d+/)||[])[0];if(!count)return;
   const label=i===0?'Hermanos de papá':'Hermanos de mamá';
   const value=`${label} (${count}) · ${/Ocultar/.test(text)?'Ocultar':'Ver'}`;
   if(b.textContent!==value)b.textContent=value;
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();

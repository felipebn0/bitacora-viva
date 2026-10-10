/* ECO Árbol V6.2. Sustituye V6.1; no modifica datos familiares. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let mode='family',relations=new Map(),lastPerson=null,observing=false;
const normalize=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
function inferLabel(other,current,otherIsParent){
 const r=normalize(otherIsParent?other?.relacion:current?.relacion);
 if(otherIsParent){
  if(/(^|[\s,])(papa|padre)([\s,]|$)/.test(r))return 'Papá';
  if(/(^|[\s,])(mama|madre)([\s,]|$)/.test(r))return 'Mamá';
  if(/abuela/.test(r))return 'Abuela';
  if(/abuelo/.test(r))return 'Abuelo';
  return 'Progenitor/a';
 }
 if(/hija/.test(normalize(other?.relacion)))return 'Hija';
 if(/hijo/.test(normalize(other?.relacion)))return 'Hijo';
 return 'Hijo/a';
}
function fixRelations(){
 const panel=$('relations'),selectedName=$('sideTitle')?.textContent?.trim();
 if(!panel||!selectedName)return;
 const selected=[...relations.values()].find(p=>p.nombre===selectedName);
 if(!selected)return;
 for(const row of panel.querySelectorAll('.relation-row')){
  const span=row.querySelector('span');if(!span||!span.textContent.endsWith(' · Padre/madre'))continue;
  const otherName=span.textContent.slice(0,-' · Padre/madre'.length);
  const matches=[...relations.values()].filter(p=>p.nombre===otherName);
  if(matches.length!==1)continue;
  const other=matches[0];
  const parents=Array.isArray(selected.padres)?selected.padres:[];
  const isParent=parents.some(x=>normalize(x)===normalize(other.nombre));
  const childParents=Array.isArray(other.padres)?other.padres:[];
  const isChild=childParents.some(x=>normalize(x)===normalize(selected.nombre));
  if(!isParent&&!isChild)continue;
  span.textContent=otherName+' · '+inferLabel(other,selected,isParent);
 }
}
function watchRelations(){
 const panel=$('relations');if(!panel||observing)return;observing=true;
 let running=false;
 const observer=new MutationObserver(()=>{if(running)return;running=true;fixRelations();running=false});
 observer.observe(panel,{childList:true,subtree:true,characterData:true});
 fixRelations();
}
async function loadRelations(){
 try{const r=await fetch('/api/tree',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;
 const data=await r.json();relations=new Map((data.people||[]).map(p=>[String(p.id),p]));fixRelations();
 }catch{}
}
function switchTo(next){
 mode=next;
 const root=$('ecoV6Root'),stage=$('stage'),panel=$('listPanel'),grid=$('listGrid');
 if(!root||!stage||!panel)return;
 if(next==='family'){$('ecoV6Compact')?.click();}
 else {
  $('ecoV6Full')?.click();
  if(next==='list')$('listBtn')?.click();else $('treeBtn')?.click();
 }
 root.hidden=next!=='family';
 stage.classList.toggle('hidden',next!=='tree');
 panel.classList.toggle('hidden',next!=='list');
 panel.classList.toggle('visible',next==='list');
 grid?.classList.toggle('visible',next==='list');
 for(const [id,choice] of [['ecoV62Family','family'],['ecoV62List','list'],['ecoV62Tree','tree']])$(''+id)?.setAttribute('aria-pressed',String(next===choice));
 for(const id of ['zoomIn','zoomOut','zoomReset','zoomText']){const el=$(id);if(el)el.hidden=next!=='tree'}
}
function setup(){
 const toolbar=document.querySelector('.toolbar'),root=$('ecoV6Root');
 if(!toolbar||!root||$('ecoV62Family'))return;
 for(const id of ['treeBtn','listBtn','ecoV6Compact','ecoV6Full']){const el=$(id);if(el){el.hidden=true;el.classList.add('eco-v62-hide')}}
 const old=$('ecoV61Nav');if(old)old.remove();$('ecoV61Subnav')?.remove();
 const nav=document.createElement('div');nav.className='eco-v62-nav';nav.setAttribute('role','group');nav.setAttribute('aria-label','Vistas del árbol familiar');
 const items=[['ecoV62Family','Vista familiar','family'],['ecoV62List','Lista de familiares','list'],['ecoV62Tree','Árbol completo','tree']];
 for(const [id,label,value] of items){const b=document.createElement('button');b.id=id;b.type='button';b.className='btn';b.textContent=label;b.onclick=()=>switchTo(value);nav.appendChild(b)}
 toolbar.appendChild(nav);
 const organize=$('ecoAutoGenerations');
 if(organize){organize.textContent='Organizar árbol';organize.onclick=null;organize.addEventListener('click',()=>setTimeout(()=>switchTo('tree'),0))}
 const reset=$('resetPlaces');if(reset){reset.hidden=true;reset.classList.add('eco-v62-hide')}
 const notice=document.querySelector('.notice');if(notice)notice.textContent='Tus familiares, fotografías y vínculos se guardan en tu cuenta. Puedes explorar las ramas o reorganizar las tarjetas.';
 root.addEventListener('click',e=>{if(e.target.closest('.eco-v6-card'))setTimeout(()=>switchTo('tree'),0)});
 const observer=new MutationObserver(()=>{const r=$('ecoV6Root');if(mode==='family'&&r?.hidden)r.hidden=false});
 observer.observe(root,{attributes:true,attributeFilter:['hidden']});
 watchRelations();loadRelations();
 switchTo('family');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();

/* ECO V7.1: las tarjetas de vista familiar seleccionan sin cambiar de vista. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let selectedId=null, action=null;
function selectCard(btn){
 const id=btn?.dataset.ecoPersonId;
 if(!id)return;
 const native=document.querySelector('#nodes .person[data-id="'+CSS.escape(id)+'"]')||
              document.querySelector('#listGrid .person[data-id="'+CSS.escape(id)+'"]');
 if(!native){window.alert('La ficha todavía está cargando. Intenta de nuevo.');return}
 native.click();selectedId=id;
 document.querySelectorAll('#eco7Root .eco7-person').forEach(e=>{
  const selected=e.dataset.ecoPersonId===id;
  e.classList.toggle('eco71-selected',selected);
  e.setAttribute('aria-pressed',String(selected))
 });
 if(action)action.hidden=false;
 if(window.matchMedia('(max-width: 900px)').matches){
   const aside=document.querySelector('.side');
   aside?.scrollIntoView({behavior:'smooth',block:'start'});
 }
}
function assignCardIds(){
 const root=$('eco7Root');if(!root)return;
 root.querySelectorAll('.eco7-person').forEach(btn=>{
  const id=btn.dataset.ecoPersonId;
  const native=id&&document.querySelector('#nodes .person[data-id="'+CSS.escape(id)+'"]');
  btn.disabled=!native;
  btn.title=native?'Ver información del familiar':'Familiar no disponible en el árbol';
  btn.classList.toggle('eco71-selected',Boolean(id&&id===selectedId));
  btn.setAttribute('aria-pressed',String(Boolean(id&&id===selectedId)));
 });
}
function init(){
 const root=$('eco7Root');if(!root||root.dataset.eco71)return;
 root.dataset.eco71='1';
 // Capture before V7's handler so the person button never triggers switchMode('tree').
 root.addEventListener('click',e=>{
  const card=e.target.closest('.eco7-person');if(!card||!root.contains(card))return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  selectCard(card)
 },true);
 const panel=$('relations');if(panel){
  action=document.createElement('button');action.id='eco71SeeTree';action.type='button';action.className='btn eco71-tree-action';
  action.textContent='Ver en árbol completo';action.hidden=true;
  action.onclick=()=>{
   const nav=[...document.querySelectorAll('.eco7-nav button')].find(b=>b.dataset.mode==='tree');nav?.click();
   if(!selectedId)return;
   const node=document.querySelector('#nodes .person[data-id="'+CSS.escape(selectedId)+'"]');
   node?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});
  };
  panel.insertAdjacentElement('afterend',action);
 }
 const mo=new MutationObserver(()=>assignCardIds());
 mo.observe(root,{childList:true,subtree:true});
 // Wait for the initial tree and family card load.
 const nodes=$('nodes');if(nodes) new MutationObserver(()=>assignCardIds()).observe(nodes,{childList:true,subtree:true});
 assignCardIds();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
})();

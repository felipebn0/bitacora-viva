/* ECO Árbol v6: explorador compacto. Lee relaciones existentes, nunca las inventa ni modifica. */
(()=>{'use strict';
const $=s=>document.getElementById(s);
const norm=s=>String(s||'').trim().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
let people=[],state={},main=null,root,compact=true,expanded=new Set(),activeBranch='all';
const rel=p=>norm(p?.relacion);
const parents=p=>{if(Array.isArray(p.padres))return p.padres;try{return JSON.parse(p.padres||'[]')}catch{return []}};
const byId=()=>new Map(people.map(p=>[String(p.id),p]));
const byName=()=>{const names=new Map();people.forEach(p=>{const k=norm(p.nombre);names.set(k,[...(names.get(k)||[]),p])});return names};
const getParents=(p,names)=>parents(p).flatMap(x=>{const candidates=names.get(norm(x))||[];return candidates.length===1?candidates:[]}).filter(q=>String(q.id)!==String(p.id));
function make(tag,cl,text){const e=document.createElement(tag);if(cl)e.className=cl;if(text!=null)e.textContent=text;return e}
function card(p,sub){const b=make('button','eco-v6-card');b.type='button';
 const avatar=make('span','eco-v6-avatar');const photo=state.photos?.[p.id];if(photo){const im=make('img');im.src=photo;im.alt='';avatar.append(im)}else avatar.textContent=(p.nombre||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
 const info=make('span','eco-v6-person');info.append(make('strong','',p.nombre||'Familiar'),make('small','',sub||p.relacion||'Familiar'));b.append(avatar,info);b.onclick=()=>{compact=false;toggleView();const node=document.querySelector('#nodes .person[data-id="'+CSS.escape(String(p.id))+'"]');node?.click();node?.scrollIntoView({block:'center',inline:'center',behavior:'smooth'})};return b}
function coupleCard(p,q,lab){const b=make('div','eco-v6-couple');b.append(card(p,p.relacion));if(q)b.append(make('span','eco-v6-plus','＋'),card(q,q.relacion));else b.append(make('small','eco-v6-missing','Otro progenitor no confirmado'));return b}
function ancestorsFor(p,names){return p?getParents(p,names):[]}
function branch(label,parentsGroup,child,others,names){
 const section=make('section','eco-v6-branch');section.append(make('h3','',label));
 const pair=make('div','eco-v6-generation');
 if(parentsGroup.length){for(let i=0;i<parentsGroup.length;i+=2)pair.append(coupleCard(parentsGroup[i],parentsGroup[i+1],label))}
 else pair.append(make('p','eco-v6-note','Los abuelos de esta rama todavía no están vinculados como padres. Puedes completar esos vínculos desde el árbol completo.'));
 section.append(pair);
 if(child){const group=make('div','eco-v6-lineage');group.append(make('span','eco-v6-down','↓'),card(child,child.relacion));section.append(group)}
 if(others.length){const id=label.toLowerCase();const isOpen=expanded.has(id);const btn=make('button','eco-v6-expand',`${others.length} familiar${others.length===1?'':'es'} más de esta generación · ${isOpen?'Ocultar':'Ver'}`);btn.type='button';btn.setAttribute('aria-expanded',String(isOpen));btn.onclick=()=>{isOpen?expanded.delete(id):expanded.add(id);render()};section.append(btn);if(isOpen){const items=make('div','eco-v6-relative-grid');others.forEach(p=>items.append(card(p,p.relacion)));section.append(items)}}
 return section
}
function render(){
 if(!root||!compact)return;
 root.replaceChildren();
 const names=byName(),me=main;
 const heads=make('div','eco-v6-head');heads.append(make('h2','','Tu familia, de un vistazo'),make('p','','Explora una rama a la vez. Las conexiones se calculan a partir de los padres ya registrados.'));
 root.append(heads);
 if(!me){root.append(make('p','eco-v6-note','No se identificó una persona principal. Abre el árbol completo y revisa quién está marcado como principal.'));return}
 const direct=ancestorsFor(me,names);
 const father=direct.find(p=>/\b(papa|padre)\b/.test(rel(p)))||direct[0]||null;
 const mother=direct.find(p=>/\b(mama|madre)\b/.test(rel(p)))||direct.find(p=>p!==father)||null;
 const paternal=ancestorsFor(father,names),maternal=ancestorsFor(mother,names);
 const fatherSiblings=father?people.filter(p=>p!==father&&parents(p).some(x=>paternal.some(z=>norm(z.nombre)===norm(x)))):[];
 const motherSiblings=mother?people.filter(p=>p!==mother&&parents(p).some(x=>maternal.some(z=>norm(z.nombre)===norm(x)))):[];
 const columns=make('div','eco-v6-columns');columns.append(branch('Rama paterna',paternal,father,fatherSiblings,names),branch('Rama materna',maternal,mother,motherSiblings,names));root.append(columns);
 const self=make('div','eco-v6-center');self.append(make('div','eco-v6-down','↓'),card(me,'Persona principal'));root.append(self);
 const brothers=people.filter(p=>p!==me&&parents(p).some(x=>parents(me).some(y=>norm(x)===norm(y))));
 if(brothers.length){const bl=make('div','eco-v6-siblings');bl.append(make('h3','','Hermanos y hermanas'));brothers.forEach(p=>bl.append(card(p,p.relacion)));root.append(bl)}
 const unknown=people.filter(p=>p!==me&&!direct.includes(p)&&!paternal.includes(p)&&!maternal.includes(p)&&!fatherSiblings.includes(p)&&!motherSiblings.includes(p)&&!brothers.includes(p)&&p!==father&&p!==mother);
 if(unknown.length){const wrap=make('div','eco-v6-other');const open=expanded.has('others');const bt=make('button','eco-v6-expand',`${unknown.length} familiares adicionales · ${open?'Ocultar':'Explorar'}`);bt.onclick=()=>{open?expanded.delete('others'):expanded.add('others');render()};wrap.append(bt);if(open){const grid=make('div','eco-v6-relative-grid');unknown.forEach(p=>grid.append(card(p,p.relacion)));wrap.append(grid)}root.append(wrap)}
 root.append(make('p','eco-v6-note','ECO no supone matrimonios ni parentescos ausentes. Cuando dos personas son padres registrados de un mismo hijo, aparecen juntas como progenitores. Para corregir vínculos, usa el árbol completo.'));
}
function toggleView(){const stage=$('stage'),panel=$('listPanel');if(!stage)return;root.hidden=!compact;stage.classList.toggle('hidden',compact);if(panel)panel.classList.toggle('hidden',compact);
 $('ecoV6Compact').setAttribute('aria-pressed',String(compact));$('ecoV6Full').setAttribute('aria-pressed',String(!compact));if(compact)render()}
async function reload(){
 const [r,s]=await Promise.all([fetch('/api/tree',{credentials:'same-origin',cache:'no-store'}),fetch('/api/tree/v4-state',{credentials:'same-origin',cache:'no-store'})]);
 if(!r.ok||!s.ok)throw Error('No fue posible cargar el árbol familiar.');
 const d=await r.json(),st=await s.json();people=Array.isArray(d.people)?d.people:[];state=st.state||{};main=people.find(p=>p.es_principal)||null;
 render();
}
function init(){
 const stage=$('stage'),toolbar=document.querySelector('.toolbar');if(!stage||!toolbar||$('ecoV6Compact'))return;
 const controls=make('div','eco-v6-switch');
 const compactBtn=make('button','btn','Vista familiar');compactBtn.id='ecoV6Compact';compactBtn.type='button';compactBtn.onclick=()=>{compact=true;toggleView()};
 const fullBtn=make('button','btn','Árbol completo');fullBtn.id='ecoV6Full';fullBtn.type='button';fullBtn.onclick=()=>{compact=false;toggleView()};
 controls.append(compactBtn,fullBtn);toolbar.append(controls);
 root=make('div','eco-v6-root');root.id='ecoV6Root';stage.insertAdjacentElement('beforebegin',root);
 const reset=$('resetPlaces');if(reset)reset.hidden=true;
 const auto=$('ecoAutoGenerations');if(auto){auto.textContent='Organizar árbol';auto.title='Reorganiza las tarjetas en la vista completa';auto.addEventListener('click',()=>{compact=false;toggleView()})}
 const note=document.querySelector('.eco-generation-note');if(note)note.hidden=true;
 for(const id of ['listBtn','treeBtn'])$(id)?.addEventListener('click',()=>{compact=false;toggleView()});
 toggleView();reload().catch(e=>root.append(make('p','eco-v6-note',e.message)));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&compact)reload().catch(()=>{})});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

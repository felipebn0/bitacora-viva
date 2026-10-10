/* ECO Árbol v5 - orden por generaciones, sin modificar vínculos. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const norm=v=>String(v||'').trim().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const num=v=>Number(v);
async function get(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('No fue posible leer los datos de ECO.');return r.json()}
function generate(people,state){
 const persons=people.filter(p=>Number.isInteger(num(p.id))),byId=new Map(persons.map(p=>[num(p.id),p]));
 const names=new Map();for(const p of persons){const key=norm(p.nombre);if(!names.has(key))names.set(key,[]);names.get(key).push(p)}
 const parents=new Map(persons.map(p=>[num(p.id),new Set()]));const partners=new Map();
 for(const p of persons){
  const raw=Array.isArray(p.padres)?p.padres:(()=>{try{return JSON.parse(p.padres||'[]')}catch{return []}})();
  for(const n of raw){const matches=names.get(norm(n))||[];if(matches.length===1&&matches[0].id!==p.id)parents.get(num(p.id)).add(num(matches[0].id))}
 }
 for(const l of state.links||[]){
  const a=num(l.a),b=num(l.b);if(!byId.has(a)||!byId.has(b)||a===b)continue;
  if(l.type==='parent')parents.get(b).add(a);
  if(l.type==='partner'){if(!partners.has(a))partners.set(a,new Set());if(!partners.has(b))partners.set(b,new Set());partners.get(a).add(b);partners.get(b).add(a)}
 }
 // Directed graph: depth generation; tolerate bad or cyclic data by bounded relaxation.
 const depths=new Map(persons.map(p=>[num(p.id),0]));
 for(let n=0;n<persons.length;n++){let change=false;
  for(const [child,pp] of parents)for(const parent of pp){const proposed=Math.min(12,(depths.get(parent)||0)+1);
   if(proposed>(depths.get(child)||0)){depths.set(child,proposed);change=true}}
  if(!change)break;
 }
 // Partners share a generation only when compatible with biological tree; never override parent edges.
 for(let pass=0;pass<2;pass++)for(const [a,bb] of partners)for(const b of bb){
  if(parents.get(a)?.has(b)||parents.get(b)?.has(a))continue;
  const x=depths.get(a),y=depths.get(b);
  if(Math.abs(x-y)===1&&parents.get(a)?.size===0&&parents.get(b)?.size===0){const m=Math.max(x,y);depths.set(a,m);depths.set(b,m)}
 }
 const levelMap=new Map();
 for(const p of persons){const z=depths.get(num(p.id))||0;if(!levelMap.has(z))levelMap.set(z,[]);levelMap.get(z).push(p)}
 const positions={};
 // Group by parental anchors to keep siblings and couples together, rather than alphabetical alone.
 const childMap=new Map();
 for(const [child,pp] of parents)for(const parent of pp){if(!childMap.has(parent))childMap.set(parent,[]);childMap.get(parent).push(child)}
 let previousOrder=new Map(),maxWidth=1100;
 for(const level of [...levelMap.keys()].sort((a,b)=>a-b)){
  const group=levelMap.get(level);
  const key=p=>{
   const pp=[...parents.get(num(p.id))||[]].filter(id=>previousOrder.has(id));
   if(pp.length)return Math.min(...pp.map(id=>previousOrder.get(id)));
   // Include couples near one another when possible, without inventing ancestry.
   const spouses=[...partners.get(num(p.id))||[]].filter(id=>previousOrder.has(id));
   if(spouses.length)return Math.min(...spouses.map(id=>previousOrder.get(id)))+.2;
   return 10000;
  };
  group.sort((a,b)=>key(a)-key(b)||String(a.nombre).localeCompare(String(b.nombre),'es'));
  // Within one generation place partners adjacent if both have independent roots.
  const placed=new Set(),ordered=[];
  for(const p of group){const id=num(p.id);if(placed.has(id))continue;ordered.push(p);placed.add(id);
   const spouse=[...partners.get(id)||[]].map(x=>byId.get(x)).find(q=>q&&(depths.get(num(q.id))===level)&&!placed.has(num(q.id)));
   if(spouse){ordered.push(spouse);placed.add(num(spouse.id))}
  }
  const width=ordered.length*222;maxWidth=Math.max(maxWidth,width+80);
  ordered.forEach((p,i)=>{positions[p.id]={x:40+i*222,y:55+level*168};previousOrder.set(num(p.id),i)});
 }
 return {positions,generations:levelMap.size,people:persons.length,unconnected:persons.filter(p=>(parents.get(num(p.id))?.size||0)===0).length};
}
async function arrange(){
 const btn=$('ecoAutoGenerations');btn.disabled=true;btn.textContent='Organizando…';
 try{
  const [data,stored]=await Promise.all([get('/api/tree'),get('/api/tree/v4-state')]);
  const people=Array.isArray(data.people)?data.people:[];
  if(!people.length)throw Error('Todavía no hay familiares registrados.');
  const old=stored.state||{};
  const result=generate(people,old);
  const yes=confirm(`ECO encontró ${result.people} familiares en ${result.generations} niveles.\n\n¿Quieres reorganizar las tarjetas por generaciones?\n\nSe conservarán las fotografías y relaciones. Las posiciones manuales serán reemplazadas. Puedes volver a mover las tarjetas después.`);
  if(!yes)return;
  const state={...old,positions:result.positions,links:old.links||[],photos:old.photos||{},hiddenPeople:old.hiddenPeople||[]};
  const r=await fetch('/api/tree/v4-state',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({state})});
  if(!r.ok){let j=await r.json().catch(()=>({}));throw Error(j.error||'No se pudieron guardar las posiciones.')}
  location.reload();
 }catch(e){alert('No se reorganizó el árbol: '+e.message)}
 finally{btn.disabled=false;btn.textContent='Organizar por generaciones'}
}
function install(){
 if($('ecoAutoGenerations'))return;
 const stage=$('stage');if(!stage)return;
 const btn=document.createElement('button');btn.type='button';btn.id='ecoAutoGenerations';btn.className='btn eco-generations';btn.textContent='Organizar por generaciones';
 btn.addEventListener('click',arrange);
 const toolbar=document.querySelector('.toolbar');
 if(toolbar)toolbar.appendChild(btn);else stage.insertAdjacentElement('beforebegin',btn);
 const note=document.createElement('p');note.className='eco-generation-note';
 note.textContent='ECO puede ordenar el árbol por niveles familiares. Las personas sin parentescos registrados pueden quedar en la primera fila; completa sus vínculos para ubicarlas correctamente.';
 stage.insertAdjacentElement('afterend',note);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();

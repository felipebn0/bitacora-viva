/* ECO Árbol V7: un solo complemento para vistas, organización y etiquetas. */
(()=>{'use strict';
const $=id=>document.getElementById(id), norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase();
const E=(t,c,txt)=>{const x=document.createElement(t);if(c)x.className=c;if(txt!==undefined)x.textContent=txt;return x};
let people=[], state={}, active='family', openBranches=new Set(), principal=null, root=null, nav=null, loaded=false;
const getParents=p=>Array.isArray(p?.padres)?p.padres:(()=>{try{return JSON.parse(p?.padres||'[]')}catch{return []}})();
const byId=()=>new Map(people.map(p=>[String(p.id),p]));
function parentMap(){const names=new Map();people.forEach(p=>{const k=norm(p.nombre);names.set(k,[...(names.get(k)||[]),p])});const links=new Map();people.forEach(p=>{let result=[];for(const s of getParents(p)){const m=names.get(norm(s))||[];if(m.length===1&&m[0].id!==p.id&&!result.includes(m[0]))result.push(m[0])}links.set(String(p.id),result)});for(const l of state.links||[])if(l.type==='parent'){const a=people.find(p=>String(p.id)===String(l.a)),b=people.find(p=>String(p.id)===String(l.b));if(a&&b&&a.id!==b.id){const arr=links.get(String(b.id));if(!arr.includes(a))arr.push(a)}}return links}
const upLabel=p=>{const s=norm(p?.relacion);if(/(^|\W)(papa|padre)(\W|$)/.test(s))return 'Papá';if(/(^|\W)(mama|madre)(\W|$)/.test(s))return 'Mamá';if(s.includes('abuela'))return 'Abuela';if(s.includes('abuelo'))return 'Abuelo';return 'Progenitor/a'};
function fixLabels(){if(!loaded)return;const h=$('sideTitle')?.textContent,selected=people.filter(p=>p.nombre===h);if(selected.length!==1)return;const child=selected[0],map=parentMap(),ps=map.get(String(child.id))||[],panel=$('relations');if(!panel)return;
 for(const row of panel.querySelectorAll('.relation-row')){const sp=row.querySelector('span');if(!sp||!sp.textContent.includes(' · Padre/madre'))continue;const name=sp.textContent.split(' · Padre/madre')[0];const m=people.filter(p=>p.nombre===name);if(m.length!==1)continue;const other=m[0];let label=null;if(ps.some(p=>p.id===other.id))label=upLabel(other);else if((map.get(String(other.id))||[]).some(p=>p.id===child.id))label=/hija/.test(norm(other.relacion))?'Hija':/hijo/.test(norm(other.relacion))?'Hijo':'Hijo/a';if(label)sp.textContent=name+' · '+label;
 }}
function card(p,sub){const b=E('button','eco7-person');b.type='button';const av=E('span','eco7-avatar');const photo=state.photos?.[p.id];if(photo){const im=E('img');im.src=photo;im.alt='';av.append(im)}else av.textContent=String(p.nombre||'?').split(/\s+/).slice(0,2).map(w=>w.charAt(0)).join('').toUpperCase();const words=E('span','eco7-words');words.append(E('strong','',p.nombre||'Familiar'),E('small','',sub||p.relacion||'Familiar'));b.append(av,words);b.addEventListener('click',()=>{switchMode('tree');const el=document.querySelector('#nodes .person[data-id="'+CSS.escape(String(p.id))+'"]');el?.click();el?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'})});return b}
function personPair(pp){const wrap=E('div','eco7-pair');for(let i=0;i<pp.length;i++){if(i)wrap.append(E('span','eco7-plus','+'));wrap.append(card(pp[i]))}return wrap}
function branch(key,title,parent,parents,siblings){const sec=E('section','eco7-branch');sec.append(E('h3','',title));if(parents.length){sec.append(personPair(parents.slice(0,2)));}else sec.append(E('p','eco7-note','Faltan vínculos confirmados con los abuelos.'));
if(parent){sec.append(E('div','eco7-arrow','↓'));sec.append(card(parent))}
if(siblings.length){const show=openBranches.has(key),btn=E('button','eco7-expand',`${siblings.length} hermanos de ${title==='Familia paterna'?'papá':'mamá'} · ${show?'Ocultar':'Ver'}`);btn.type='button';btn.setAttribute('aria-expanded',String(show));btn.onclick=()=>{show?openBranches.delete(key):openBranches.add(key);render()};sec.append(btn);if(show){const group=E('div','eco7-grid');siblings.forEach(p=>group.append(card(p)));sec.append(group)}}return sec}
function render(){if(active!=='family'||!root)return;root.replaceChildren();root.append(E('h2','eco7-title','Tu familia, de un vistazo'));
if(!loaded){root.append(E('p','eco7-note','Cargando familiares…'));return}
if(!principal){root.append(E('p','eco7-note','No hay una persona principal identificada. Revisa los datos en Árbol completo.'));return}
const mp=parentMap(),anc=mp.get(String(principal.id))||[];const dad=anc.find(p=>/^(papa|padre)$/.test(norm(p.relacion)))||anc.find(p=>/(papa|padre)/.test(norm(p.relacion)))||anc[0]||null;const mom=anc.find(p=>/^(mama|madre)$/.test(norm(p.relacion)))||anc.find(p=>p!==dad)||null;
const gp=dad?(mp.get(String(dad.id))||[]):[],gm=mom?(mp.get(String(mom.id))||[]):[];
const sib=p=>{if(!p)return[];const pp=mp.get(String(p.id))||[];return people.filter(q=>q!==p&&(mp.get(String(q.id))||[]).some(x=>pp.some(y=>x.id===y.id)))};
const col=E('div','eco7-columns');col.append(branch('paternal','Familia paterna',dad,gp,sib(dad)),branch('maternal','Familia materna',mom,gm,sib(mom)));root.append(col);
const center=E('section','eco7-center');center.append(E('span','eco7-arrow','↓'),card(principal,'Persona principal'));root.append(center);
const siblings=sib(principal);if(siblings.length){const box=E('section','eco7-bottom');box.append(E('h3','','Hermanos y hermanas'));const group=E('div','eco7-grid');siblings.forEach(p=>group.append(card(p)));box.append(group);root.append(box)}
const included=new Set([principal,dad,mom,...gp,...gm,...sib(dad),...sib(mom),...siblings].filter(Boolean).map(x=>String(x.id)));const other=people.filter(p=>!included.has(String(p.id)));
if(other.length){const show=openBranches.has('others'),sec=E('section','eco7-other');const btn=E('button','eco7-expand',`${other.length} familiares adicionales · ${show?'Ocultar':'Ver todos'}`);btn.onclick=()=>{show?openBranches.delete('others'):openBranches.add('others');render()};sec.append(btn);if(show){const grid=E('div','eco7-grid');other.forEach(p=>grid.append(card(p)));sec.append(grid)}root.append(sec)}
root.append(E('p','eco7-note','Las parejas de abuelos se agrupan cuando ambas personas están registradas como progenitores. Las relaciones no confirmadas no se inventan.'));
}
function switchMode(next){active=next;const stage=$('stage'),list=$('listPanel'),grid=$('listGrid');if(!stage||!list||!root)return;
if(next==='tree')$('treeBtn')?.click();else if(next==='list')$('listBtn')?.click();
root.hidden=next!=='family';stage.classList.toggle('hidden',next!=='tree');list.classList.toggle('visible',next==='list');list.classList.toggle('hidden',next!=='list');grid?.classList.toggle('visible',next==='list');
nav?.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));
for(const id of ['zoomIn','zoomOut','zoomReset','zoomText']){const e=$(id);if(e)e.hidden=next!=='tree'}
if(next==='family')render();try{sessionStorage.setItem('eco-tree-v7-view',next)}catch{}
}
async function reload(){const [r,s]=await Promise.all([fetch('/api/tree',{credentials:'same-origin',cache:'no-store'}),fetch('/api/tree/v4-state',{credentials:'same-origin',cache:'no-store'})]);if(!r.ok||!s.ok)throw Error('No se pudieron consultar los familiares.');const data=await r.json(),settings=await s.json();people=Array.isArray(data.people)?data.people:[];state=settings.state||{};principal=people.find(p=>p.es_principal)||null;loaded=true;render();fixLabels()}
function organize(){if(!people.length)return;const mp=parentMap(),depth=new Map(people.map(p=>[String(p.id),0]));for(let i=0;i<people.length;i++){let change=false;for(const p of people)for(const parent of mp.get(String(p.id))||[]){const d=Math.min(10,(depth.get(String(parent.id))||0)+1);if(d>(depth.get(String(p.id))||0)){depth.set(String(p.id),d);change=true}}if(!change)break}
const groups=new Map();people.forEach(p=>{const lv=depth.get(String(p.id))||0;if(!groups.has(lv))groups.set(lv,[]);groups.get(lv).push(p)});const fresh={};let prev=new Map();for(const level of [...groups.keys()].sort((a,b)=>a-b)){let arr=groups.get(level);arr.sort((a,b)=>{const pa=mp.get(String(a.id))||[],pb=mp.get(String(b.id))||[];const wa=pa.length?Math.min(...pa.map(p=>prev.get(String(p.id))??1000)):1000;const wb=pb.length?Math.min(...pb.map(p=>prev.get(String(p.id))??1000)):1000;return wa-wb||String(a.nombre).localeCompare(String(b.nombre),'es')});arr.forEach((p,i)=>{fresh[p.id]={x:40+i*228,y:55+level*165};prev.set(String(p.id),i)})}
if(!confirm('¿Organizar todas las tarjetas por generaciones?\n\nSe reemplazarán las posiciones manuales. Las personas, fotos y vínculos no se modificarán.'))return;
const newState={...state,positions:fresh};fetch('/api/tree/v4-state',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:newState})}).then(async r=>{if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'No se pudo guardar');location.reload()}).catch(e=>alert(e.message));
}
function setup(){const toolbar=document.querySelector('.toolbar'),stage=$('stage');if(!toolbar||!stage)return;
for(const id of ['treeBtn','listBtn'])$(id)?.classList.add('eco7-hidden-control');$('resetPlaces')?.classList.add('eco7-hidden-control');
root=E('div','eco7-root');root.id='eco7Root';stage.insertAdjacentElement('beforebegin',root);
nav=E('div','eco7-nav');for(const [mode,label] of [['family','Vista familiar'],['list','Lista de familiares'],['tree','Árbol completo']]){const b=E('button','btn',label);b.type='button';b.dataset.mode=mode;b.onclick=()=>switchMode(mode);nav.append(b)}toolbar.append(nav);
const org=E('button','btn eco7-organize','Organizar árbol');org.type='button';org.addEventListener('click',organize);toolbar.insertBefore(org,nav);
const notice=document.querySelector('.notice');if(notice)notice.textContent='Las personas, fotografías y vínculos se guardan en tu cuenta. Organizar solo modifica las posiciones de las tarjetas.';
const observer=new MutationObserver(()=>fixLabels());observer.observe($('relations'),{childList:true,subtree:true});
const requested=(()=>{try{return sessionStorage.getItem('eco-tree-v7-view')}catch{return null}})();switchMode(['family','list','tree'].includes(requested)?requested:'family');reload().catch(e=>{loaded=true;root.append(E('p','eco7-note',e.message))});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)reload().catch(()=>{})});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();

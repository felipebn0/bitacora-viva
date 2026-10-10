/* ECO · revisión familiar V3, sin dependencias, rama pruebas. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
let candidates=[],dismissed=new Set(),busy=false;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n};
async function api(path,opts={}){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||`Error ${r.status}`);return data}
function parents(p){if(Array.isArray(p.padres))return p.padres;try{return JSON.parse(p.padres||'[]')}catch{return []}}
function note(text){const n=$('ecoFamilyV3Status');if(n)n.textContent=text}
function setBusy(value){busy=value;const b=$('ecoFamilyV3Scan');if(b)b.disabled=value}
function key(p){return p.childId+':'+p.parentId}
function render(){const out=$('ecoFamilyV3Results');if(!out)return;out.replaceChildren();const shown=candidates.filter(x=>!dismissed.has(key(x)));
 if(!shown.length){out.append(el('p','No hay vínculos pendientes en las conversaciones revisadas. Puedes volver a revisar después de contar nuevas historias.','eco-fam-empty'));return}
 for(const p of shown){const card=el('article',null,'eco-fam-card');const title=el('h3',`${p.parent} → ${p.child}`);card.append(title,el('p','Relación propuesta: progenitor/a de '+p.child));
 const quote=el('blockquote',p.evidence||'Sin fragmento de respaldo');card.append(quote);
 const tag=el('p',p.source==='natural'?'Detectado mediante interpretación de la conversación · requiere confirmación':'Expresado directamente en el relato · requiere confirmación','eco-fam-source');card.append(tag);
 const actions=el('div',null,'eco-fam-actions');const yes=el('button','Confirmar vínculo','eco-fam-confirm');const no=el('button','No corresponde','eco-fam-reject');yes.type=no.type='button';
 yes.onclick=async()=>{if(busy)return;if(!confirm(`¿Confirmas que ${p.parent} es padre o madre de ${p.child}?\n\nECO agregará este vínculo al árbol.`))return;setBusy(true);yes.disabled=true;no.disabled=true;
 try{if(p.source==='literal')await api('/api/tree/family-review/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({childId:p.childId,parentId:p.parentId})});
 else {const tree=await api('/api/tree');const child=(tree.people||[]).find(x=>Number(x.id)===Number(p.childId));const parent=(tree.people||[]).find(x=>Number(x.id)===Number(p.parentId));if(!child||!parent||norm(child.nombre)!==norm(p.child)||norm(parent.nombre)!==norm(p.parent))throw Error('Los familiares cambiaron. Revisa de nuevo antes de confirmar.');
 const old=parents(child);if(old.some(x=>norm(x)===norm(parent.nombre))){note('El vínculo ya estaba guardado.');}
 else {if(old.length>=2)throw Error('Este familiar ya tiene dos progenitores registrados. Edita sus relaciones manualmente.');
 // Source is displayed to the human; these AI-derived suggestions require explicit consent. Existing edit route records version history.
 await api('/api/tree/person/'+encodeURIComponent(child.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:child.nombre,relacion:child.relacion,padres:[...old,parent.nombre]})});}}
 candidates=candidates.filter(x=>key(x)!==key(p));render();note('Vínculo confirmado y guardado. Recarga el árbol para ver la conexión.');}
 catch(e){note('No se guardó: '+e.message);yes.disabled=false;no.disabled=false}finally{setBusy(false)}};
 no.onclick=()=>{dismissed.add(key(p));render();note('Propuesta descartada en esta revisión. No se modificó el árbol.')};actions.append(yes,no);card.append(actions);out.append(card)}
}
async function scan(){if(busy)return;setBusy(true);note('Revisando conversaciones. La interpretación con IA puede tardar un poco…');$('ecoFamilyV3Results').replaceChildren();
 try{const [literal,natural]=await Promise.allSettled([api('/api/tree/family-review'),api('/api/tree/family-review/natural',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})]);
 const map=new Map();for(const [result,source] of [[literal,'literal'],[natural,'natural']])if(result.status==='fulfilled')for(const p of result.value.proposals||[]){if(!Number.isSafeInteger(Number(p.childId))||!Number.isSafeInteger(Number(p.parentId)))continue;const item={...p,source};const k=key(item);if(!map.has(k))map.set(k,item)}
 if(literal.status==='rejected'&&natural.status==='rejected')throw Error('Ninguna revisión respondió: '+literal.reason.message+'; '+natural.reason.message);
 candidates=[...map.values()];dismissed.clear();render();const count=Math.max(literal.status==='fulfilled'?literal.value.reviewedSessions||0:0,natural.status==='fulfilled'?natural.value.reviewedSessions||0:0);
 note(`${candidates.length} propuesta(s) · hasta ${count} sesiones consultadas. ${literal.status==='rejected'||natural.status==='rejected'?'Una fuente de revisión no respondió.':''}`);
 }catch(e){note(e.message)}finally{setBusy(false)}}
function init(){const toolbar=document.querySelector('.toolbar');if(!toolbar||$('ecoFamilyV3Btn'))return;
 const old=$('ecoFamilyReviewBtn');if(old)old.remove();const oldPanel=$('ecoFamilyPanel');if(oldPanel)oldPanel.remove();
 const open=el('button','Revisar mis recuerdos','btn');open.id='ecoFamilyV3Btn';open.type='button';toolbar.append(open);
 const section=el('section',null,'eco-fam-panel');section.id='ecoFamilyV3Panel';section.hidden=true;section.append(el('h2','Vínculos de mis recuerdos'),el('p','ECO te muestra posibles relaciones con el fragmento donde las encontró. Ningún vínculo se añade sin tu confirmación.'));
 const scanBtn=el('button','Buscar relaciones pendientes','btn');scanBtn.id='ecoFamilyV3Scan';scanBtn.type='button';scanBtn.onclick=scan;section.append(scanBtn);
 const status=el('p','Pulsa Buscar para revisar las conversaciones disponibles.','eco-fam-status');status.id='ecoFamilyV3Status';status.setAttribute('role','status');section.append(status);
 const results=el('div',null,'eco-fam-results');results.id='ecoFamilyV3Results';section.append(results);
 const stage=$('stage');if(!stage)return;const main=stage.closest('main')||stage.parentElement;main.prepend(section);
 open.onclick=()=>{section.hidden=!section.hidden;open.setAttribute('aria-expanded',String(!section.hidden));if(!section.hidden)section.scrollIntoView({behavior:'smooth',block:'start'})};open.setAttribute('aria-controls',section.id);open.setAttribute('aria-expanded','false');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

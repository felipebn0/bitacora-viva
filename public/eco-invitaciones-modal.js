/* ECO Invitaciones v3 — dos decisiones claras. Conserva elementos, IDs y eventos del servidor. */
(()=>{
'use strict';
function init(){
  const trigger=document.getElementById('inviteToggle');
  const row=document.getElementById('inviteRow');
  if(!trigger||!row||document.getElementById('ecoInviteModal'))return;
  const personal=row.querySelector('.invite-personal');
  if(!personal)return;
  const code=document.createElement('div');code.className='eco-invite-code';
  [...row.children].filter(e=>e!==personal).forEach(e=>code.appendChild(e));
  row.appendChild(code);
  // Simplificamos los textos sin borrar datos ni sustituir el formulario.
  const personalIntro=personal.querySelector('p.sub');
  if(personalIntro)personalIntro.textContent='Escribe su nombre y celular. Le enviaremos un enlace personal para contar un recuerdo sin crear cuenta.';
  const codeIntro=code.querySelector('p.sub');
  if(codeIntro)codeIntro.textContent='Comparte este código con un familiar que tenga una cuenta ECO. Podrá unirse a tu bitácora y compartir recuerdos.';
  const modal=document.createElement('div');
  modal.id='ecoInviteModal';modal.className='eco-invite-overlay';modal.hidden=true;
  modal.innerHTML=`<div class="eco-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="ecoInviteTitle">
    <div class="eco-invite-heading"><div><h2 id="ecoInviteTitle">Invita a tu familia</h2><p>Las mejores historias se construyen juntos.</p></div><button type="button" id="ecoInviteClose" class="eco-invite-close" aria-label="Cerrar invitaciones">×</button></div>
    <div class="eco-invite-choices" id="ecoInviteChoices">
      <button type="button" class="eco-invite-choice" data-view="abierto"><span class="eco-invite-choice-icon" aria-hidden="true">🔗</span><span><strong>Enlace abierto para compartir</strong><small>Un solo enlace para todos: quien lo abra pone su nombre y apellido y cuenta un recuerdo en tu libro.</small></span></button>
      <button type="button" class="eco-invite-choice" data-view="whatsapp"><span class="eco-invite-choice-icon" aria-hidden="true">✉</span><span><strong>Invitar a contar un recuerdo</strong><small>Un enlace de WhatsApp para compartir una historia sin crear una cuenta.</small><span class="eco-invite-choice-action">Invitar por WhatsApp →</span></span></button>
      <button type="button" class="eco-invite-choice" data-view="codigo"><span class="eco-invite-choice-icon" aria-hidden="true">◌</span><span><strong>Vincular una cuenta familiar</strong><small>Comparte un código con alguien que ya tenga su propia cuenta ECO.</small><span class="eco-invite-choice-action eco-invite-choice-action-secondary">Ver código familiar →</span></span></button>
    </div>
    <div class="eco-invite-detail" id="ecoInviteDetail" hidden>
      <button type="button" id="ecoInviteBack" class="eco-invite-back">← Elegir otra opción</button>
      <h3 id="ecoInviteDetailTitle"></h3>
      <div id="ecoInviteMount"></div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const choices=modal.querySelector('#ecoInviteChoices'),detail=modal.querySelector('#ecoInviteDetail');
  const title=modal.querySelector('#ecoInviteDetailTitle'),mount=modal.querySelector('#ecoInviteMount');
  mount.appendChild(row);
  // Enlace abierto: lo arma el código de tu bitácora (el mismo de "Vincular una cuenta familiar").
  const abierto=document.createElement('div');abierto.className='eco-invite-abierto';abierto.hidden=true;
  abierto.innerHTML=`<p class="eco-invite-abierto-intro">Cualquiera que abra este enlace podrá contar un recuerdo en tu libro con solo escribir su <strong>nombre y apellido</strong>. No necesita crear cuenta ni clave.</p>
    <label for="ecoAbiertoUrl">Tu enlace abierto</label>
    <input type="text" id="ecoAbiertoUrl" readonly value="Cargando…">
    <div class="eco-invite-abierto-botones">
      <button type="button" id="ecoAbiertoCopiar" class="eco-invite-abierto-btn">Copiar enlace</button>
      <a id="ecoAbiertoWhatsapp" class="eco-invite-abierto-btn eco-invite-abierto-btn-claro" target="_blank" rel="noopener" href="#">Compartir por WhatsApp</a>
    </div>
    <p class="eco-invite-abierto-aviso" id="ecoAbiertoMsg" role="status"></p>
    <button type="button" id="ecoAbiertoNuevo" class="eco-invite-history-toggle">Generar un enlace nuevo</button>
    <p class="eco-invite-history-note">Si lo compartiste de más, genera uno nuevo: el anterior deja de servir y se corta el acceso de quienes entraron con él. Lo que ya contaron se queda en tu libro.</p>`;
  mount.appendChild(abierto);
  const urlInput=abierto.querySelector('#ecoAbiertoUrl'),msg=abierto.querySelector('#ecoAbiertoMsg');
  const wa=abierto.querySelector('#ecoAbiertoWhatsapp');
  let urlAbierta='';
  function pintarEnlace(code){
    urlAbierta=location.origin+'/colaborar.html?abierto='+encodeURIComponent(code);
    urlInput.value=urlAbierta;
    wa.href='https://wa.me/?text='+encodeURIComponent((document.documentElement.lang==='en'?'I invite you to tell a memory in my Eco book, you just need to enter your first and last name: ':'Te invito a contar un recuerdo en mi libro de Eco, solo tienes que poner tu nombre y apellido: ')+urlAbierta);
  }
  async function cargarEnlace(){
    msg.textContent='';
    try{
      const r=await fetch('/api/invite-code');const d=await r.json();
      if(!r.ok||!d.code)throw new Error('sin código');
      pintarEnlace(d.code);
    }catch(_){urlInput.value='';msg.textContent='No se pudo cargar el enlace. Cierra y vuelve a abrir esta ventana.'}
  }
  abierto.querySelector('#ecoAbiertoCopiar').addEventListener('click',async()=>{
    if(!urlAbierta)return;
    try{await navigator.clipboard.writeText(urlAbierta)}catch(_){urlInput.select();document.execCommand('copy')}
    msg.textContent='Enlace copiado. Pégalo donde quieras compartirlo.';
  });
  urlInput.addEventListener('focus',()=>urlInput.select());
  abierto.querySelector('#ecoAbiertoNuevo').addEventListener('click',async()=>{
    if(!confirm('Se generará un enlace nuevo. El anterior dejará de servir y se cortará el acceso de quienes entraron con él. ¿Continuar?'))return;
    msg.textContent='Generando…';
    try{
      const r=await fetch('/api/invite-code/regenerate',{method:'POST'});const d=await r.json();
      if(!r.ok||!d.code)throw new Error('sin código');
      pintarEnlace(d.code);msg.textContent='Listo: este es tu enlace nuevo.';
    }catch(_){msg.textContent='No se pudo generar el enlace nuevo. Intenta de nuevo.'}
  });
  const list=personal.querySelector('#inviteList');
  let inviteToggleButton=null,historyPanel=null;
  if(list){
    historyPanel=document.createElement('div');historyPanel.className='eco-invite-history';historyPanel.hidden=true;
    const historyTitle=document.createElement('h4');historyTitle.textContent='Mis invitaciones';
    const explanation=document.createElement('p');explanation.className='eco-invite-history-note';
    explanation.textContent='Revisa los enlaces enviados y administra sus accesos.';
    historyPanel.append(historyTitle,explanation,list);
    personal.appendChild(historyPanel);
    inviteToggleButton=document.createElement('button');inviteToggleButton.type='button';
    inviteToggleButton.className='eco-invite-history-toggle';inviteToggleButton.textContent='Mis invitaciones ▾';
    personal.insertBefore(inviteToggleButton,historyPanel);
    inviteToggleButton.addEventListener('click',()=>{
      historyPanel.hidden=!historyPanel.hidden;
      inviteToggleButton.textContent=historyPanel.hidden?'Mis invitaciones ▾':'Ocultar invitaciones ▴';
      inviteToggleButton.setAttribute('aria-expanded',String(!historyPanel.hidden));
    });
    inviteToggleButton.setAttribute('aria-expanded','false');
  }
  let previousFocus=null;
  function choose(view){
    choices.hidden=true;detail.hidden=false;
    personal.hidden=view!=='whatsapp';code.hidden=view!=='codigo';abierto.hidden=view!=='abierto';
    title.textContent=view==='whatsapp'?'Invitar a contar un recuerdo':view==='abierto'?'Enlace abierto para compartir':'Vincular una cuenta familiar';
    if(view==='abierto'){cargarEnlace();document.getElementById('ecoAbiertoCopiar')?.focus()}
    else if(view==='whatsapp')document.getElementById('inviteNombre')?.focus();
    else document.getElementById('inviteCopyBtn')?.focus();
  }
  function showChoices(){
    choices.hidden=false;detail.hidden=true;personal.hidden=true;code.hidden=true;abierto.hidden=true;
    modal.querySelector('[data-view]')?.focus();
  }
  function open(){if(!modal.hidden)return;previousFocus=document.activeElement;
    modal.hidden=false;document.body.classList.add('eco-invite-open');showChoices();
  }
  function close(){modal.hidden=true;document.body.classList.remove('eco-invite-open');
    row.style.display='none';trigger.setAttribute('aria-expanded','false');
    try{sessionStorage.removeItem('invitarAbierto')}catch(_){ }
    (previousFocus?.isConnected?previousFocus:trigger).focus();
  }
  trigger.addEventListener('click',()=>{if(modal.hidden){row.style.display='none';open()}},{capture:true});
  modal.querySelector('#ecoInviteClose').addEventListener('click',close);
  modal.querySelector('#ecoInviteBack').addEventListener('click',showChoices);
  modal.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>choose(btn.dataset.view)));
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  document.addEventListener('keydown',e=>{
    if(modal.hidden)return;
    if(e.key==='Escape'){e.preventDefault();close();return}
    if(e.key!=='Tab')return;
    const items=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')].filter(el=>el.getClientRects().length>0);
    if(!items.length)return;
    const first=items[0],last=items.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });
  const observer=new MutationObserver(()=>{if(modal.hidden&&row.style.display==='block')open()});
  observer.observe(row,{attributes:true,attributeFilter:['style']});
  if(row.style.display==='block')open();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

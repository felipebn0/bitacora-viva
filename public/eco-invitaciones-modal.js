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
    personal.hidden=view!=='whatsapp';code.hidden=view!=='codigo';
    title.textContent=view==='whatsapp'?'Invitar a contar un recuerdo':'Vincular una cuenta familiar';
    if(view==='whatsapp')document.getElementById('inviteNombre')?.focus();
    else document.getElementById('inviteCopyBtn')?.focus();
  }
  function showChoices(){
    choices.hidden=false;detail.hidden=true;personal.hidden=true;code.hidden=true;
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

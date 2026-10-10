/* ECO Invitaciones — interfaz modal conservando los controles originales. */
(() => {
  'use strict';
  function init() {
    const trigger=document.getElementById('inviteToggle');
    const row=document.getElementById('inviteRow');
    const wrap=document.querySelector('#appContent .logout-row');
    if(!trigger||!row||!wrap||document.getElementById('ecoInviteModal'))return;

    const modal=document.createElement('div');
    modal.id='ecoInviteModal';
    modal.className='eco-invite-overlay';
    modal.hidden=true;
    modal.innerHTML=`
      <div class="eco-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="ecoInviteTitle">
        <div class="eco-invite-heading">
          <div><h2 id="ecoInviteTitle">Invitar a mi círculo</h2><p>Elige cómo quieres compartir ECO.</p></div>
          <button id="ecoInviteClose" class="eco-invite-close" type="button" aria-label="Cerrar invitaciones">×</button>
        </div>
        <div id="ecoInviteChoices" class="eco-invite-choices">
          <button type="button" class="eco-invite-choice" data-view="whatsapp">
            <span class="eco-invite-choice-icon" aria-hidden="true">↗</span>
            <span><strong>Invitar por WhatsApp</strong><small>Un enlace personal para aportar historias sin crear cuenta.</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" class="eco-invite-choice" data-view="codigo">
            <span class="eco-invite-choice-icon" aria-hidden="true">#</span>
            <span><strong>Compartir código familiar</strong><small>Para que alguien con su propia cuenta se una a tu bitácora.</small></span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div id="ecoInviteDetail" class="eco-invite-detail" hidden>
          <button id="ecoInviteBack" class="eco-invite-back" type="button">← Elegir otra opción</button>
          <h3 id="ecoInviteDetailTitle"></h3>
          <div id="ecoInviteMount"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const mount=modal.querySelector('#ecoInviteMount');
    const choices=modal.querySelector('#ecoInviteChoices');
    const detail=modal.querySelector('#ecoInviteDetail');
    const detailTitle=modal.querySelector('#ecoInviteDetailTitle');
    const personal=row.querySelector('.invite-personal');
    const codeBox=document.createElement('div');
    codeBox.className='eco-invite-code';
    // Reutiliza los nodos existentes: mismos IDs y eventos.
    [...row.children].filter(n=>n!==personal).forEach(n=>codeBox.appendChild(n));
    mount.appendChild(row);
    row.appendChild(codeBox);
    let lastFocus=null;
    let selected='';
    function choose(view) {
      selected=view;
      choices.hidden=true;detail.hidden=false;
      personal.hidden=view!=='whatsapp';
      codeBox.hidden=view!=='codigo';
      detailTitle.textContent=view==='whatsapp'?'Invitación personal':'Código familiar';
      if(view==='whatsapp')document.getElementById('inviteNombre')?.focus();
      else document.getElementById('inviteCopyBtn')?.focus();
    }
    function showChoices() {
      selected='';detail.hidden=true;choices.hidden=false;
      personal.hidden=true;codeBox.hidden=true;
      modal.querySelector('.eco-invite-choice')?.focus();
    }
    function isOpen() {return row.style.display==='block';}
    function sync() {
      const open=isOpen();
      if(open && modal.hidden) {
        lastFocus=document.activeElement;
        modal.hidden=false;
        document.body.classList.add('eco-invite-open');
        showChoices();
      } else if(!open&&!modal.hidden) {
        modal.hidden=true;
        document.body.classList.remove('eco-invite-open');
        trigger.setAttribute('aria-expanded','false');
        (lastFocus?.isConnected?lastFocus:trigger).focus();
      }
    }
    function close() {
      row.style.display='none';
      trigger.setAttribute('aria-expanded','false');
      try{sessionStorage.removeItem('invitarAbierto')}catch(e){}
      sync();
    }
    modal.querySelector('#ecoInviteClose').addEventListener('click',close);
    modal.querySelector('#ecoInviteBack').addEventListener('click',showChoices);
    modal.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.view)));
    modal.addEventListener('click',e=>{if(e.target===modal)close()});
    document.addEventListener('keydown',e=>{
      if(modal.hidden)return;
      if(e.key==='Escape'){e.preventDefault();close();return}
      if(e.key==='Tab'){
        const focusables=[...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])')]
          .filter(x=>x.getClientRects().length>0);
        if(!focusables.length)return;
        const first=focusables[0],last=focusables[focusables.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
      }
    });
    // El handler original controla display y la obtención del código.
    new MutationObserver(sync).observe(row,{attributes:true,attributeFilter:['style']});
    trigger.addEventListener('click',()=>queueMicrotask(sync));
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();

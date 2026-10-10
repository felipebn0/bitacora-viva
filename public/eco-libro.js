/* ECO — Reordena solamente la presentación de Mi libro; conserva eventos/IDs. */
(() => {
  'use strict';
  function iniciar() {
    const header=document.querySelector('body > header');
    const main=document.querySelector('body > main.wrap');
    if (!header || !main || document.documentElement.dataset.ecoLibro2026) return;
    const titulo=header.querySelector('h1');
    const subtitulo=header.querySelector('p');
    const volver=header.querySelector('a.volver[href="/app.html"]');
    const historias=main.querySelector('a.volver[href="/historias.html"]');
    const toolbar=main.querySelector('.toolbar');
    if(!titulo || !subtitulo || !volver || !historias || !toolbar) return;
    const izquierda=document.createElement('div');
    izquierda.className='eco-book-title-group';
    volver.classList.add('eco-book-back');
    volver.textContent='← Volver a mi bitácora';
    izquierda.append(volver,titulo,subtitulo);
    const acciones=document.createElement('div');
    acciones.className='eco-book-header-tools';
    historias.classList.add('eco-book-btn');
    historias.textContent='Ver mis historias →';
    acciones.appendChild(historias);
    const etiqueta=toolbar.querySelector('label[for="personaSelect"]');
    if(etiqueta) etiqueta.classList.add('eco-book-narration-label');
    while(toolbar.firstChild) acciones.appendChild(toolbar.firstChild);
    header.replaceChildren(izquierda,acciones);
    toolbar.remove();
    document.documentElement.dataset.ecoLibro2026='1';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);
  else iniciar();
})();

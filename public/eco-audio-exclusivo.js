/* ECO · Reproducción exclusiva de audio.
   Cuando un <audio> inicia, pausa todos los demás de la página.
   El evento 'play' no burbujea, por eso se captura en la fase de captura. */
document.addEventListener('play', e => {
  if (e.target.tagName !== 'AUDIO') return;
  document.querySelectorAll('audio').forEach(a => { if (a !== e.target) a.pause(); });
}, true);

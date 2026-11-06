/* ECO correo de bienvenida: se envía una vez, al crear la cuenta. Su único objetivo es que la persona entienda
 * cómo funciona Eco y cuente su primera historia (el botón lleva directo a la app). */
const BASE_URL_FIJA = 'https://mieco.app';
const CORREO_DE_AYUDA = 'felipebnisperuza@hotmail.com';

const escapar = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primerNombre = (nombre) => String(nombre || '').trim().split(/\s+/)[0] || '';

// Solo vale si de verdad es una dirección web (un valor mal pegado en Vercel dejaba los enlaces rotos).
function baseUrl() {
  const configurada = String(process.env.PUBLIC_BASE_URL || '').trim();
  return (/^https?:\/\/[^\s=]+$/i.test(configurada) ? configurada : BASE_URL_FIJA).replace(/\/+$/, '');
}

const TEXTOS = {
  es: {
    asunto: 'Te damos la bienvenida a Eco: cuenta tu primera historia',
    previa: 'Solo necesitas tu voz. Tu primera historia toma unos 5 minutos.',
    saludo: (n) => (n ? `Hola, ${n}. Qué bueno tenerte en Eco.` : 'Qué bueno tenerte en Eco.'),
    intro: 'Eco guarda las historias de tu vida y de tu familia, con tu propia voz. No tienes que escribir nada: Eco te hace preguntas y tú solo cuentas.',
    titulo: 'Así funciona, en 3 pasos',
    pasos: [
      ['Presiona el círculo.', 'Eco te saluda y te hace una pregunta en voz alta.'],
      ['Cuéntale con tu voz.', 'Habla con calma, a tu ritmo. No hay respuestas correctas. Si quieres parar, vuelves a tocar el círculo.'],
      ['Tu historia queda guardada.', 'Con lo que cuentes, Eco arma tu árbol familiar y, cuando quieras, un libro con tus recuerdos que puedes escuchar y compartir.'],
    ],
    empezarTitulo: '¿Por dónde empiezo?',
    empezar: 'No te preocupes: solo ingresa y aprieta el botón. No necesitas preparar nada. Eco se encarga de guiarte para que cuentes tus propias historias tal y como las recuerdas. Es como hablar con un amigo.',
    empezarCierre: 'Eco pregunta, tú solo respondes.',
    boton: 'Contar mi primera historia',
    nota: 'Funciona desde el celular o el computador. Entra con el correo con el que te registraste y permite el micrófono la primera vez. Tus historias son privadas, y más adelante puedes invitar a tu familia a sumar sus recuerdos.',
    respaldo: 'Si el botón no se ve, copia y pega este enlace en tu navegador:',
    ayuda: `¿Dudas? Escríbenos a ${CORREO_DE_AYUDA}.`,
  },
  en: {
    asunto: 'Welcome to Eco: tell your first story',
    previa: 'All you need is your voice. Your first story takes about 5 minutes.',
    saludo: (n) => (n ? `Hi, ${n}. We're glad you're here.` : "We're glad you're here."),
    intro: "Eco keeps the stories of your life and your family, in your own voice. You don't have to write anything: Eco asks you questions and you just tell.",
    titulo: 'How it works, in 3 steps',
    pasos: [
      ['Press the circle.', 'Eco greets you and asks you a question out loud.'],
      ['Answer with your voice.', 'Speak calmly, at your own pace. There are no right answers. If you want to stop, tap the circle again.'],
      ['Your story is saved.', "With what you tell, Eco builds your family tree and, whenever you want, a book of your memories that you can listen to and share."],
    ],
    empezarTitulo: 'Where do I start?',
    empezar: "Don't worry: just log in and press the button. You don't need to prepare anything. Eco guides you so you can tell your own stories just the way you remember them. It's like talking to a friend.",
    empezarCierre: 'Eco asks, you just answer.',
    boton: 'Tell my first story',
    nota: 'It works on your phone or computer. Log in with the email you signed up with and allow the microphone the first time. Your stories are private, and later you can invite your family to add their memories.',
    respaldo: "If the button doesn't show, copy and paste this link into your browser:",
    ayuda: `Questions? Write to us at ${CORREO_DE_AYUDA}.`,
  },
};

function correoDeBienvenida({ nombre, idioma }) {
  const t = TEXTOS[idioma === 'en' ? 'en' : 'es'];
  const enlace = `${baseUrl()}/app.html`;
  const n = escapar(primerNombre(nombre));
  const fuente = 'font-family:Georgia,\'Times New Roman\',serif';
  const sans = 'font-family:Arial,Helvetica,sans-serif';
  const pasos = t.pasos.map(([titulo, texto], i) => `
        <tr>
          <td width="44" valign="top" style="padding:0 0 16px 0">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="34" height="34" align="center" bgcolor="#4F5D3A" style="background-color:#4F5D3A;border-radius:17px;${sans};font-size:16px;font-weight:bold;color:#ffffff;line-height:34px">${i + 1}</td></tr></table>
          </td>
          <td valign="top" style="padding:0 0 16px 0;${sans};font-size:16px;line-height:24px;color:#302D25"><strong>${escapar(titulo)}</strong> ${escapar(texto)}</td>
        </tr>`).join('');
  const html = `<!doctype html>
<html lang="${idioma === 'en' ? 'en' : 'es'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(t.asunto)}</title></head>
<body style="margin:0;padding:0;background-color:#F5EFE2">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F5EFE2">${escapar(t.previa)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F5EFE2" style="background-color:#F5EFE2"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px">
    <tr><td align="center" style="padding:0 0 18px 0"><img src="${baseUrl()}/images/logo-full.png" width="150" alt="Eco" style="display:block;border:0;height:auto;${fuente};font-size:30px;color:#4F5D3A"></td></tr>
    <tr><td bgcolor="#FFFDF6" style="background-color:#FFFDF6;border:1px solid #DADACA;border-radius:16px;padding:30px 28px">
      <h1 style="margin:0 0 14px 0;${fuente};font-size:26px;line-height:32px;color:#293D30;font-weight:bold">${t.saludo(n)}</h1>
      <p style="margin:0 0 26px 0;${sans};font-size:17px;line-height:26px;color:#302D25">${escapar(t.intro)}</p>
      <h2 style="margin:0 0 16px 0;${fuente};font-size:20px;line-height:26px;color:#293D30">${escapar(t.titulo)}</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${pasos}
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 28px 0"><tr>
        <td width="6" bgcolor="#B7791F" style="background-color:#B7791F;border-radius:3px">&nbsp;</td>
        <td bgcolor="#EDF0E5" style="background-color:#EDF0E5;border-radius:0 12px 12px 0;padding:20px 22px">
          <h2 style="margin:0 0 10px 0;${fuente};font-size:22px;line-height:28px;color:#293D30">${escapar(t.empezarTitulo)}</h2>
          <p style="margin:0 0 12px 0;${sans};font-size:17px;line-height:26px;color:#302D25">${escapar(t.empezar)}</p>
          <p style="margin:0;${fuente};font-size:20px;line-height:28px;font-weight:bold;color:#4F5D3A">${escapar(t.empezarCierre)}</p>
        </td>
      </tr></table>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 22px auto"><tr><td align="center" bgcolor="#4F5D3A" style="background-color:#4F5D3A;border-radius:12px"><a href="${escapar(enlace)}" style="display:inline-block;padding:16px 32px;${sans};font-size:18px;font-weight:bold;color:#ffffff;text-decoration:none">${escapar(t.boton)}</a></td></tr></table>
      <p style="margin:0 0 6px 0;${sans};font-size:14px;line-height:21px;color:#5E5848">${escapar(t.nota)}</p>
      <p style="margin:14px 0 0 0;${sans};font-size:13px;line-height:20px;color:#5E5848">${escapar(t.respaldo)}<br><a href="${escapar(enlace)}" style="color:#2F5D8A;word-break:break-all">${escapar(enlace)}</a></p>
    </td></tr>
    <tr><td align="center" style="padding:18px 8px 0 8px;${sans};font-size:13px;line-height:20px;color:#5E5848">${escapar(t.ayuda)}<br>Eco · mieco.app</td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const texto = [
    t.saludo(primerNombre(nombre)), '', t.intro, '', t.titulo + ':',
    ...t.pasos.map(([a, b], i) => `${i + 1}. ${a} ${b}`), '', t.empezarTitulo, t.empezar, t.empezarCierre, '',
    `${t.boton}: ${enlace}`, '', t.nota, '', t.ayuda,
  ].join('\n');
  return { subject: t.asunto, html, text: texto };
}

module.exports = { correoDeBienvenida };

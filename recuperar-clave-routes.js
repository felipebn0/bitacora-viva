/* ECO restablecer la clave. Cambiar la clave de alguien solo es seguro si se comprueba que es la dueña de la cuenta,
 * y eso se hace con un enlace de un solo uso enviado a su correo (recuperar-clave-correo.js). Ese envío necesita
 * un remitente propio verificado en Resend (RESEND_FROM distinto de onboarding@resend.dev, que solo puede enviar
 * al dueño de la cuenta de Resend). Mientras no esté listo, cambiar la clave desde la web queda APAGADO: antes bastaba
 * con saber el correo de alguien para quedarse con su cuenta. La persona recibe un mensaje para pedir ayuda.
 */
const CORREO_DE_AYUDA = 'felipebnisperuza@hotmail.com';
const MENSAJE_SIN_CORREO = `Por ahora no podemos cambiar la clave desde aquí. Escríbenos a ${CORREO_DE_AYUDA} desde el correo con el que te registraste y te ayudamos.`;

module.exports = (app, deps) => {
  if (deps.porCorreo) return require('./recuperar-clave-correo')(app, deps);

  const apagado = (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ error: MENSAJE_SIN_CORREO });
  };
  app.get('/api/clave/estado', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ porCorreo: false, mensaje: MENSAJE_SIN_CORREO });
  });
  app.post('/api/clave/olvide', apagado);
  app.post('/api/clave/restablecer', apagado);
};

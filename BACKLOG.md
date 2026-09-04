# Backlog — ideas pendientes para Los recuerdos de mis viejos

Cosas que se pidieron pero se decidió posponer, con suficiente detalle para retomarlas sin tener que repensarlas de cero.

## 1. Fotos/video de la familia

**Estado actual:** ya existe el backend completo (`POST /api/contribute-media`, hasta 4MB por archivo, guardado en Vercel Blob) — pero no hay ningún botón en la interfaz para usarlo. Quedó oculto desde el rediseño de la landing (31 de agosto).

**Para retomarlo:**
- Agregar de nuevo un bloque en la interfaz (en `colaborar.html` o `app.html`, según a quién se le quiera dar la opción) para subir una foto/video con una descripción de quién aparece.
- La descripción escrita ya se usa como contexto para que la IA pregunte por esa persona en la charla (`loadFamilyContext()`).
- Mejora pendiente (no implementada): que Claude además **vea la foto de verdad** (los modelos de Claude soportan visión) en vez de depender solo de la descripción escrita.

## 2. Línea de tiempo de vida (visual)

**Estado actual:** los datos sí se guardan (`timeline_events`: descripción, año, edad aproximada) y se usan puertas adentro (para inferir años, para el modo árbol), pero nunca se llegó a mostrar en pantalla — se escondió el 31 de agosto y no se retomó.

**Para retomarlo:**
- Ya existe `GET /api/tree` devolviendo también `events` — solo falta la parte visual: una lista vertical con puntos conectados, ordenada por año, en `arbol.html` o una pantalla aparte.

## 3. Ilustrar las portadas de los capítulos del libro (estilo Ghibli)

**Qué es:** que cada capítulo generado en `/capitulos.html` tenga una imagen de portada ilustrada, estilo Studio Ghibli o parecido, inspirada en el contenido del capítulo (una escena, no un intento de parecido facial real).

**Por qué no está hecho:** ninguno de los servicios ya conectados (Claude/Anthropic, ElevenLabs) genera imágenes. Hace falta contratar/conectar un servicio de generación de imágenes (ej. OpenAI `gpt-image-1`) — pendiente de que Felipe consiga una API key.

**Cómo implementarlo (cuando haya API key):**
- Nueva env var, ej. `OPENAI_API_KEY`, configurada en Vercel.
- En `POST /api/chapters/generate` (o un endpoint aparte), un llamado a la API de imágenes con un prompt armado a partir del `theme`/`title` del capítulo.
- Guardar la imagen en Vercel Blob (mismo patrón que `/api/contribute-media`), URL en columna nueva `chapters.cover_url`.
- Mostrarla arriba del título de cada capítulo en `capitulos.html`.

## 4. Colaboradores con acceso para preguntarle a la bitácora

**Qué es:** hoy los colaboradores solo pueden **aportar** información (contar historias); no pueden hacerle preguntas a la bitácora de la persona principal (`POST /api/ask-familia` está bloqueado explícitamente para ellos con un 403).

**Para retomarlo:** definir qué significa "acceso especial" — ¿lo habilita el dueño de la bitácora por colaborador? ¿es automático después de cierto tiempo o cierta cantidad de aportes? Falta esa decisión de producto antes de tocar código.

## 5. ~~Colaborador invitado sin cuenta propia ("guest")~~ — hecho

**Qué es:** hoy hace falta registrarse (usuario + clave) para poder colaborar con una historia. La idea es un modo más liviano: alguien recibe el código de invitación, entra sin crear cuenta, dice su nombre una sola vez, y aporta.

**Resuelto:** `/api/guest-code-info` + `/api/guest-start` (server.js) — sesión de invitado firmada igual que una sesión normal, sin fila en `users`. `app.html` genera un link de WhatsApp directo (`colaborar.html?codigo=...`) junto al código. `colaborar.html` muestra una pantalla liviana (solo nombre) en vez del login cuando llega con `?codigo=`. Cubierto por `test/guest.smoke.js`.

**Pendiente relacionado:** migrar los archivos ya subidos con `access:'public'` de antes del arreglo de seguridad — ver ítem 9.

## 6. Mejorar automáticamente el parentesco que detecta el árbol

**Qué es:** hoy, si la IA arma mal el parentesco de alguien (por ejemplo lo pone como "tío" cuando en realidad es "primo"), la única forma de corregirlo es a mano con el lápiz (✏️) en `arbol.html`. La idea pospuesta es que el propio sistema pudiera inferir/corregir esto solo con más contexto.

## 7. Varias parejas por persona (medios hermanos)

**Qué es:** el árbol ya no se rompe cuando alguien tuvo hijos con más de una pareja (antes causaba un error que impedía cargar el árbol) — pero el dibujo solo puede unir a una persona con **una** pareja mediante la línea horizontal de matrimonio. Si alguien tuvo hijos con dos o tres personas distintas, esos otros vínculos existen en los datos (cada hijo sabe quiénes son sus dos padres, si ambos están registrados) pero no se dibuja una línea de pareja adicional para cada una — visualmente se ve como una sola familia, aunque el parentesco de cada hijo hacia su padre/madre real sí es correcto.

**Para retomarlo:** decidir cómo representar visualmente a alguien con varias parejas en la misma fila del árbol (¿varias líneas cortas hacia cada pareja? ¿un ícono que indique "más de una familia"?) antes de tocar el código de dibujo.

## 8. Reactivar el límite de intentos de login por cuenta

**Qué es:** en `/api/login` (server.js) había un límite de 10 intentos fallidos por cuenta cada 15 minutos (`limitePorClave`), además del límite por IP que sigue activo. Se desactivó (comentado, no borrado) porque bloqueó a Felipe mientras recuperaba su propia clave.

**Para retomarlo:** descomentar las dos líneas marcadas en `/api/login` cerca de `limitePorClave(\`login:...\`)`. Antes de reactivarlo, considerar un tiempo de espera más corto o un mensaje que aclare cuánto falta, para que no vuelva a pasar lo mismo.

## 9. Terminar de verdad la migración a Blob privado (hoy vuelto a público)

**Qué pasó:** se subió `access:'private'` en los 3 uploads (audio/fotos) y en la lectura de `/api/media-file`, pero en producción esto rompía TODO upload (500: *"Vercel Blob: Cannot use private access on a public store. The store must be configured with private access."*). El store de Vercel Blob conectado a este proyecto es del tipo público de siempre — `access:'private'` por upload no alcanza, el STORE ENTERO tiene que estar configurado como privado. Se revirtieron los 3 `put()` a `access:'public'` para que guardar audio/fotos vuelva a funcionar mientras tanto — confirmado con un pago de un familiar real que fallaba con este mismo error.

**Para terminarlo bien:**
1. En el dashboard de Vercel → Storage → el store de Blob de este proyecto → confirmar si tiene una opción para habilitar acceso privado, o si hace falta crear un store NUEVO con esa opción activada desde el principio (Vercel lo separa por tipo de store, no es un toggle en cualquiera).
2. Si hace falta un store nuevo: actualizar `BLOB_READ_WRITE_TOKEN` en Vercel para que apunte a ese store nuevo.
3. Recién ahí, volver a poner `access: 'private'` en los 3 `put()` de server.js (buscar "TEMPORAL: vuelto a 'public'" — quedaron marcados con un comentario para encontrarlos fácil).
4. Los archivos que se suban MIENTRAS tanto (con este revert) quedan públicos de verdad — sumarlos a la migración pendiente de abajo cuando se haga.

**Migración de los ya subidos (público → privado), una vez el store lo soporte:** un script/endpoint temporal (protegido con SETUP_KEY, con "dry run" por defecto — mismo patrón ya usado antes en este proyecto) que recorra `story_log.audio_url`, `family_notes.audio_url`/`audio_urls` y `media.url`, baje cada archivo, lo vuelva a subir con `access:'private'`, actualice la fila con la nueva ruta, y borre la copia pública vieja. Hacerlo de a poco y con logs claros — son archivos reales de familias reales.

## 11. Poner en marcha de verdad los pagos (Wava) y los recordatorios (correo)

**Qué es:** la infraestructura completa ya está construida y con tests (`/api/billing/*` incluyendo el regalo con comprador y narrador en cuentas distintas, `/api/webhooks/wava`, `/api/cron/*`, `/api/notification-preferences`, `/api/magic-login`, tablas `subscriptions`/`billing_orders`/`notification_preferences`/`reminder_deliveries`/`gift_redemptions`) — pero no está conectada a nada real todavía. Sin las variables de entorno de abajo, `/api/billing/checkout` (y `/api/billing/gift-checkout`) responde 501 y los recordatorios simplemente no se mandan — no rompe nada, solo no hace nada.

**Para ponerlo en marcha:**
1. Crear cuenta en Wava (app.dev.wava.co para pruebas primero) y sacar el `merchant-key` desde Settings → Integrations → API.
2. Configurar el webhook en el dashboard de Wava apuntando a `https://bitacora-viva.vercel.app/api/webhooks/wava`, y copiar el secreto que da ahí.
3. Crear cuenta en Resend (o el proveedor de correo que se prefiera — el código solo usa su API REST directa, se puede cambiar `enviarCorreo()` en `server.js` por otro proveedor sin tocar el resto) y sacar su API key.
4. Agregar en Vercel (Settings → Environment Variables), **nunca por acá**: `WAVA_MERCHANT_KEY`, `WAVA_WEBHOOK_SECRET`, `WAVA_API_BASE` (usar `https://api.dev.wava.co/v1` mientras se prueba, `https://api.wava.co/v1` en real), `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET` (cualquier string largo al azar, propio, no el de Wava).
5. Probar un pago de punta a punta contra el sandbox de Wava (`Test Data` en su documentación) antes de pasar a `WAVA_API_BASE` de producción.
6. Pendiente de la propia recomendación de seguridad de Wava: además de verificar la firma del webhook (ya hecho), confirmar el pago llamando `GET /v1/orders/{orderId}` antes de darlo por bueno — no se agregó todavía por no tener credenciales reales contra las cuales probarlo.
7. Los crons (`/api/cron/reminders` y `/api/cron/billing`) ya están declarados en `vercel.json` — arrancan solos apenas se despliegue con un plan de Vercel que incluya Cron Jobs.

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
4. Agregar en Vercel (Settings → Environment Variables), **nunca por aquí**: `WAVA_MERCHANT_KEY`, `WAVA_WEBHOOK_SECRET`, `WAVA_API_BASE` (usar `https://api.dev.wava.co/v1` mientras se prueba, `https://api.wava.co/v1` en real), `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET` (cualquier string largo al azar, propio, no el de Wava).
5. Probar un pago de punta a punta contra el sandbox de Wava (`Test Data` en su documentación) antes de pasar a `WAVA_API_BASE` de producción.
6. Pendiente de la propia recomendación de seguridad de Wava: además de verificar la firma del webhook (ya hecho), confirmar el pago llamando `GET /v1/orders/{orderId}` antes de darlo por bueno — no se agregó todavía por no tener credenciales reales contra las cuales probarlo.
7. Los crons (`/api/cron/reminders` y `/api/cron/billing`) ya están declarados en `vercel.json` — arrancan solos apenas se despliegue con un plan de Vercel que incluya Cron Jobs.

## 12. ~~Subperfiles: administrar y pagar la cuenta de otra persona desde la propia~~ — hecho (en `pruebas`)

**Qué es (pedido de Felipe, 2026-09-07):** hoy cada cuenta es su propia bitácora, sin relación entre sí más allá de "colaborar" (aportar historias a la de otro) o el código de regalo (una cuenta paga la suscripción de otra, pero son cuentas separadas, con login separado). Lo que se pide es distinto: que desde el login/perfil de una persona (ej. Felipe) se puedan administrar varios "subperfiles" — cuentas de otras personas (ej. sus papás) que él mismo crea, paga, y administra sin que esa persona necesite su propio usuario/clave para nada del lado de la plata o la cuenta. Ya se había hablado de esto de forma informal (ver la charla sobre "puedo crear mi cuenta pero que sea para mi papá") — la respuesta de ese momento fue que hoy alcanza con poner el nombre/fecha de nacimiento del papá en el perfil de una cuenta que Felipe controla, sin necesitar una cuenta separada. Este pedido es más ambicioso: quiere VARIAS bitácoras independientes (una por cada padre, por ejemplo) administradas y pagadas desde un solo login.

**Por qué no es trivial:** todo el modelo de datos actual (`users`, `subscriptions`, `billing_orders`) asume una fila de `users` = una cuenta = una bitácora = una suscripción. Esto es un cambio de forma, no un campo nuevo:
- Hace falta un concepto nuevo de "cuenta administradora" con una o más bitácoras dependientes (parecido a `owner_user_id` que ya existe para colaboradores 100%, pero ahí el colaborador NO tiene su propia bitácora — aquí cada subperfil SÍ necesita ser una bitácora completa e independiente, con su propio árbol/capítulos/historias).
- Facturación: ¿la suscripción es por cuenta administradora (paga un solo plan y cubre a todos sus subperfiles) o por subperfil (una suscripción por cada uno, pero cobradas todas a la misma tarjeta)? Define precio y cómo se factura.
- Login: la cuenta administradora inicia sesión una vez y elige a qué subperfil entrar (como elegir perfil en Netflix), sin que cada subperfil tenga su propio usuario/clave — o el subperfil SÍ tiene su propio login pero delega el pago/administración a la cuenta principal (más parecido a una familia de Google/Apple). Decidir cuál de los dos antes de tocar el esquema.
- Qué puede hacer la cuenta administradora en cada subperfil: ¿solo pagar y ver, o también entrar a charlar POR esa persona (como si fuera ella)? Esto último ya tiene un riesgo señalado antes: quien tenga el teléfono en la mano durante una charla es a quien realmente le pregunta la IA.

**Decisiones ya tomadas (Felipe, 2026-09-07):**
- **Login:** un solo login con selector de perfiles (estilo Netflix). Felipe inicia sesión con SU usuario/clave y elige a qué bitácora entrar — el papá nunca necesita su propio usuario/clave.
- **Facturación:** una sola suscripción cubre todos los subperfiles administrados (no una por cada uno).
- **Alcance:** la cuenta administradora solo puede pagar y ver las bitácoras que administra — NO puede narrar/grabar charlas COMO si fuera esa persona (evita mezclar de quién es realmente la voz que le contesta a la IA).

**Resuelto (2026-09-07, rama `pruebas`):** tabla nueva `bitacoras` (id, admin_user_id, nombre, fecha_nacimiento, tree_pending_names, aportes_pending_names, narrador_code) — el id de cada subperfil sale de la MISMA secuencia que `users.id`, así la bitácora PROPIA de cada cuenta existente sigue siendo, sin ningún cambio, el mismo `users.id` de siempre (cero filas de contenido migran, cero backfill). `req.profileUserId` (ya existía) es ahora la costura real entre "cuenta que loguea" (`req.userId`) y "bitácora activa" — se ensanchó su uso a las ~20 rutas de contenido (charla, árbol, capítulos, historias, export) en vez de crear un concepto nuevo.

Rutas nuevas: `POST/GET /api/subprofiles` (crear/listar), `POST /api/subprofiles/switch` (cambiar de perfil — re-firma la cookie con `activeBitacoraId`, revalidado en cada request), `GET/POST /api/subprofiles/:id/narrador-link` + `/regenerate` + `/revoke` (el link permanente sin cuenta), `GET /api/narrador-code-info` + `POST /api/narrador-start` (mismo patrón que el invitado clásico de BACKLOG #5, pero narra su PROPIA bitácora en `story_log`, no un aporte a la de otro — `req.isCollaborator=false` a propósito para esa sesión, para no quedar bloqueada de narrar). `bloquearSiNoPuedeNarrar` (nuevo middleware) es lo que impide a la cuenta administradora narrar como el subperfil (`/api/next`, `/api/save`, `/api/save-audio`), sin bloquearla de ver/exportar.

Frontend: sección "Perfiles" en el panel de Cuenta de `app.html` (crear/listar/cambiar + compartir el link por WhatsApp), banner + orbe oculto cuando hay un subperfil activo, pantalla de entrada del narrador (`?codigo=`, mismo patrón que `colaborar.html`), y manifest dinámico (`/manifest.json`) + botón "agregar a la pantalla de inicio" para que el link del narrador se pueda instalar como ícono propio en el celular.

**Actualizado (2026-09-07): un subperfil SÍ acepta aportes de otros familiares**, igual que una cuenta normal (pedido de Felipe: "el perfil debería verse y funcionar igual, solo que es un subperfil del administrador que sí puede controlar todo"). `bitacoras` ganó su propio `invite_code` (mismo mecanismo que `users.invite_code`) — `/api/invite-code` y `/api/invite-code/regenerate` ahora operan sobre la bitácora ACTIVA (`req.profileUserId`/`req.bitacoraEsPropia`), no siempre sobre la cuenta que loguea, así que tanto la administradora (cambiada al subperfil) como el narrador de su propio link pueden generarlo y compartirlo. `/api/guest-code-info` y `/api/guest-start` ahora buscan el código primero en `users` y después en `bitacoras` (`buscarDuenoPorInviteCode`); la sesión de invitado clásico lleva un flag nuevo (`ownerEsBitacora`) para que `requireAuth` revalide contra la tabla correcta en cada request. La campanita de "Aportes" (`aportes_pending_names`) también funciona para un subperfil.

Pendiente/fuera de alcance de esta vuelta (no adivinado, dejado explícito):
- `/api/join-collaboration` y `/api/signup` con `accountType=collaborator` (una cuenta COMPLETA sumándose como colaboradora fija) siguen buscando el código solo en `users` — una cuenta completa todavía no puede unirse como colaboradora permanente de un subperfil, solo el camino de invitado sin cuenta (`/api/guest-start`) lo soporta.
- El ícono 🤝 "Colaborar" (unirse a la historia de OTRA persona) sigue oculto en la sesión del narrador — Felipe confirmó que lo que necesitaba era lo de arriba (que a SU bitácora le aporten), no esto.
- Reiniciar (`/api/reset-bitacora`) o borrar un subperfil no tiene ruta propia todavía — se bloqueó explícitamente en vez de adivinar si la administradora debería poder hacerlo.
- Recordatorios por correo (`notification_preferences`) quedaron por LOGIN, no por bitácora — no fue reconfirmado explícitamente con Felipe.
- Probado con `test/subperfiles.smoke.js` + toda la suite existente (26 archivos, 0 fallos) — falta la prueba manual real en `pruebas` (crear un subperfil, generar el link, narrar desde otro navegador/dispositivo).

## 13. Canciones (Spotify/YouTube) como aporte de la familia — hecho, guardado en el tag `canciones-aporte`

**Qué es:** que una colaboradora pueda dejar el link "para compartir" de una canción (ej. "La guirnalda" de Rocío Dúrcal, que la abuela y la mamá cantan juntas) como parte de un recuerdo, y que la bitácora la traiga a colación en el chat cuando la persona vuelve a abrir la app — igual que ya pasa con una foto/video, pero sin subir ningún archivo: se guarda el link para EMBEBER esa plataforma (Spotify o YouTube), la canción en sí nunca pasa por el servidor.

**Estado:** implementado y probado de punta a punta (commit `a56c64d`, 2026-09-08) — no está en `main` a propósito (Felipe pidió dejarlo en el backlog, 2026-09-08). La rama `pruebas` se reseteó para quedar igual que `main`, así que el commit ya NO vive en ninguna rama: quedó guardado en el tag anotado `canciones-aporte` (subido a origin) para no perderlo.

**Lo que trae, para cuando se retome:**
- `server.js`: `extraerEmbedDeCancion()`/`urlEmbedCancionValida()` — allowlist cerrada de hosts (`open.spotify.com`, `youtube.com`/`youtu.be`/`music.youtube.com` para el link que se pega; `open.spotify.com` y `youtube-nocookie.com` para el link de embeber que de verdad se guarda). Nuevo `POST /api/contribute-song`. `limpiarMediaAdjunta()` gana el tipo `'cancion'` con su propia validación. CSP: nuevo `frame-src` acotado a esos dos hosts de embeber.
- `colaborar.html`: botón "🎵 agregar una canción de este recuerdo" junto al de foto/video.
- `app.html` / `colaboraciones.html`: el visor de "media del momento" y la galería de aportes pintan un `<iframe>` para `type:'cancion'` en vez de `<img>`/`<video>`.
- Tests: `test/contribute-song.smoke.js`, `test/contribute-draft.smoke.js` extendido, `test/cancion-aporte.playwright.js` (las 3 pantallas de punta a punta).

**Para retomarlo:** `git cherry-pick canciones-aporte` (el tag apunta a `a56c64d`) — va a pedir resolver conflictos a mano en `server.js`, `app.html`, `colaboraciones.html`, `colaborar.html`, `package.json` y `vercel.json`, porque para esa fecha `main` ya tenía cambios propios en esos mismos archivos (auditoría de Diego, 2026-09-08). Correr toda la batería de tests después de resolver.

## 14. Completar los perfiles de los familiares desde el árbol genealógico

**Qué es** (pedido de Felipe, 2026-09-08): hoy el árbol solo guarda nombre, parentesco y de quién es hijo/a cada persona — lo mínimo para dibujar las líneas. La idea es poder entrar a cada persona del árbol y sumarle más contexto (a qué se dedicaba, cómo era, fechas importantes, anécdotas sueltas) directamente ahí, en vez de que ese detalle solo pueda salir mencionado de pasada en una charla grabada.

**Para retomarlo:** definir primero qué campos tiene sentido guardar por persona (¿texto libre tipo nota, o campos estructurados?) y si ese contexto debería usarse como pista para la IA en las charlas (parecido a como ya se usa `family_members` hoy) antes de tocar el esquema de `family_members`.

## 15. API para canciones (en vez de pegar el link a mano)

**Qué es** (pedido de Felipe, 2026-09-08): sigue del ítem 13 de este backlog — hoy, para sumar una canción como aporte, hay que pegar el link "para compartir" de Spotify/YouTube a mano. La idea es poder buscar la canción por nombre/artista (una API de búsqueda, ej. la API de Spotify) y elegirla de una lista, en vez de tener que ir a buscar y copiar el link en otra pestaña.

**Para retomarlo:** primero traer el ítem 13 a `main` (es la base sobre la que esto se construye). Después, sumar credenciales de la API elegida (ej. Spotify Web API — requiere client id/secret) y un endpoint de búsqueda del lado del servidor (nunca exponer las credenciales al navegador).

## 16. "Tenés un mensaje nuevo" — notas de voz cortas, distintas de una historia

**Qué es** (pedido de Felipe, 2026-09-08): hoy la única forma de dejarle algo a la bitácora de otra persona es "aportar una historia" (la charla completa con la entrevistadora). La idea es un camino más liviano: grabar y mandar una nota de voz corta, tipo saludo o mensaje puntual ("te quiero", "feliz cumpleaños"), que le llegue a la persona como una sorpresa — sin pasar por toda la charla de aportar.

## 17. "Audio de regalo" de la historia terminada — con la voz IA expresiva (ElevenLabs v3)

**Qué es** (pedido de Felipe, 2026-09-10): hoy la voz IA (ElevenLabs Flash v2.5) se usa solo para la charla en vivo — está elegida por su velocidad (empieza a hablar en ~120 ms), no por lo expresiva. La idea es que, una vez la historia está escrita (capítulos/libro), se pueda generar aparte un audio narrado lindo y cálido de esa historia, tipo regalo para escuchar o compartir, usando el modelo **ElevenLabs v3** (más emotivo, pensado para audio grabado, no para responder al momento — su lentitud no importa aquí).

**Por qué no se usa v3 en la charla:** v3 tarda de 1 a varios segundos en arrancar cada respuesta y su voz puede cambiar de tono entre turnos; rompería la conversación en vivo, que ya cuesta afinar (silencios, tiempos). Ver la comparación de modelos en el plan de negocios (2026-09-10).

**Para retomarlo:** definir si el audio se genera por capítulo o de la historia completa, dónde se guarda (Blob, como el resto del audio) y si es una función incluida o un add-on pago. Costo estimado de v3: tarifa estándar de ElevenLabs (más créditos por caracter que Flash) — recalcular sobre el largo real del libro antes de fijar precio.

**Para retomarlo:** definir cómo se le avisa a la persona que tiene "un mensaje nuevo" (¿un ícono con notificación, como ya existe para Aportes/Árbol? ¿se reproduce dentro de la charla, como ya pasa con una foto pendiente?) y si esto necesita una tabla nueva o puede apoyarse en `family_notes`/`media` con un campo que distinga "mensaje corto" de "historia".

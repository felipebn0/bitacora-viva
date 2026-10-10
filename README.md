# Eco

Compañero de charlas por voz para registrar la historia de vida de tu papá.

## Antes de arrancar

1. Abre `.env` y reemplaza `pega_aqui_tu_key_nueva` por tu API key de Claude.
2. (Opcional pero recomendado) Configurá la voz natural con Azure Speech — ver abajo. Sin esto, la app usa la voz del sistema (más robótica) como respaldo automático.

### Conseguir la voz natural (ElevenLabs, gratis) — recomendado

Más simple que Azure: solo mail y contraseña, sin tarjeta para el nivel gratis (10.000 caracteres/mes, suficiente para probar).

1. Ve a [elevenlabs.io](https://elevenlabs.io) → **Sign up**.
2. Una vez adentro, ve a **Voices** (menú lateral) → **Voice Library**.
3. Busca "Spanish" o "Colombia" en el buscador y escucha candidatas hasta encontrar una que te convenza. Click en **Add to My Voices** en la que elijas.
4. Ve a **My Voices**, abre esa voz, y copia su **Voice ID** (aparece en la info de la voz o en el botón "Copy ID").
5. Ve a tu perfil (ícono arriba a la derecha) → **API keys** → crea una y cópiala.
6. Pega en `.env`:
   - `ELEVENLABS_API_KEY` → tu API key
   - `ELEVENLABS_VOICE_ID` → el Voice ID que copiaste
   - `ELEVENLABS_VOICE_ID_MASCULINA` (opcional) → la segunda voz, para quien elija "Masculina" en Opciones avanzadas > Voz. Si no la pones, usa `57D8YIbQSuE3REDPO6Vm`. La elección se guarda por bitácora (`users.voz` / `bitacoras.voz`), `POST /api/voz`; `/api/speak` recibe `voz` con cada audio. Con voz masculina la IA también habla de sí misma en masculino ("entrevistador"). `/api/admin/voz-debug` prueba las dos voces.
7. Reiniciá el servidor.

Si el uso diario supera el nivel gratis, el plan Starter son $5 USD/mes (30.000 caracteres) — igual muy barato para este uso.

**Modelo de voz:** por defecto la app usa **Eleven v4 Turbo** (`eleven_v4_turbo`): más expresivo que Flash, mismo precio de lista ($0,04 por 1.000 caracteres) pero más lento (~1,8 s contra ~0,6 s por frase). Para cambiarlo sin tocar código, definir `ELEVENLABS_MODEL_ID` en Vercel (por ejemplo `eleven_flash_v2_5` para volver al rápido) y hacer Redeploy. Si el modelo elegido falla, la app reintenta una vez con Flash v2.5 antes de caer a la voz del sistema. La llave necesita permiso de *Text to Speech* y *Speech to Text*.

### Alternativa: Azure Speech

Si prefieres la voz colombiana específica de Microsoft (`es-CO-SalomeNeural`) y puedes acceder a Azure:

1. [portal.azure.com](https://portal.azure.com) → crear cuenta.
2. Busca **"Speech service"** → **Create**. Región, por ejemplo **East US**; **Pricing tier**: **Free F0**.
3. En el recurso creado → **Keys and Endpoint** → copia **KEY 1** y la **Region**.
4. Pegalos en `.env` como `AZURE_SPEECH_KEY` y `AZURE_SPEECH_REGION`.

La app usa ElevenLabs si está configurado; si no, prueba con Azure; si ninguno está configurado, usa la voz del sistema como respaldo.

## Instalar (una sola vez)

```bash
cd "/Users/felipebernal/Claude Code/bitacora-viva"
npm install
```

## Correr

```bash
npm run dev
```

Abre **Chrome** en [http://localhost:3000/app.html](http://localhost:3000/app.html) (Chrome es el que mejor soporta el micrófono del navegador). La raíz (`http://localhost:3000`) muestra la landing pública con el registro; `/app.html` es la herramienta en sí.

## Cómo se usa

1. Presionás el botón.
2. Claude saluda y empieza a preguntar — primero quién es y su familia, después su vida.
3. Respondés hablando (o escribiendo, con "prefiero escribir").
4. Al terminar la charla, queda guardada en `bitacora.json`.

## Dónde queda guardado

Todo se guarda en la nube (Postgres + Vercel Blob), no en archivos locales — así funciona igual corriendo en tu Mac o desplegado en Vercel.

- **Transcript (texto):** cada charla se agrega como una fila nueva en la tabla `sessions` de la base de datos, con fecha y toda la conversación.
- **Audio de tu papá:** cada respuesta hablada se sube a Vercel Blob y queda referenciada en el campo `audioFile` de esa respuesta.
- **Audio de las preguntas (la voz que le habla a él):** solo se sube si configuraste ElevenLabs o Azure — la voz del sistema no se puede capturar.
- **Resumen (la memoria):** en la tabla `resumen`. Se actualiza solo al final de cada charla — Claude relee el resumen anterior + la charla nueva, y arma uno actualizado. Así la próxima charla no repite lo ya sabido, y las preguntas de la familia son rápidas de responder sin tener que releer todo. Si una pregunta de la familia necesita un detalle muy específico que el resumen no tiene, el sistema va solo a buscarlo en las charlas completas.

## Pendientes

- Configurar ElevenLabs o Azure para que la voz sea más natural (pasos más abajo) — hasta entonces usa la voz del sistema.

## Desplegar en Vercel

1. Sube el proyecto a un repo de GitHub (privado) si todavía no lo hiciste.
2. Ve a [vercel.com](https://vercel.com) → **Add New** → **Project** → elige ese repo → **Import**. No hace falta tocar nada de la configuración de build (no hay build).
3. Antes de desplegar (o después, desde la pestaña **Storage** del proyecto):
   - **Storage → Create Database → Postgres (Neon)** → conectala al proyecto. Esto agrega sola la variable `DATABASE_URL`.
   - **Storage → Create Database → Blob** → conectala al proyecto. Esto agrega sola la variable `BLOB_READ_WRITE_TOKEN`.
4. En **Settings → Environment Variables**, agrega a mano:
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID` (si los usas)
5. **Deploy**. Cada vez que hagas `git push`, Vercel despliega solo la nueva versión.
6. Las tablas de la base de datos se crean solas la primera vez que la app las necesita (al presionar el botón por primera vez) — no hay que correr ninguna migración a mano.

### Para seguir corriendo local además de en Vercel

Copia `DATABASE_URL` y `BLOB_READ_WRITE_TOKEN` desde **Storage** en el dashboard de Vercel (click en cada base → **.env.local** o **Quickstart**) y pegalos en tu `.env` local. Sin esto, `npm run dev` sigue prendiendo pero las charlas no se van a poder guardar.

### Almacenamiento de archivos: Cloudflare R2 (opcional, recomendado a partir de cierto uso)

Los audios, fotos y videos van a Vercel Blob por defecto. El plan gratis de Vercel Blob tiene un cupo bajo de **operaciones** (2.000/mes) que se topa rápido — cada subida y **cada lectura** de un archivo cuenta. Cloudflare R2 da 10 millones de operaciones/mes gratis y **no cobra transferencia nunca**.

Si se definen estas 5 variables de entorno, la app usa R2 para todo lo nuevo (lo que ya está en Vercel Blob se sigue leyendo de ahí, se detecta por la URL):

| Variable | De dónde sale |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare → R2 → arriba a la derecha, "Account ID". |
| `R2_BUCKET` | El nombre del bucket que creaste (ej. `bitacora-viva`). |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → **Manage R2 API Tokens** → **Create API Token** (permiso *Object Read & Write*, alcance ese bucket). El secret solo se muestra una vez. |
| `R2_PUBLIC_URL` | En el bucket → **Settings** → **Public access** → activa **R2.dev subdomain** (o conecta un dominio propio). Es la URL `https://<algo>.r2.dev`, sin barra al final. |

Con las 5 puestas y un Redeploy, las subidas nuevas van a R2. Si falta alguna, sigue todo por Vercel Blob como antes. No hay que migrar los archivos viejos.

## Velocidad del turno (de que la persona calla a que la IA habla)

Un turno son 5 pasos en fila: **silencio de espera** (`SILENCE_MS`, 2 s: tiene que pasar sin voz antes de dar la respuesta por terminada) → **transcribir** (`/api/transcribe`, ~1 s) → **la IA** (`/api/next`: lecturas a la base + Claude) → **la voz** (`/api/speak`) → reproducir. Qué se hizo para acortarlo (2026-10-08):

1. **Transcribir sin recodificar.** Antes, cada turno decodificaba la grabación y la volvía a codificar como WAV sin comprimir (~10 veces más pesado) solo para recortar ~2 s de silencio (ahorro: ~$0,0001). Ahora se manda la grabación tal cual.
2. **La subida del audio ya no bloquea a la IA.** Se sube en paralelo con `/api/next` (que guarda la historia sin audio) y, cuando las dos terminan, `POST /api/story-log/audio` enlaza el audio con la historia. En `colaborar.html`, la subida y la transcripción van en paralelo.
3. **La voz se pide en dos pedazos a la vez** (primera frase y resto): suena apenas está lista la primera. La voz tiene su propio cupo de pedidos (`voz:`, 120/min) para poder hacerlo sin gastar los 30/min generales.
4. **Lecturas en paralelo** en `/api/next` (resumen, contexto familiar) en vez de una tras otra.
5. **Medición.** `/api/transcribe`, `/api/next` y `/api/speak` devuelven el header `Server-Timing` (F12, Network, el pedido, Timing) y dejan una línea `[latencia] ruta=… total=…ms db=… claude=…` en los logs de Vercel: así se ve dónde se va el tiempo de verdad.
6. La voz del sistema de respaldo (cuando falla ElevenLabs) nunca prefiere una voz argentina.
7. **Respuesta en streaming** (`/api/next` con `stream: true`, `app.html`). El servidor contesta una línea de JSON por evento: `frase` (oraciones ya listas), `fin` (el mensaje final con todo el postproceso y `restante`, lo que falta por decir) o `error`. El cliente (`iniciarHabla`) pide la voz de cada frase apenas llega y las reproduce en orden, mientras Claude sigue escribiendo. Solo se adelantan oraciones seguras: sin `[FIN]`/`[PAUSA]`, sin voseo ni argentinismos y nada después de la primera pregunta (la regla de "una sola pregunta" y la corrección de dialecto se deciden con el mensaje entero). Sin `stream`, la ruta contesta el JSON de siempre. `colaborar.html` (`/api/contribute-chat`) todavía no lo usa.
8. **Primera oración más temprana.** El emisor adelanta oraciones desde 10 letras (antes 25: la reacción corta de siempre, "Qué bello.", nunca salía antes) y, si una oración larga todavía no termina, la adelanta hasta su primera coma cuando ya lleva 35 letras.
9. **Respuesta especulativa** (`app.html`, `iniciarEspeculacion`). Cuando la persona ya habló y lleva 900 ms callada (`ESPECULAR_MS`), sin detener la grabación se transcribe lo grabado hasta ahí, se pide la respuesta con `/api/next` + `especulativo: true` (que no guarda nada ni marca notas) y se va pidiendo la voz de cada frase. Si a los 2 s (`SILENCE_MS`) no volvió a hablar, ese turno usa lo ya hecho: no vuelve a transcribir, y la respuesta y la voz ya vienen adelantadas. El guardado de la historia se confirma con `POST /api/next/guardar`. Si vuelve a hablar, todo se descarta (se gasta una transcripción y una respuesta de más; máximo 2 intentos por turno). No se especula en el primer turno, con fotos pendientes, en el modo árbol, con una nota de un familiar por contar ni cuando toca ofrecer la pausa; en esos casos el turno sigue por el camino de siempre.
10. **Cupo propio para los pedidos del turno** (`rateLimitTurno`, 90/min por IP): transcribir, `/api/next`, `/api/next/guardar`, subir el audio y enlazarlo. Con los 30/min generales una charla ágil (o varias personas en la misma red del celular) se topaba con el 429 y la app mostraba "problema en el servidor". El cliente además reintenta una vez un 429 o un 5xx antes de mostrar el error, y el mensaje trae el código HTTP.
11. **Menos cortes entre audios.** Cada pedazo de voz es un archivo aparte y en el celular se nota el corte o un clic entre uno y otro, así que como mucho 2 pedazos salen antes del final y el resto del mensaje va en un solo audio.
12. **Sin la cola del último audio** (`RECORTE_FIN_VOZ_MS`, 120 ms, en `app.html`): algunos audios de voz terminan con un poco de estática después de la última palabra y en el celular se oía justo al final de lo que dice la IA. Solo se recorta el último pedazo de cada respuesta. Si no es suficiente, probar `ELEVENLABS_MODEL_ID=eleven_flash_v2_5` en Vercel para saber si la estática viene de v4 Turbo.

Lo que más pesa y es decisión de producto: el **modelo de voz** (`ELEVENLABS_MODEL_ID`: Flash v2.5 genera ~1,2 s más rápido que v4 Turbo) y los **2 s de silencio** (bajarlo más corta a quien piensa a mitad de frase; ver el comentario junto a `SILENCE_MS` en `app.html`). Tests: `test/velocidad-turno.smoke.js`.

## Consumo del árbol genealógico (cómo se mantiene bajo)

El árbol se actualiza solo en cada guardado de charla (`/api/save`, función `updateFamilyTree` en `server.js`) con una llamada a Claude. Para que cueste poco:

1. **Solo se procesa lo nuevo.** `sessions.arbol_procesado` guarda cuántos mensajes de esa sesión ya pasaron por el árbol; un guardado repetido (pausa, avance parcial, cierre) manda solo lo que falta. Si la llamada falla, no se marca como procesado y se reintenta en el siguiente guardado.
2. **Se salta la llamada** si lo nuevo no tiene pistas de familia ni de hitos (`hayPistasDeFamiliaOHitos`: parentescos, nombres propios, años, "nací", "me casé"…). Queda la línea `[arbol-consumo] … salto=sin-pistas` en los logs.
3. **Entrada compacta:** lo ya conocido viaja como líneas `id | nombre | parentesco | detalles | padres` (no JSON) y de la entrevistadora solo se manda el final de cada pregunta.
4. **Claude devuelve solo los CAMBIOS** (personas/eventos nuevos o modificados, con su `id`, más `quitar_personas`/`quitar_eventos`), no la lista completa — la salida es lo más caro y antes crecía con el tamaño de la familia. `aplicarCambiosDelArbol` los junta con lo que ya había; los ids son el número de línea (no el nombre: dos personas pueden llamarse igual) y si Claude repite a alguien conocido sin id se actualiza esa misma fila en vez de duplicarla.
5. **Si no cambió nada, no se reescribe la base** (`[arbol-consumo] … sin-cambios`).
6. Tope de salida de 3.000 tokens (antes 8.000) y regla de idioma corta para esta llamada.

Con una familia de ~30 personas y 20 hitos, y una sesión guardada 3 veces, la estimación pasa de ~$0,058 a ~$0,016 por sesión (~72 % menos). El consumo real se ve en `/admin.html` (tipo `arbol`). Tests: `test/arbol-consumo.smoke.js`.

El **resumen de memoria** (`updateMemorySummary`, tipo `resumen` en el panel) usa la misma idea y el mismo test:

- Solo procesa lo nuevo de cada sesión (`sessions.resumen_procesado`).
- Si lo que dijo la persona en lo nuevo son menos de 120 caracteres, **espera**: no llama a Claude y no lo marca como procesado, así que se junta con el siguiente guardado (nada se pierde).
- Claude devuelve **solo las viñetas nuevas** (o `SIN_CAMBIOS`) y se agregan al final del resumen (tope de salida 300 tokens, antes 700). Solo cuando el resumen pasa de ~2.800 caracteres se hace la reescritura completa de antes (máx. 400 palabras) para consolidarlo — el resumen viaja en cada turno de la charla, así que tiene que seguir siendo corto.
- Líneas de log: `[resumen-consumo] … modo=delta|completo|sin-cambios` y `salto=pocos`.

Estimación para una charla de 30 intercambios guardada 3 veces: resumen ~$0,021 → ~$0,0095 (~55 % menos); árbol + resumen juntos, de ~$0,079 a ~$0,026 por charla (~68 % menos). Son estimaciones con un caso modelado: el consumo real se ve en `/admin.html`.

## Español de Colombia, 100%

Todo lo que la app *dice o escribe* va en español de Colombia con tuteo: nunca voseo ("tenés", "contame", "vos"), ni argentinismos ("che", "acá", "re lindo", "auto"), ni "vosotros". Está garantizado en tres capas:

1. **Regla explícita en cada prompt.** `REGLA_ESPANOL_COLOMBIANO` (en `server.js`) se suma a los 9 system prompts de Claude (charla, árbol, aportes, resumen, capítulos, clasificación, extracción) y a los dos correctores. Para cambiar la regla se edita en un solo lugar.
2. **Corrección automática.** Lo que la IA le dice a la persona en la charla (`/api/next`) y en los aportes (`/api/contribute-chat`) pasa por `asegurarEspanolColombiano`: si el detector (`detectarFueraDeColombia`) encuentra algo, se pide una reescritura mínima y, si esa falla, se reemplaza de forma determinista. Cada activación deja una línea `[dialecto]` en los logs de Vercel.
3. **Tests.** `test/espanol-colombiano.smoke.js` falla si algún prompt queda sin la regla o si una página trae voseo; `test/next.smoke.js` prueba la corrección en vivo.

**Lo que NO se toca:** lo que dice la persona (su transcripción y sus citas) se conserva tal cual. En Colombia el voseo es real en varias regiones (Antioquia, Valle, Eje Cafetero…): quien dice "vos" no está hablando argentino. La transcripción la hace ElevenLabs (`scribe_v1`, `language_code: spa`) y es literal.

## Privacidad de los archivos (audios, fotos, videos)

La landing promete que los archivos son privados y que no existe un enlace público. Para que sea verdad hacen falta **dos pasos que no se pueden hacer desde el código**:

1. **Apagar el acceso público del bucket de R2.** Cloudflare → R2 → el bucket → **Settings** → **Public access** → en *R2.dev subdomain* pulsar **Disable** (y no tener ningún *Custom Domain* conectado). La app no necesita ese acceso: lee y borra siempre con sus llaves (`aws4fetch`, firmado), y solo entrega un archivo por `/api/media-file` después de comprobar sesión y permiso. **No** borrar `R2_PUBLIC_URL` de Vercel: se sigue usando para armar la URL que se guarda en la base.
2. **Pasar lo viejo de Vercel Blob (público) a R2.** Todo lo subido antes de activar R2 vive en un store de Blob público de verdad. Con la sesión de un admin abierta en la app, desde la consola del navegador:

```js
// 1) Solo contar (no toca nada) — también dice si R2 sigue abierto al público.
await fetch('/api/admin/migrar-blob-a-r2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json())
// 2) Migrar un lote (máx. 30 archivos por pedido). Repetir hasta que el paso 1 dé 0 en todo.
await fetch('/api/admin/migrar-blob-a-r2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmar: true, limite: 10 }) }).then(r => r.json())
```

Cada archivo se copia a R2 con la misma clave, se cambia la URL en todas las filas que lo usan (`story_log`, `family_notes`, `media`) y recién después se borra el original de Blob; si algo falla queda tal cual y aparece en `fallidas`. Cuando el paso 1 dé `r2PublicoAbierto: false` y 0 filas pendientes, el store de Blob puede vaciarse.

## Panel de consumo (`/admin.html`)

Reporte de uso y costo estimado por perfil (cuenta dueña o subperfil): tokens de Claude (incluida la parte de prompt caching), caracteres de voz (ElevenLabs/Azure), tiempo hablado, y espacio ocupado en la base de datos. Pensado para los dueños del producto, no para cuentas normales.

**Dar acceso a alguien:** no hay botón para esto a propósito — se activa con un `UPDATE` directo en la base (Neon → **Query** en el dashboard de Vercel, o cualquier cliente de Postgres):

```sql
UPDATE users SET is_admin = true WHERE email = 'correo-de-la-persona@ejemplo.com';
```

La cuenta tiene que existir primero. Una vez marcada, al loguearse le va a aparecer un link a `/admin.html`.

**Tarifas usadas para estimar el costo en $:** configurables por variable de entorno — sin configurar, usa valores de referencia que conviene ajustar a la factura real:

- `ANTHROPIC_INPUT_PRICE_PER_1M` / `ANTHROPIC_OUTPUT_PRICE_PER_1M` — USD por millón de tokens de entrada/salida de Claude.
- `ANTHROPIC_CACHE_WRITE_PRICE_PER_1M` / `ANTHROPIC_CACHE_READ_PRICE_PER_1M` — tarifa de los tokens de prompt caching que usa `/api/next` (ver el comentario junto a `cache_control` en server.js). Sin configurar, se calculan como 1.25x/0.1x del precio de entrada normal (las proporciones típicas de Anthropic).
- `ELEVENLABS_PRICE_PER_1K_CHARS` / `ELEVENLABS_PRICE_PER_HOUR_STT` — USD por 1000 caracteres de voz (TTS) / por hora de transcripción (STT). Esta app llama a la API de ElevenLabs (no el plan de consumidor con "créditos") — esa tarifa es la misma sin importar el plan contratado (Free/Starter/Creator/...), confirmado por Felipe el 2026-10-08 contra su cuenta: **$0.04/1000 caracteres** (Flash v2.5 y v4 Turbo; antes se usaba $0.05) y $0.22/hora (Scribe v1). **Promoción:** Eleven v4 Turbo cuesta $0.011/1000 caracteres hasta el 12 de octubre de 2026; mientras dure, y solo si ese es el modelo en uso (`ELEVENLABS_MODEL_ID`), el costo que registra el panel usa esa tarifa y después vuelve solo a $0.04. Si se define `ELEVENLABS_PRICE_PER_1K_CHARS`, esa manda sobre todo.
- `ADMIN_ALERT_THRESHOLD_USD_30D` (opcional) — si un perfil supera este monto en el rango de fechas elegido en el panel, se resalta con un aviso. Sin configurar, no se resalta a nadie.

El consumo de Claude/voz solo queda registrado desde que se activó esta medición (no hay forma de reconstruir tokens de charlas viejas); el tamaño en la base de datos, en cambio, se calcula sobre los datos tal como están hoy, así que sí incluye lo histórico.

Si se edita el `<script>`/`<style>` de `admin.html`, correr `node tools/actualizar-hashes-vercel.js` antes de commitear (mismo criterio que el resto de `public/`, ver `test/hashes-csp-vercel.smoke.js`).

## Marca: Eco

La app se llama **Eco** (manual de marca de octubre 2026). Slogan principal: "Lo que cuentas, se queda." Colores: musgo `#4F5D3A`, crema `#F6EEDC`, dorado `#D9A441` (acento sobre musgo), ocre `#B7791F` (acento sobre crema), musgo oscuro `#3B4429`, arena `#EADFC4`, tierra `#5B5A44`. Tipografías del manual: Fraunces SemiBold (títulos) y Lora Medium (texto); la app todavía usa las suyas.

**Logo:** tres anillos de árbol concéntricos (radios 28, 50 y 72 en una grilla de 200, trazo de 12 con puntas redondeadas, abertura del 28% girada 12° hacia afuera en cada anillo) y un punto central dorado de radio 13. Los archivos están en `public/images/eco/` (SVG: ícono, ícono invertido, ícono mínimo para menos de 16 px, símbolo, horizontal, y sus versiones clara y de una sola tinta) y en `public/images/` (PNG: `favicon-16/32/192/512`, `apple-touch-icon`, `logo-icon`, `logo-full`). La palabra "Eco" va convertida a trazos. Todo se regenera con `node tools/generar-logos-eco.js` (la geometría está en ese archivo). No estirar, recolorear, ponerle sombras ni ondas de sonido; tamaño mínimo: 16 px el símbolo, 120 px el horizontal.

**El botón de hablar es el logo animado** (`app.html`, animación "Una gota que despierta el eco"): en el turno de la persona (`data-state="listening"`) corre la intro (cae la gota, salen las ondas, los anillos se abren) y luego el punto late y las ondas hacen vibrar los anillos; en el turno de la IA (`speaking`/`thinking`) los anillos se cierran y el botón se pone negro; al volver el turno de la persona la animación arranca otra vez. Tiempos del original por 0,7. Con "reducir movimiento" queda quieto. La pantalla principal cabe en una sola vista sin scroll y el botón crece con el alto de la ventana (150 a 400 px). Pruebas: `npm run test:orbe` y `npm run test:pantalla`.

**Link viejo -> link nuevo.** Las páginas estáticas las sirve Vercel sin pasar por Express, así que para que quien tiene el link viejo (`bitacora-viva.vercel.app`) entre al nuevo hacen falta dos cosas: (1) en Vercel, la variable `DOMINIO_NUEVO` (ej. `eco.co`); (2) en `vercel.json`, al principio de `routes`: `{ "src": "/(.*)", "has": [{ "type": "host", "value": "bitacora-viva.vercel.app" }], "dest": "/api/redirigir-dominio?ruta=$1" }`. Esa ruta responde una redirección permanente (308) al dominio nuevo conservando la ruta y los parámetros (`?invitacion=`, `?codigo=`, el token de un enlace mágico viejo). No agregar la regla de `vercel.json` antes de tener el dominio nuevo y la variable puesta: sin ellas el sitio viejo dejaría de abrir. Las sesiones no pasan de un dominio a otro: quien ya había entrado tendrá que iniciar sesión de nuevo.

## Invitados con enlace personal (SEC-002A / SEC-002B / SEC-002C)

Quien aporta historias **sin cuenta** entra con un enlace personal que crea el dueño (o quien administra el subperfil) desde "Invitar a mi círculo a colaborar": escribe el **nombre y el celular** de la persona, la app crea `/colaborar.html?invitacion=…` y abre WhatsApp con el chat de ese número y el mensaje ya escrito. El celular es único por bitácora (tabla `invitados`); el mismo celular es la misma persona.

- La sesión del invitado lleva un `guestId` y cada aporte guarda `family_notes.guest_id`: dos invitados llamados igual **no** ven ni tocan los aportes del otro (antes se comparaba por nombre).
- El dueño puede **quitar el acceso** (corta la sesión en el siguiente pedido; los aportes se conservan) o dar un **enlace nuevo** (mismo `guestId`, recupera sus aportes).
- El código familiar ya **no** sirve para entrar sin cuenta (`POST /api/guest-start` pide `invitacion`); sigue sirviendo para registrarse con cuenta y para colaboradores con cuenta. Rotar el código familiar no corta a los invitados personales; quitar su acceso sí.
- Las sesiones de invitado anteriores (firmadas con el código familiar, sin `guestId`) siguen funcionando hasta que expiren (30 días) o se rote el código familiar, y solo ven los aportes viejos sin `guest_id` de su mismo nombre.
- Cerrar o actualizar un borrador de aporte (`/api/contribute-chat`, `draftId`) exige ser quien lo escribió (`contributed_by` / `guest_id`); un `draftId` ajeno no modifica nada y se guarda como aporte nuevo.
- **Archivos (SEC-002B):** `/api/media-file` ya no deja a un colaborador o invitado abrir cualquier archivo de la familia. El dueño (y quien administra el subperfil, y el narrador de su propio enlace) ve todo; un colaborador solo ve lo que subió él. Cada subida de aporte lleva la huella de quien la hizo en la ruta (`audio/aportes/<dueño>/<huella>/…`, `media/<dueño>/<huella>/…`; `u<id>` cuenta, `g<id>` invitación personal), y los archivos de antes de las huellas se reconocen solo si aparecen en sus propios aportes. Así un aporte privado de otra persona nunca le llega a nadie más que a su autor y al dueño.

## Recordatorios (correo + WhatsApp asistido)

Cada día (Vercel Cron → `GET /api/cron/reminders`, 14:00 UTC = 9:00 Colombia) la app busca a quién le toca un recordatorio para seguir contando su historia:

- **Por correo** (lo de siempre): a cada cuenta que no eligió WhatsApp, vía Resend (`RESEND_API_KEY`, `RESEND_FROM`). El usuario prende/apaga esto y elige cada cuántos días desde el menú de Cuenta.
- **Por WhatsApp** (envío manual asistido, mientras hay pocos usuarios): la app **no** le escribe a los usuarios. Arma **un solo resumen para el dueño del producto** con la lista de a quién le toca y un enlace `wa.me` por persona que abre el chat con el mensaje ya redactado; el dueño abre cada uno y toca enviar desde su WhatsApp Business. El resumen llega por dos canales (los dos opcionales, se pueden usar juntos):

| Variable | Para qué |
|---|---|
| `CALLMEBOT_PHONE` | Número del dueño (con código de país) al que llega el resumen por WhatsApp. |
| `CALLMEBOT_APIKEY` | Clave de [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/). Se obtiene una sola vez: agendas el número que indica su página, le mandas por WhatsApp `I allow callmebot to send me messages`, y te responde con la clave. Servicio gratuito de terceros, uso personal, con tope de mensajes al día — un resumen diario está muy por debajo. |
| `WHATSAPP_DIGEST_EMAIL` | Correo del dueño para recibir el mismo resumen por correo (necesita `RESEND_API_KEY`). Sirve de respaldo si CallMeBot falla. |

Si no se configura ninguno de los tres, el cron sigue mandando los recordatorios por correo normalmente y el resumen de WhatsApp no se manda.

**Cargar los números:** en `/admin.html`, sección "Recordatorios por WhatsApp", hay una tabla para escribir el teléfono de cada perfil (cuenta o subperfil) y marcar quién quiere el recordatorio por ese canal. Los usuarios también lo pueden poner ellos desde su perfil. Quien tiene WhatsApp activo **no** recibe el recordatorio por correo, para no avisar dos veces. Desde esa misma sección se puede ver a quién le toca hoy y disparar el resumen a mano (botón "Enviar el resumen ahora"). Para probar sin esperar los 14 días de inactividad, marca **"ignorar los días de espera"** — incluye a cualquier perfil con número + opt-in activo (respeta igual a quien haya apagado los recordatorios).

### Envío automático con la API oficial de WhatsApp (Meta)

Con `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` configurados, el cron diario **le escribe directo a cada persona** con opt-in + teléfono, usando una plantilla aprobada por Meta. Lo que Meta rechaza (número inválido, sin WhatsApp, plantilla caída) cae en el resumen manual de arriba, y solo se registra en `whatsapp_reminder_log` lo que Meta aceptó (así cada persona espera su frecuencia). Máximo 200 por corrida. El botón de prueba de `/admin` nunca escribe a los usuarios, solo arma el resumen.

| Variable | Para qué |
|---|---|
| `WHATSAPP_TOKEN` | Token permanente de un usuario del sistema de Meta Business (no el token temporal de 24 h del panel de pruebas). |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business (no es el teléfono: es el ID que muestra el panel de WhatsApp en Meta for Developers). |
| `WHATSAPP_TEMPLATE_NAME` | Nombre de la plantilla aprobada. Por defecto `recordatorio_bitacora`. |
| `WHATSAPP_TEMPLATE_LANG` | Idioma con el que se creó la plantilla. Por defecto `es_CO`. |
| `WHATSAPP_API_VERSION` | Versión de la API de Graph. Por defecto `v21.0`. |

**Pasos (una sola vez):**
1. En Meta Business Suite: crear la cuenta de WhatsApp Business con El Rebusuque SAS y verificar la empresa.
2. Registrar un número dedicado (que no esté en WhatsApp personal).
3. Crear la plantilla `recordatorio_bitacora` (idioma Español - Colombia, categoría **Utilidad**; Meta puede reclasificarla como Marketing, que cuesta más). Cuerpo, con una sola variable:
   `Hola {{1}}, ¿cómo vas? Hace unos días no grabas una historia en tu bitácora. Cuando tengas un ratico, entra y cuéntame algo, no tiene que ser largo. Si prefieres no recibir estos avisos, apágalos en tu perfil. Un abrazo.`
   y esperar la aprobación.
4. Crear un usuario del sistema con token permanente (permisos `whatsapp_business_messaging` y `whatsapp_business_management`) y pegar las variables en Vercel.
5. En `/admin`, la sección de WhatsApp debe mostrar "Envío automático" en verde. Probar con tu propio número (opt-in + teléfono) y mirar el JSON del cron (`whatsappApi`).

El número tiene que traer código de país; un celular colombiano de 10 dígitos que empieza por 3 se completa con 57. Todavía no se procesan las respuestas de la gente (no hay webhook): quien no quiere más avisos los apaga en su perfil.

## Botón físico

### Paso 1: detectar qué tecla manda tu encoder

Antes de tocar la Raspberry Pi, prueba el encoder en tu Mac:

1. Conecta el encoder USB (con el botón ya cableado) a un puerto USB de tu computadora.
2. Abre `http://localhost:3000/app.html` en Chrome y abre la consola (`Cmd+Option+J`).
3. Pega esto en la consola y presiona Enter:
   ```js
   document.addEventListener('keydown', (e) => console.log('Tecla detectada:', e.key));
   ```
4. Presioná el botón físico. La consola te va a mostrar algo como `Tecla detectada: Enter` o `Tecla detectada: 1`.
5. Si no es `Enter`, abre [app.html](public/app.html), busca la línea `const BUTTON_KEY = 'Enter';` y reemplázala por la tecla que detectaste (por ejemplo `'1'` o `' '` para espacio).

Con esto ya puedes probar toda la charla apretando solo el botón físico, sin tocar la pantalla.

### Paso 2: instalar todo en la Raspberry Pi

1. Instala Raspberry Pi OS (con escritorio) con el [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. Copia esta carpeta `bitacora-viva` a la Pi (por USB, o `scp`, o clonando un repo si lo subes a GitHub).
3. En la Pi: `npm install` y prueba `npm run dev` para confirmar que arranca igual que en tu Mac.
4. Conecta el micrófono/parlante USB y el encoder con el botón.
5. Para que la Pi prenda directo en la charla, sin que nadie tenga que abrir nada:
   - Service de systemd para que el servidor arranque solo al prender la Pi (le paso el archivo cuando lleguemos a este paso).
   - Chromium en "modo kiosco" (pantalla completa, sin barra de direcciones) apuntando a `http://localhost:3000/app.html` (no a la raíz, que ahora muestra la landing pública), configurado para abrir solo al encender.
6. La pantalla es opcional: la charla funciona por voz y el botón. Si no quieres pantalla, alcanza con que Chromium corra en segundo plano (headless) mientras el audio funcione igual.

Avisame cuando tengas la Pi en mano y armamos el paso 2 en detalle (el service de systemd y el modo kiosco exactos dependen de qué versión de Raspberry Pi OS instales).

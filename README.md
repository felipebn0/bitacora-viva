# Bitácora Viva

Compañero de charlas por voz para registrar la historia de vida de tu papá.

## Antes de arrancar

1. Abrí `.env` y reemplazá `pega_aqui_tu_key_nueva` por tu API key de Claude.
2. (Opcional pero recomendado) Configurá la voz natural con Azure Speech — ver abajo. Sin esto, la app usa la voz del sistema (más robótica) como respaldo automático.

### Conseguir la voz natural (ElevenLabs, gratis) — recomendado

Más simple que Azure: solo mail y contraseña, sin tarjeta para el nivel gratis (10.000 caracteres/mes, suficiente para probar).

1. Andá a [elevenlabs.io](https://elevenlabs.io) → **Sign up**.
2. Una vez adentro, andá a **Voices** (menú lateral) → **Voice Library**.
3. Buscá "Spanish" o "Colombia" en el buscador y escuchá candidatas hasta encontrar una que te convenza. Click en **Add to My Voices** en la que elijas.
4. Andá a **My Voices**, abrí esa voz, y copiá su **Voice ID** (aparece en la info de la voz o en el botón "Copy ID").
5. Andá a tu perfil (ícono arriba a la derecha) → **API keys** → creá una y copiala.
6. Pegá en `.env`:
   - `ELEVENLABS_API_KEY` → tu API key
   - `ELEVENLABS_VOICE_ID` → el Voice ID que copiaste
7. Reiniciá el servidor.

Si el uso diario supera el nivel gratis, el plan Starter son $5 USD/mes (30.000 caracteres) — igual muy barato para este uso.

### Alternativa: Azure Speech

Si preferís la voz colombiana específica de Microsoft (`es-CO-SalomeNeural`) y podés acceder a Azure:

1. [portal.azure.com](https://portal.azure.com) → crear cuenta.
2. Buscá **"Speech service"** → **Create**. Región, por ejemplo **East US**; **Pricing tier**: **Free F0**.
3. En el recurso creado → **Keys and Endpoint** → copiá **KEY 1** y la **Region**.
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

Abrí **Chrome** en [http://localhost:3000](http://localhost:3000) (Chrome es el que mejor soporta el micrófono del navegador).

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

1. Subí el proyecto a un repo de GitHub (privado) si todavía no lo hiciste.
2. Andá a [vercel.com](https://vercel.com) → **Add New** → **Project** → elegí ese repo → **Import**. No hace falta tocar nada de la configuración de build (no hay build).
3. Antes de desplegar (o después, desde la pestaña **Storage** del proyecto):
   - **Storage → Create Database → Postgres (Neon)** → conectala al proyecto. Esto agrega sola la variable `DATABASE_URL`.
   - **Storage → Create Database → Blob** → conectala al proyecto. Esto agrega sola la variable `BLOB_READ_WRITE_TOKEN`.
4. En **Settings → Environment Variables**, agregá a mano:
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID` (si los usás)
5. **Deploy**. Cada vez que hagas `git push`, Vercel despliega solo la nueva versión.
6. Las tablas de la base de datos se crean solas la primera vez que la app las necesita (al presionar el botón por primera vez) — no hay que correr ninguna migración a mano.

### Para seguir corriendo local además de en Vercel

Copiá `DATABASE_URL` y `BLOB_READ_WRITE_TOKEN` desde **Storage** en el dashboard de Vercel (click en cada base → **.env.local** o **Quickstart**) y pegalos en tu `.env` local. Sin esto, `npm run dev` sigue prendiendo pero las charlas no se van a poder guardar.

## Botón físico

### Paso 1: detectar qué tecla manda tu encoder

Antes de tocar la Raspberry Pi, probá el encoder en tu Mac:

1. Conectá el encoder USB (con el botón ya cableado) a un puerto USB de tu computadora.
2. Abrí `http://localhost:3000` en Chrome y abrí la consola (`Cmd+Option+J`).
3. Pegá esto en la consola y presioná Enter:
   ```js
   document.addEventListener('keydown', (e) => console.log('Tecla detectada:', e.key));
   ```
4. Presioná el botón físico. La consola te va a mostrar algo como `Tecla detectada: Enter` o `Tecla detectada: 1`.
5. Si no es `Enter`, abrí [index.html](public/index.html), buscá la línea `const BUTTON_KEY = 'Enter';` y reemplazala por la tecla que detectaste (por ejemplo `'1'` o `' '` para espacio).

Con esto ya podés probar toda la charla apretando solo el botón físico, sin tocar la pantalla.

### Paso 2: instalar todo en la Raspberry Pi

1. Instalá Raspberry Pi OS (con escritorio) con el [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. Copiá esta carpeta `bitacora-viva` a la Pi (por USB, o `scp`, o clonando un repo si lo subís a GitHub).
3. En la Pi: `npm install` y probá `npm run dev` para confirmar que arranca igual que en tu Mac.
4. Conectá el micrófono/parlante USB y el encoder con el botón.
5. Para que la Pi prenda directo en la charla, sin que nadie tenga que abrir nada:
   - Service de systemd para que el servidor arranque solo al prender la Pi (le paso el archivo cuando lleguemos a este paso).
   - Chromium en "modo kiosco" (pantalla completa, sin barra de direcciones) apuntando a `http://localhost:3000`, configurado para abrir solo al encender.
6. La pantalla es opcional: la charla funciona por voz y el botón. Si no querés pantalla, alcanza con que Chromium corra en segundo plano (headless) mientras el audio funcione igual.

Avisame cuando tengas la Pi en mano y armamos el paso 2 en detalle (el service de systemd y el modo kiosco exactos dependen de qué versión de Raspberry Pi OS instales).

# Backlog — ideas pendientes para Bitácora Viva

Cosas que se pidieron pero se decidió posponer, con suficiente detalle para retomarlas sin tener que repensarlas de cero.

## 1. Árbol genealógico + línea de tiempo (panel derecho, desktop)

**Qué es:** mientras se charla, ir armando automáticamente:
- Un árbol genealógico visual con la gente que se va mencionando (papás, hermanos, abuelos, tíos, pareja, hijos…).
- Una línea de tiempo de la vida (eventos con año o edad aproximada, cuando se pueda inferir).

Ambos en un panel a la derecha, visible solo en pantallas de escritorio (como ya pasa con "Preguntale a la bitácora").

**Cómo implementarlo (ya pensado):**
- El resumen actual (`resumen`) es texto libre — no sirve para dibujar un árbol. Hace falta que Claude devuelva **datos estructurados**, no prosa.
- Usar **tool use forzado** de Claude (`tool_choice: { type: 'tool', name: '...' }`) con un schema tipo:
  ```
  personas: [{ nombre, relacion, detalles? }]
  eventos: [{ descripcion, anio?, edad_aprox? }]
  ```
  Esto es mucho más confiable que pedirle un formato en texto (ya tuvimos problemas con marcadores tipo `[HISTORIA]` que Claude no respetaba siempre — con tool use forzado no falla).
- Se dispara junto con `updateMemorySummary`, en paralelo (`Promise.all`), cada vez que se guarda una charla (`/api/save`). Recibe: la lista de personas/eventos ya conocidos + la charla nueva, y devuelve la lista completa actualizada (reemplazo total, más simple que hacer diff).
- Tablas nuevas: `family_members` (user_id, nombre, relacion, detalles) y `timeline_events` (user_id, descripcion, anio, edad_aprox).
- Rutas nuevas: `GET /api/family-tree`, `GET /api/timeline`.
- Frontend: reestructurar el layout a dos columnas en desktop (breakpoint ancho, ~900px+); árbol como filas por generación (abuelos / padres y tíos / hermanos y pareja / hijos), agrupando por palabras clave en `relacion`; timeline como lista vertical con puntos conectados, ordenada por año.
- Recordar sumar estas tablas a `/api/reset-bitacora` para que el reinicio las borre también.

## 2. Fotos/video de la familia + que la IA pregunte por las personas que aparecen

**Estado actual:** ya existe el backend completo (`/api/contribute-media`, tabla `media`, hasta 4MB por archivo) y ya se usa la **descripción escrita** de la foto como contexto para que Claude pregunte por ella — pero la parte de subir foto/video está **oculta en la interfaz** por ahora (solo queda visible el aporte de historias en texto).

**Para retomarlo:**
- Volver a mostrar el bloque `#aportePhotoBlock` en `public/index.html` (está comentado/oculto, no borrado).
- Ya funciona el flujo básico: se sube la foto con una descripción de quién aparece, y `loadFamilyContext()` la usa para que Claude pregunte por esa persona en algún momento de la charla.
- Mejora pendiente (no implementada): que Claude además **vea la foto de verdad** (los modelos de Claude soportan visión) en vez de depender solo de la descripción escrita — se decidió no hacerlo al principio por simplicidad, pero quedó como posible mejora si la descripción escrita no alcanza.

## 3. Ilustrar las portadas de los capítulos del libro (estilo Ghibli)

**Qué es:** que cada capítulo generado en `/capitulos.html` tenga una imagen de portada ilustrada, estilo Studio Ghibli o parecido, inspirada en el contenido de ese capítulo (no un retrato real de la persona — se decidió que sea una escena inspirada en la historia, no un intento de parecido facial, para evitar el riesgo de que la IA distorsione la cara de alguien real).

**Por qué no está hecho:** ninguno de los servicios ya conectados (Claude/Anthropic, ElevenLabs) genera imágenes. Hace falta contratar/conectar un servicio de generación de imágenes (ej. OpenAI `gpt-image-1`) — pendiente de que Felipe consiga una API key.

**Cómo implementarlo (cuando haya API key):**
- Nueva env var, ej. `OPENAI_API_KEY`, configurada en Vercel.
- En `POST /api/chapters/generate` (o en un endpoint aparte, ej. `POST /api/chapters/:id/cover`), después de armar el `generated_text` de cada capítulo, un llamado a la API de imágenes con un prompt armado a partir del `theme`/`title` del capítulo (nunca texto libre sin filtrar — resumir a un prompt corto y seguro), pidiendo estilo "Studio Ghibli watercolor illustration" o similar.
- Guardar la imagen resultante en Vercel Blob (mismo patrón que `media`/`put()` ya usado en `/api/contribute-media`), y la URL en una columna nueva `chapters.cover_url`.
- Frontend (`capitulos.html`): mostrar la imagen arriba del título de cada capítulo.
- Importante: no hace falta pedir foto del protagonista para esto (se descartó el enfoque "parecido a la foto real" por ser más caro y menos confiable) — si más adelante se quiere retomar esa idea, ver la nota de "Fotos/video de la familia" en la sección 2 de este mismo backlog (ya existe el flujo de subida de fotos con descripción).

## 4. (de acá para abajo, agregar nuevas ideas que vayan surgiendo)

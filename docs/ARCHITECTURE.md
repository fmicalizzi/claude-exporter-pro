# Arquitectura técnica

## 1. Visión general

Claude Exporter Extension es una extensión Chrome Manifest V3 para extraer datos de `claude.ai` usando la sesión autenticada del navegador y convertir esos datos en archivos descargables locales.

No usa framework, bundler ni módulos. Toda la lógica está implementada en archivos JavaScript cargados directamente por el navegador.

## 2. Componentes

### [`manifest.json`](../extension/manifest.json)

Define:

- `manifest_version: 3`
- popup por defecto: `popup.html`
- service worker: `background.js`
- content scripts para `https://claude.ai/*`:
  - `jszip.min.js`
  - `utils.js`
  - `content.js`
- content script para `https://*.frame.claudeusercontent.com/*` (`all_frames`):
  - `frame_reader.js`
- permisos:
  - `activeTab`
  - `storage`
  - `tabs`
  - `scripting`
- `host_permissions`: `https://claude.ai/*`, `https://*.frame.claudeusercontent.com/*`
- `web_accessible_resources` para `browse.html`

### [`background.js`](../extension/background.js)

Responsabilidades:

- escuchar `chrome.runtime.onInstalled`,
- detectar pestañas ya abiertas de `claude.ai`,
- reinyectar `jszip.min.js`, `utils.js` y `content.js`,
- responder al mensaje `ensureContentScript`.

Observación:

- La inyección manual usada por `browse.js` llama directamente a `chrome.scripting.executeScript`, no al mensaje `ensureContentScript`.

### [`content.js`](../extension/content.js)

Es el núcleo operativo.

Responsabilidades:

- evitar doble inyección mediante `window.claudeExporterProLoaded`,
- detectar `orgId` leyendo la cookie `lastActiveOrg`,
- consumir la API de `claude.ai`,
- resolver contexto actual de página,
- exportar conversación individual,
- exportar proyecto,
- exportar todo agrupado por proyecto,
- listar y renderizar artefactos standalone (`fetchFrames`, `fetchFrameContent`; ver 5.1),
- atender mensajes desde popup y browse,
- descargar archivos o ZIPs.

### [`frame_reader.js`](../extension/frame_reader.js)

Content script minúsculo que corre dentro de los iframes de artefactos (`*.frame.claudeusercontent.com`), incluyendo el iframe oculto que `content.js` monta durante la exportación. Lee el HTML servido y lo envía al top window por `postMessage`. Ver sección 5.1.

### [`utils.js`](../extension/utils.js)

Centraliza utilidades compartidas:

- saneamiento de nombres de archivo,
- escape HTML,
- mapeo `lenguaje -> extensión`,
- inferencia de modelo por fecha,
- formateo legible del nombre del modelo,
- resolución de rama activa,
- extracción de artefactos,
- conversión de conversaciones a Markdown y texto plano,
- helpers de descarga y timestamp local.

### [`popup.html`](../extension/popup.html) y [`popup.js`](../extension/popup.js)

Interfaz mínima de operación rápida.

Capacidades:

- detectar si la pestaña activa pertenece a `claude.ai`,
- mostrar versión y estado de organización detectada,
- habilitar acciones según si hay conversación o proyecto en la URL,
- lanzar exportaciones simples.

### [`browse.html`](../extension/browse.html) y [`browse.js`](../extension/browse.js)

Interfaz ampliada para trabajo masivo.

Capacidades:

- detección e inyección del content script si falta,
- carga de todas las conversaciones y proyectos,
- filtros de UI,
- ordenamiento multinivel simple usando `sortStack`,
- selección múltiple persistente en memoria,
- exportación por lotes con barra de progreso,
- cancelación de exportaciones largas.

## 3. Flujo de datos

### 3.1 Detección de organización

`content.js` ejecuta:

```js
document.cookie
  .split('; ')
  .find((c) => c.startsWith('lastActiveOrg='))
```

Ese valor se usa como `orgId` para todas las llamadas a la API.

### 3.2 Comunicación entre contextos

```text
popup.js / browse.js
  -> chrome.tabs.sendMessage
content.js
  -> fetch autenticado con cookies
claude.ai API
  -> JSON de conversaciones/proyectos
content.js o browse.js
  -> archivos descargables
```

Mensajes soportados por `content.js`:

- `getOrgId`
- `getPageInfo`
- `loadConversations`
- `loadProjects`
- `loadProjectConversations`
- `exportConversation`
- `exportProject`
- `exportAllGrouped`
- `fetchConversationBatch`

### 3.3 Endpoints utilizados

Conversaciones y proyectos:

- `GET /api/organizations/{orgId}/chat_conversations`
- `GET /api/organizations/{orgId}/chat_conversations/{conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`
- `GET /api/organizations/{orgId}/projects`
- `GET /api/organizations/{orgId}/projects/{projectId}/conversations_v2?limit=1000&offset=0`

Artefactos standalone (ver sección 5.1):

- `GET /api/frame/frames?thumb=1&limit=500&org={orgId}` (owned) y `&rel=shared` (compartidos)
- `GET /api/frame/{slug}?org={orgId}&via=user_open&bk=initial`

Las requests de conversaciones/proyectos usan:

```js
fetch(url, {
  credentials: 'include',
  headers: { Accept: 'application/json' }
})
```

Las requests `/api/frame/*` requieren headers adicionales o devuelven `404`:

```js
headers: {
  Accept: 'application/json',
  'x-frame-surface': 'standalone',
  'x-frame-platform': 'web',
  'x-frame-cp': 'go',
  'x-frame-session-id': '<uuid cualquiera>'
}
```

### 3.4 Reintentos y backoff

`apiFetch()` implementa:

- hasta 3 intentos,
- espera incremental para errores genéricos,
- backoff exponencial en `429`,
- límite superior de 15 segundos por espera.

## 4. Exportaciones

## 4.1 Exportación individual

Ruta:

- UI: popup
- handler: `exportConversation`
- ejecución: `exportSingleConversation()`

Comportamiento:

- detecta `orgId`,
- consulta una conversación,
- infiere `model`,
- según opciones:
  - genera archivo simple, o
  - genera ZIP con conversación y artefactos.

Default efectivo:

- `branchOnly = true`
- `format = markdown`
- `extractArtifacts = false` si no se envía explícitamente

## 4.2 Exportación de proyecto

Ruta:

- UI: popup
- handler: `exportProject`
- ejecución: `exportProject()`

Comportamiento:

- obtiene lista de conversaciones del proyecto,
- procesa en lotes de 5,
- consulta detalle por conversación,
- extrae artefactos,
- genera:
  - `conversations/*.md`
  - `artifacts/<conv>/*`
  - `index.md`

Default efectivo:

- `branchOnly = false` salvo que la UI envíe `true`

## 4.3 Exportación global agrupada por proyecto desde popup

Ruta:

- UI: popup
- handler: `exportAllGrouped`
- ejecución: `content.js`

Comportamiento:

- consulta todas las conversaciones,
- consulta proyectos,
- agrupa por `project_uuid`, `project_id` o `projectUuid`,
- crea una carpeta ZIP por proyecto y una carpeta `Sin_Proyecto` para las que no tienen proyecto.

## 4.4 Exportaciones masivas desde browse

`browse.js` no delega la generación del ZIP al content script. Solo usa `fetchConversationBatch` para obtener datos y genera el ZIP del lado de la página de browse.

Esto permite:

- actualizar la barra de progreso después de cada lote,
- soportar cancelación,
- reutilizar `utils.js` localmente para artefactos y Markdown.

Dos modos:

- `Export Selected`
  - usa solo rama activa,
  - exporta las conversaciones seleccionadas a un ZIP plano.
- `Export All Grouped by Project`
  - usa todas las ramas,
  - exporta todo agrupado por proyecto.

## 5. Extracción de artefactos

La función principal es `extractAllArtifacts(convData, branchOnly)`.

Fuentes soportadas:

1. Tool `artifacts`
2. Tool `create_file`
3. Tool `str_replace`
4. `display_content.code_block`
5. `display_content.json_block`
6. Tags `<antArtifact>`

Detalles relevantes:

- `str_replace` solo modifica artefactos ya registrados.
- Los tags `<antArtifact>` se eliminan del Markdown final para evitar duplicación.
- Los artefactos se guardan en un `Map` para poder aplicar actualizaciones por identificador.
- Las extensiones se resuelven con `getFileExtension()` o `getExtFromType()`.

### 5.1 Artefactos standalone (`/code/artifact/…`)

Los artefactos de la sección *Artefactos* (URL `https://claude.ai/code/artifact/{slug}`) **no pertenecen a ninguna conversación**, así que la extracción de la sección 5 no los alcanza. Son un recurso aparte, servido por el host de artefactos `*.frame.claudeusercontent.com`.

**Listado** — `fetchFrames(orgId)` en `content.js`:

- `GET /api/frame/frames?thumb=1&limit=500&org={orgId}` (propios) + `&rel=shared` (compartidos), deduplicado por `slug`.
- Cada ítem trae: `slug`, `title`, `description`, `favicon`, `live` (versión), `rel`, `owner_email`, `source_surface`, `created_at`, `updatedAt`.

**Metadata + token** — `fetchFrameMeta(orgId, slug)`:

- `GET /api/frame/{slug}?org={orgId}&via=user_open&bk=initial`
- Devuelve `files: [{ path, contentType }]`, `assetToken` (efímero), `live`, `title`, `author`, fechas.

**Contenido** — la parte no obvia:

- Los bytes del archivo se sirven en `https://{slug}.frame.claudeusercontent.com/_f/{live}/?__frame_t={assetToken}`.
- Ese host aplica un CSP `frame-ancestors` que **solo permite incrustarlo desde `claude.ai`** (no desde la página de extensión ni como navegación top-level, que redirige `302` al wrapper). Un `fetch` cross-origin también queda bloqueado por CORS.
- Por eso el contenido se obtiene montando un **iframe oculto dentro de la pestaña de `claude.ai`** (`renderAndReadFrame` en `content.js`). El content script `frame_reader.js`, inyectado en ese iframe, lee el HTML (`fetch(location.href)` mismo-origen, con fallback a `document.documentElement.outerHTML`) y lo devuelve al top window por `postMessage`.
- `browse.js` orquesta: por cada artefacto llama a la acción `fetchFrameContent` y arma el ZIP (`{title}.html` + cabecera con metadata + `index.md`).

**Efectos secundarios**: montar el iframe cuenta como una vista (`view_count`) y dispara la telemetría normal de Claude, igual que abrir el artefacto manualmente. Es inherente al método (el contenido no se entrega fuera del contexto iframe).

## 6. Conversión a Markdown

La función `conversationToMarkdown(metadata, data, artifactFiles, convFolder, branchOnly)` genera:

- título,
- lista de artefactos al inicio,
- resumen,
- timestamps de creación y actualización,
- modelo formateado,
- bloques de mensajes.

Tipos de bloque contemplados:

- `thinking`
- `text`
- `tool_use`
- `tool_result`
- `attachments`

Comportamientos importantes:

- `tool_use` de artefactos se resume como anotación textual.
- `tool_result` se serializa en bloque de código.
- attachments con `extracted_content` se truncan si son largos.

## 7. Inferencia de modelo

Cuando una conversación no incluye `model`, `inferModel()` aplica una línea temporal fija:

- 2024-01-01 -> `claude-3-sonnet-20240229`
- 2024-06-20 -> `claude-3-5-sonnet-20240620`
- 2024-10-22 -> `claude-3-5-sonnet-20241022`
- 2025-02-24 -> `claude-3-7-sonnet-20250219`
- 2025-05-22 -> `claude-sonnet-4-20250514`
- 2025-09-29 -> `claude-sonnet-4-5-20250929`
- 2026-02-17 -> `claude-sonnet-4-6`

Es una heurística local, no una consulta a Anthropic.

## 8. Estructura de archivos exportados

### Conversación individual con artefactos

```text
Nombre_Conversacion.zip
├── Nombre_Conversacion.md|json|txt
└── artifacts/
    ├── archivo1.ext
    └── archivo2.ext
```

### Proyecto

```text
Proyecto_<id>_export.zip
├── index.md
├── conversations/
│   ├── Conv_A_<uuid8>.md
│   └── Conv_B_<uuid8>.md
└── artifacts/
    ├── Conv_A_<uuid8>/
    └── Conv_B_<uuid8>/
```

### Global agrupado

```text
claude_export_<timestamp>.zip
├── index.md
├── Proyecto_1/
│   ├── index.md
│   ├── conversations/
│   └── artifacts/
└── Sin_Proyecto/
    ├── index.md
    ├── conversations/
    └── artifacts/
```

## 9. Limitaciones técnicas actuales

- No hay persistencia local de preferencias ni de estado.
- No hay paginación en la UI de browse; carga todo el listado en memoria.
- No hay suite de tests.
- No hay tipado estático ni validación estructural de respuestas API.
- El nombre del proyecto en la exportación del popup no se resuelve realmente desde la página actual.
- `storage` figura en permisos, pero el código actual no lo usa.

## 10. Mantenimiento recomendado

- Corregir la resolución del nombre del proyecto en `popup.js`.
- Eliminar permisos no usados o empezar a usarlos de forma explícita.
- Agregar pruebas sobre:
  - extracción de artefactos,
  - conversión a Markdown,
  - resolución de ramas,
  - inferencia de modelo.
- Evaluar paginación o virtualización si la cuenta tiene gran volumen de conversaciones.

# Changelog

Formato basado en Keep a Changelog.

## [1.1.0] - 2026-09-10

### Añadido

- **Exportación de artefactos standalone** (sección *Artefactos* / `/code/artifact/…`), los que no pertenecen a ninguna conversación:
  - Nueva pestaña **Artefactos** en `browse.html` con búsqueda, selección múltiple y exportación en lote.
  - Listado vía `GET /api/frame/frames` (owned + shared, deduplicado) con headers `x-frame-*`.
  - Contenido leído montando un iframe oculto dentro de la pestaña de `claude.ai` (requerido por el CSP `frame-ancestors` del host de artefactos) y `frame_reader.js` que devuelve el HTML por `postMessage`.
  - ZIP con un `.html` por artefacto (con metadata y enlace de origen) más `index.md`.
- Nuevo content script `frame_reader.js` para `*.frame.claudeusercontent.com`.
- `host_permissions` sobre `https://*.frame.claudeusercontent.com/*`.

### Cambiado

- Repositorio reorganizado: la extensión cargable vive ahora en `extension/`; la documentación en la raíz y en `docs/`.
- README y CHANGELOG reescritos con rutas relativas.

### Eliminado

- Documentos de desarrollo internos (`DEVELOPMENT_PLAN.md`, `HANDOFF_extension_v1.md`, notas de investigación) y archivos temporales.

## [1.0.0] - 2026-04-08

### Añadido

- Extensión Chrome Manifest V3 **Claude Exporter Pro**.
- Popup: exportar conversación actual, proyecto actual, todo agrupado por proyecto, y abrir la vista de exploración.
- Página `browse.html`: búsqueda, filtros por proyecto/modelo, ordenamiento, selección múltiple, exportación de seleccionados y global, barra de progreso y cancelación.
- Detección de organización desde la cookie `lastActiveOrg`.
- Exportación a Markdown, JSON y Plain Text; ZIP con índices Markdown.
- Extracción de artefactos incrustados en conversaciones por 6 mecanismos (`artifacts`, `create_file`, `str_replace`, `display_content.code_block`, `display_content.json_block`, tags `<antArtifact>`).
- Enlaces bidireccionales conversación↔artefacto e inferencia de modelo por fecha.
- Tolerancia a rate limiting: 3 reintentos, backoff para `429`, lotes de 5, pausa de 750 ms.

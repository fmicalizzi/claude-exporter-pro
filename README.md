# Claude Exporter Pro

[![Licencia: MIT](https://img.shields.io/badge/Licencia-MIT-blue.svg)](LICENSE)
[![Versión](https://img.shields.io/badge/versión-1.1.0-informational.svg)](CHANGELOG.md)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)

Extensión de Chrome (Manifest V3) para exportar **conversaciones** y **artefactos** de `claude.ai` a Markdown, JSON, texto plano y ZIP. Sin proceso de build ni dependencias: JavaScript plano que se carga directamente.

## Características

- **Conversaciones**: exportar la conversación actual, un proyecto completo, o todo agrupado por proyecto.
- **Artefactos standalone**: exportar los artefactos de la sección *Artefactos* (los `/code/artifact/…` que no pertenecen a ninguna conversación) a archivos HTML.
- **Vista de exploración** (`browse.html`) con dos pestañas — *Conversations* y *Artefactos* — con búsqueda, filtros, selección múltiple y exportación en lote con barra de progreso.
- Detección automática de la organización desde la cookie `lastActiveOrg`.
- Extracción de artefactos incrustados en conversaciones por 6 mecanismos.
- Enlaces bidireccionales entre conversaciones y sus artefactos.
- Inferencia de modelo cuando la API no devuelve `model`.
- Exportación de solo la rama activa o de todas las ramas.

## Estructura del repositorio

```text
.
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/
│   └── ARCHITECTURE.md
└── extension/            ← esto es lo que se carga en Chrome
    ├── manifest.json
    ├── background.js
    ├── content.js
    ├── frame_reader.js
    ├── utils.js
    ├── popup.{html,js,css}
    ├── browse.{html,js,css}
    ├── jszip.min.js
    └── icons/
```

## Instalación

1. Abrir `chrome://extensions/`.
2. Activar **Developer mode**.
3. Clic en **Load unpacked**.
4. Seleccionar la carpeta **`extension/`** de este repositorio.
5. Abrir una pestaña de `https://claude.ai/` e iniciar sesión.

## Uso

### Conversaciones (popup)

Abrí el popup en una pestaña de `claude.ai`:

- **Export Current Conversation** — conversación abierta (elegí `Markdown` / `JSON` / `Plain Text`, y opciones `Extract artifacts` / `Active branch only`).
- **Export Current Project** — proyecto abierto, a ZIP con `index.md`, `conversations/` y `artifacts/`.
- **Export All (grouped by project)** — todo, a un ZIP con una carpeta por proyecto.
- **Browse All Conversations** — abre la vista ampliada.

### Vista de exploración (`browse.html`)

- Pestaña **Conversations**: buscar, filtrar por proyecto/modelo, ordenar, seleccionar y exportar (`Export Selected` o `Export All Grouped by Project`).
- Pestaña **Artefactos**: lista los artefactos standalone; `Export Selected` o `Export All Artifacts` descargan un ZIP con un `.html` por artefacto (más `index.md`).

> **Requisito**: la vista de exploración necesita al menos una pestaña de `claude.ai` abierta y logueada, porque toda la lectura de la API se hace desde ahí.

## Cómo funciona la exportación de artefactos standalone

Los artefactos de la sección *Artefactos* se sirven desde `*.frame.claudeusercontent.com` y su contenido **solo se entrega cuando se carga como iframe desde un ancestro permitido** (CSP `frame-ancestors`, que incluye `claude.ai` pero no la página de extensión). Por eso el flujo es:

1. `content.js` lista los artefactos con `GET /api/frame/frames` (headers `x-frame-*`).
2. Por cada artefacto pide su metadata + token con `GET /api/frame/{slug}`.
3. Monta un iframe oculto **dentro de la pestaña de claude.ai** con el mount URL.
4. `frame_reader.js` (inyectado en el iframe) lee el HTML servido y lo devuelve por `postMessage`.
5. `browse.js` arma el ZIP.

Detalle técnico completo en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Permisos

- `activeTab`, `tabs` — detectar/usar la pestaña de `claude.ai`.
- `scripting` — inyección de scripts en pestañas ya abiertas.
- `host_permissions` — `https://claude.ai/*` y `https://*.frame.claudeusercontent.com/*`.
- `storage` — declarado; sin uso actual.

## Resiliencia

- 3 reintentos por request con backoff exponencial ante `HTTP 429`.
- Procesamiento por lotes de 5 conversaciones con pausa de 750 ms.
- Los fallos parciales se omiten en vez de abortar toda la exportación.

## Limitaciones conocidas

- No hay pipeline de build ni tests automatizados.
- **Export Current Project** (popup) usa el literal `project` como nombre de índice.
- `escapeHtml` no escapa comillas dobles (potencial en atributos de la tabla de browse); pendiente de endurecer.
- Exportar un artefacto standalone suma una vista (`view_count`) y dispara la telemetría normal de Claude, igual que abrirlo a mano (es inherente al método iframe).

## Contribuir

¿Querés aportar? Mirá [`CONTRIBUTING.md`](CONTRIBUTING.md): entorno de desarrollo (sin build), pruebas manuales y pautas de código. Para reportar bugs o proponer features usá los [issue templates](https://github.com/fmicalizzi/claude-exporter-pro/issues/new/choose).

Este proyecto sigue el [Código de Conducta Convenido para Contribuyentes](CODE_OF_CONDUCT.md).

## Seguridad

No abras issues públicos para vulnerabilidades: seguí [`SECURITY.md`](SECURITY.md) (reporte privado vía GitHub Security Advisories). La extensión maneja la sesión de `claude.ai`, así que nunca compartas org IDs, cookies ni tokens.

## Licencia

[MIT](LICENSE) © 2026 Franco Micalizzi.

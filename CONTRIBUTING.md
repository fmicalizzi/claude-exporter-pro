# Contribuir a Claude Exporter Pro

¡Gracias por querer aportar! Cualquier ayuda es bienvenida: reportar bugs, proponer mejoras, mejorar la documentación o enviar código.

## Reportar bugs y proponer mejoras

- Usá los [issue templates](https://github.com/fmicalizzi/claude-exporter-pro/issues/new/choose): hay uno para bugs y otro para features.
- Antes de abrir un issue, revisá que no exista uno igual.
- Para vulnerabilidades de seguridad **no abras un issue público**: seguí [`SECURITY.md`](SECURITY.md).

## Entorno de desarrollo

No hay build ni dependencias: la extensión es JavaScript plano que se carga tal cual.

1. Cloná el repositorio.
2. Abrí `chrome://extensions/` y activá **Developer mode**.
3. Clic en **Load unpacked** y seleccioná la carpeta **`extension/`**.
4. Abrí una pestaña de `https://claude.ai/` logueado.
5. Tras cada cambio: recargá la extensión en `chrome://extensions/` y refrescá la pestaña de Claude.

## Flujo de contribución

1. Hacé fork del repositorio.
2. Creá una rama descriptiva: `fix/export-crash`, `feat/filtro-por-fecha`, etc.
3. Hacé los cambios con commits claros y atómicos.
4. Probá manualmente lo que tocaste (ver checklist más abajo).
5. Abrí un Pull Request usando la plantilla y explicá qué cambia y cómo lo probaste.

## Checklist de pruebas manuales

Antes de abrir el PR, verificá al menos lo que aplique a tu cambio:

- [ ] `Export Current Conversation` en Markdown, JSON y Plain Text.
- [ ] `Export Current Project` a ZIP.
- [ ] `Export All (grouped by project)` a ZIP.
- [ ] `browse.html` → pestaña **Conversations**: búsqueda, filtros, selección y `Export Selected`.
- [ ] `browse.html` → pestaña **Artefactos**: listado y export a ZIP.
- [ ] Cancelación de una exportación en lote.
- [ ] Sin errores nuevos en la consola de la extensión y de la pestaña de Claude.

## Pautas de código

- **Sin build step ni dependencias nuevas** salvo justificación fuerte; si agregás una librería, que sea un archivo vendorizado y explicá por qué.
- Mantené **Manifest V3** y los permisos mínimos. Si un cambio requiere un permiso nuevo, justificalo en el PR.
- JavaScript plano, consistente con el estilo existente.
- La documentación (README, `docs/ARCHITECTURE.md`, CHANGELOG) se mantiene en español.
- Documentá en `docs/ARCHITECTURE.md` cualquier cambio de fondo en el flujo de extracción.

## Datos sensibles

**Nunca** incluyas en commits, issues o PRs:

- Org IDs, cookies de sesión (`lastActiveOrg`, `sessionKey`), tokens o credenciales.
- Exports reales de conversaciones o artefactos con contenido personal.
- Capturas con datos de tu cuenta.

Usá `/api/organizations/<orgId>` o `TU_ORG` como placeholder en ejemplos y capturas.

## Licencia

Al contribuir, aceptás que tu aporte se publique bajo la licencia [MIT](LICENSE) del proyecto.

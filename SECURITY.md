# Política de Seguridad

## Versiones soportadas

Solo la última versión publicada en la rama `main` recibe correcciones de seguridad.

| Versión | Soportada |
| ------- | --------- |
| 1.1.x   | ✅        |
| < 1.1   | ❌        |

## Reportar una vulnerabilidad

**No abras un issue público.** Usá una de estas vías privadas:

1. **Recomendado**: [GitHub Security Advisories](https://github.com/fmicalizzi/claude-exporter-pro/security/advisories/new) — reporte privado dentro del repositorio.
2. Si no podés usarlo, escribí a **franco.micalizzi@gmail.com** con el asunto `[SECURITY] claude-exporter-pro`.

Incluí, si es posible:

- Descripción del problema y su impacto.
- Pasos para reproducirlo (versión de Chrome, sistema operativo, versión de la extensión).
- Prueba de concepto o captura (sin datos de tu cuenta: enmascarar org IDs, correos y conversaciones).
- Mitigación sugerida, si la tenés.

### Qué esperar

- Acuse de recibo en un plazo de 7 días.
- Evaluación y, si corresponde, un fix en la rama `main`.
- Crédito en el aviso de seguridad si lo deseás.

Este es un proyecto mantenido por una sola persona, sin garantías de tiempos de respuesta más allá de la mejor voluntad.

## Alcance

La extensión se ejecuta localmente en el navegador y no tiene servidor propio. Los puntos de mayor sensibilidad:

- Manejo de la sesión de `claude.ai` (cookies `lastActiveOrg`, `sessionKey`): la extensión solo las lee para construir requests; **nunca** deben incluirse en logs, issues, capturas ni exports del repositorio.
- Inyección de scripts en páginas (`scripting`, content scripts) y lectura de iframes de `*.frame.claudeusercontent.com`: cualquier bypass de las restricciones de origen/CSP es de interés.
- Generación de HTML/ZIP a partir de contenido remoto: cualquier caso de inyección (XSS en `browse.html` o en los `.html` exportados) es de interés.
- Escritura de archivos descargados con contenido no sanitizado.

Quedan fuera de alcance: vulnerabilidades de la propia plataforma `claude.ai`, ingeniería social y ataques que requieran un navegador o extensión ya comprometidos.

## Manejo de datos sensibles en contribuciones

No incluyas en issues, PRs ni commits: org IDs reales, cookies/tokens de sesión, exports reales o capturas con datos personales. Ver [`CONTRIBUTING.md`](CONTRIBUTING.md#datos-sensibles).

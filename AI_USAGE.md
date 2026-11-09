# Registro de uso de IA

Cada integrante anota aquí cada uso de IA en código, pruebas o documentación. Piero consolida el archivo antes de la entrega.

| Fecha | Integrante | Herramienta | Para qué | Archivos | Qué se revisó o cambió a mano |
| --- | --- | --- | --- | --- | --- |
| 2026-11-08 | Piero Mejía | Claude Code | Esqueleto del monorepo, workflow de CI y documentación base | `package.json`, `web/`, `api/`, `.github/`, `README.md` | Revisión de la estructura y del workflow |
| 2026-11-08 | Piero Mejía | Claude Code | Plantilla SAM base (API HTTP, JWT authorizer, cuatro tablas, funciones provisionales, condición de `/simulate`, throttling), empaquetado con esbuild y guía de despliegue | `infra/template.yaml`, `infra/samconfig.toml`, `api/scripts/`, `api/src/handlers/`, `api/src/shared/`, `README.md` | Transformación de SAM revisada sin conexión: ruta `/simulate` solo en `academic`, CORS y autorización por ruta |
| 2026-11-08 | Santiago Callocondo | Claude Code | Esquemas Zod, módulo projects (catálogo, detalle, `/stats`, crear y publicar), módulo audit, contrato OpenAPI, diseño de claves, prueba T01 y corrección del parseo de `cognito:groups` en el authorizer | `api/src/projects/`, `api/src/donations/schemas.ts`, `api/src/audit/`, `api/src/shared/`, `api/src/handlers/`, `api/src/auth/authorizer.ts`, `docs/api.yaml`, `docs/data-model.md`, `evidence/T01/` | PENDIENTE: completar tras la revisión a mano |
| 2026-11-08 | Paolo Ramírez | Antigravity | Modelo de amenazas STRIDE, diseño de scopes, infraestructura Cognito SAM, módulos authorizer/authz (RBAC y ownership), pruebas T02, T11 y T03 y evidencias | `docs/threat-model.md`, `infra/cognito-authorizer.yaml`, `api/src/auth/`, `evidence/T02/`, `evidence/T11/`, `evidence/T03/` | Validación de claims de Cognito, rechazo estricto de ID tokens, estructura de errores uniforme y sanitización de evidencia |
| 2026-11-08 | Gabriel Llerena | Claude Code (Opus 5.5) | Esqueleto de la SPA, login OIDC (HU-03, CA-NF11.1) y pruebas de componentes | `web/`, `eslint.config.mjs`, `README.md` | Validado con pruebas de mutación y en navegador contra un simulador local; falta probar contra Cognito. |

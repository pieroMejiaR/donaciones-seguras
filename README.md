# Plataforma de Donaciones Seguras

Prototipo académico de una plataforma de donaciones con enfoque Zero Trust: una SPA en React y una API serverless en AWS (API Gateway HTTP API, Lambda y DynamoDB), con identidad en Cognito y despliegue con SAM.

> Simulación académica: la plataforma no procesa pagos reales.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `web/` | SPA con React y Vite |
| `api/` | Funciones Lambda en TypeScript |
| `infra/` | Plantilla SAM (`template.yaml`), desde el día 2 |
| `docs/` | Modelo de amenazas, contrato OpenAPI y demás documentos |
| `evidence/` | Evidencia sanitizada de las pruebas |
| `.github/` | CI y plantilla de pull request |

## Requisitos

- Node.js 22 (ver `.nvmrc`) y npm 10 o superior.
- AWS CLI 2.32 o superior y SAM CLI, desde el día 2.

## Comandos

```bash
npm ci               # instala las dependencias de todos los workspaces
npm run lint         # ESLint en todo el repositorio
npm run typecheck    # TypeScript en web y api
npm test             # Vitest en web y api
npm run build        # build de web y api
npm run dev -w web   # servidor de desarrollo de la SPA
```

## Flujo de trabajo

- `main` está protegida: solo se cambia por pull request, con el check `ci` en verde y la aprobación de una persona distinta del autor.
- Cada integrante trabaja en ramas `<nombre>/<tema>`, por ejemplo `santiago/donaciones`.
- Quien use IA para código, pruebas o documentación lo registra en [`AI_USAGE.md`](AI_USAGE.md).
- La evidencia de las pruebas va en [`evidence/`](evidence/README.md), siempre sanitizada: el repositorio es público.

## AWS

- Región: `us-east-2` (Ohio). La cuenta no permite otra.
- Cada integrante despliega su propio stack de prueba con su nombre. El stack compartido lo despliega Piero.
- El despliegue y la limpieza final con `sam delete` se documentan aquí cuando exista la plantilla.

## Equipo

| Integrante | Rol |
| --- | --- |
| Piero Mejía | Líder técnico y DevOps |
| Paolo Ramírez | Identidad y seguridad Zero Trust |
| Santiago Callocondo | Backend |
| Gabriel Llerena | Frontend |

# Plataforma de Donaciones Seguras

Prototipo académico de una plataforma de donaciones con enfoque Zero Trust: una SPA en React y una API serverless en AWS (API Gateway HTTP API, Lambda y DynamoDB), con identidad en Cognito y despliegue con SAM.

> Simulación académica: la plataforma no procesa pagos reales.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `web/` | SPA con React y Vite |
| `api/` | Funciones Lambda en TypeScript |
| `infra/` | Plantillas SAM: `template.yaml` (API, Lambdas y DynamoDB) y `cognito-authorizer.yaml` (identidad) |
| `docs/` | Modelo de amenazas, contrato OpenAPI y demás documentos |
| `evidence/` | Evidencia sanitizada de las pruebas |
| `.github/` | CI y plantilla de pull request |

## Requisitos

- Node.js 22 (ver `.nvmrc`) y npm 10 o superior.
- AWS CLI 2.32 o superior (para `aws login`) y SAM CLI.

## Comandos

```bash
npm ci               # instala las dependencias de todos los workspaces
npm run lint         # ESLint en todo el repositorio
npm run typecheck    # TypeScript en web y api
npm test             # Vitest en web y api
npm run build        # build de web y api; en api empaqueta cada función en api/dist/<función>
npm run dev -w web   # servidor de desarrollo de la SPA
```

## Flujo de trabajo

- `main` está protegida: solo se cambia por pull request, con el check `ci` en verde y la aprobación de una persona distinta del autor.
- Cada integrante trabaja en ramas `<nombre>/<tema>`, por ejemplo `santiago/donaciones`.
- Quien use IA para código, pruebas o documentación lo registra en [`AI_USAGE.md`](AI_USAGE.md).
- La evidencia de las pruebas va en [`evidence/`](evidence/README.md), siempre sanitizada: el repositorio es público.

## AWS

Región `us-east-2` (Ohio): la cuenta no permite otra.

### Stacks

| Stack | Plantilla | Stage | Quién lo despliega |
| --- | --- | --- | --- |
| `donaciones-cognito` | `cognito-authorizer.yaml` | `academic` | Piero, una sola vez; lo comparten todos |
| `donaciones-academic` | `template.yaml` | `academic` | Piero; lo usan la SPA y la demo |
| `donaciones-<nombre>` | `template.yaml` | `dev` | Cada integrante, para sus pruebas |

`template.yaml` importa del stack de Cognito el emisor y el client_id del JWT authorizer, así que `donaciones-cognito` tiene que existir antes. En el stage `dev` no existe `POST /v1/donations/{id}/simulate` (CA-06.1).

### Desplegar

```bash
aws login                         # abre el navegador; entrar con el Builder ID
aws sts get-caller-identity       # confirmar que es la cuenta del proyecto
npm ci
npm run build                     # genera api/dist/<función>/index.mjs
cd infra
sam validate --lint
sam deploy --stack-name donaciones-<nombre>     # stack personal
```

No usar `sam build`: el código ya sale empaquetado de `npm run build`. La URL del API aparece en la salida `ApiUrl` del stack.

Las rutas siguen la matriz de `docs/threat-model.md`. Las de lectura pública no piden token; las demás exigen un access token de Cognito con el scope de la ruta. Mientras un módulo no esté implementado, su ruta responde 501 con `{ code, message, requestId }`.

### Tablas

Las cuatro tablas usan claves genéricas para que el backend decida qué guarda en cada una: `pk` como clave de partición y un índice `gsi1` (`gsi1pk`, `gsi1sk`) en `Projects`, `Donations` y `AuditEvents`. `Idempotency` expira sus registros con TTL en el atributo `expiresAt` (epoch en segundos).

### Limpieza

```bash
cd infra
sam delete --stack-name donaciones-<nombre>
sam delete --config-env academic
sam delete --config-env cognito   # al final: los otros stacks importan sus valores
```

`sam delete` borra también los grupos de logs, porque son recursos del stack. Queda el bucket que SAM crea para subir el código (`aws-sam-cli-managed-default`); se borra en la limpieza final del día 7.

## Equipo

| Integrante | Rol |
| --- | --- |
| Piero Mejía | Líder técnico y DevOps |
| Paolo Ramírez | Identidad y seguridad Zero Trust |
| Santiago Callocondo | Backend |
| Gabriel Llerena | Frontend |

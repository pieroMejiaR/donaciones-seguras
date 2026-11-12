# Plataforma de Donaciones Seguras

Prototipo académico de una plataforma de donaciones con enfoque Zero Trust: una SPA en React y una API serverless en AWS (API Gateway HTTP API, Lambda y DynamoDB), con identidad en Cognito y despliegue con SAM.

> Simulación académica: la plataforma no procesa pagos reales.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `web/` | SPA con React y Vite |
| `api/` | Funciones Lambda en TypeScript |
| `infra/` | Plantillas SAM: `template.yaml` (API, Lambdas y DynamoDB), `cognito-authorizer.yaml` (identidad), `cloudtrail.yaml` (auditoría de la cuenta) y `frontend.yaml` (publicación de la SPA) |
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

## Frontend

La SPA necesita un stack con Cognito desplegado. Copia la plantilla y completa los valores con las salidas del stack:

```bash
cp web/.env.example web/.env.local
```

| Variable | Valor |
| --- | --- |
| `VITE_OIDC_AUTHORITY` | Salida `CognitoIssuerUrl` |
| `VITE_OIDC_CLIENT_ID` | Salida `UserPoolClientId` |
| `VITE_OIDC_DOMAIN` | Dominio del managed login, por ejemplo `https://<prefijo>.auth.us-east-2.amazoncognito.com` |
| `VITE_OIDC_SCOPE` | Scopes separados por espacios; deben estar registrados en el app client |
| `VITE_API_BASE_URL` | URL del API |

Estas variables quedan públicas en el bundle, así que nunca deben contener secretos. Sin ellas, la app muestra cuáles faltan.

El app client debe registrar `http://localhost:5173/callback` como URL de callback y `http://localhost:5173` como URL de cierre de sesión, sin barra final. Por eso Vite usa siempre el puerto 5173 y falla si está ocupado.

### Sesión

- **Flujo:** Authorization Code con PKCE contra el managed login de Cognito.
- **Tokens:** solo en memoria (CA-NF11.1). Al recargar la página o abrir otra pestaña no hay sesión en la SPA; una ruta protegida vuelve a pasar por Cognito, que no pide contraseña si su sesión sigue activa.
- **`sessionStorage`:** guarda el `state` y el `code_verifier` del login en curso, porque deben sobrevivir a la redirección. No son tokens y se borran al volver. Si el login se abandona, se descartan pasados 15 minutos.
- **Renovación:** con el refresh token, antes de que expire el access token. Si falla, la SPA borra la sesión y avisa al usuario.
- **Cierre de sesión:** revoca el refresh token, borra los tokens de memoria y cierra la sesión de Cognito. El access token ya emitido sigue siendo válido en el API hasta expirar (CA-03.4).
- **Roles en la interfaz:** ocultar enlaces y proteger rutas es solo experiencia de uso. La autorización la decide el API en cada solicitud.

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
| `donaciones-frontend` | `frontend.yaml` | no aplica | Piero, una sola vez; sirve la SPA |
| `donaciones-academic` | `template.yaml` | `academic` | Piero; lo usan la SPA y la demo |
| `donaciones-cloudtrail` | `cloudtrail.yaml` | no aplica | Piero, una sola vez; es el trail de la cuenta |
| `donaciones-<nombre>` | `template.yaml` | `dev` | Cada integrante, para sus pruebas |

`template.yaml` importa del stack de Cognito el emisor y el client_id del JWT authorizer, así que `donaciones-cognito` tiene que existir antes. En el stage `dev` no existe `POST /v1/donations/{id}/simulate` (CA-06.1).

### Identidad

El stack `donaciones-cognito` crea el User Pool, el app client público de la SPA, los grupos `DONANTE`, `GESTOR` y `AUDITOR`, y el dominio del managed login. La URL del dominio sale en `CognitoDomainUrl` y va en `VITE_OIDC_DOMAIN` de la SPA. Para que la página de inicio de sesión funcione hacen falta tres cosas, y las tres están en la plantilla: el dominio, un estilo de managed login (sin él la página responde «Login pages unavailable») y `COGNITO` como proveedor del app client (sin él responde «Invalid request»).

Las URL de callback y de cierre de sesión están en el perfil `cognito` de `samconfig.toml`: las de `localhost` para el desarrollo y las de CloudFront para la SPA publicada. `CallbackUrls` lleva la ruta `/callback`; `LogoutUrls`, el origen sin barra final, porque es lo que envía la SPA al cerrar sesión.

```bash
cd infra
sam deploy --config-env cognito
```

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

### Publicar la SPA

La SPA se sirve desde un bucket S3 privado a través de CloudFront (stack `donaciones-frontend`, plantilla `frontend.yaml`):

- Solo CloudFront lee el bucket, con control de acceso al origen (OAC). El bucket no tiene acceso público ni hosting de sitio web.
- Cada respuesta lleva una política de cabeceras de seguridad: CSP, HSTS de un año, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` y las políticas de origen cruzado.
- La CSP solo deja cargar scripts y estilos del propio origen, y conectar al API y a Cognito. No admite scripts ni estilos en línea: si la SPA los necesitara, se cambia la SPA y no la política.
- `index.html` y las rutas de la SPA no se guardan en caché; `/assets/*`, que lleva hash en el nombre, se guarda un año. Un 403 o 404 del bucket devuelve `index.html`, para que recargar una ruta de la SPA funcione.

Se despliega una vez, después del stack del API y del de Cognito. `ApiUrl` fija en la CSP el origen exacto del API; el dominio exacto de Cognito lo toma la plantilla de la salida `CognitoDomainUrl` de `donaciones-cognito`:

```bash
cd infra
sam deploy --config-env frontend --parameter-overrides ApiUrl=<salida ApiUrl de donaciones-academic>
```

La salida `SiteUrl` es la URL pública. Tiene que estar en `SpaOrigin` del API (ya figura en el perfil `academic` de `samconfig.toml`) y, para el inicio de sesión, en las URL de callback y de cierre de sesión de Cognito.

Para publicar o actualizar la SPA se compila con las variables `VITE_*` de `web/.env.example` y se sube el resultado. No hace falta invalidar la caché:

```bash
npm run build -w web
aws s3 sync web/dist s3://<SiteBucketName> --delete
```

Para borrar el stack, primero se vacía el bucket (`aws s3 rm s3://<SiteBucketName> --recursive`) y después se ejecuta `sam delete --config-env frontend`. CloudFront tarda varios minutos en eliminar la distribución.

### Observabilidad

**Logs de las funciones.** Cada función escribe en `/donaciones/<stack>/<función>`, en formato JSON y con retención de 14 días. `sam delete` borra esos grupos junto con el stack. Las líneas de la aplicación guardan `requestId`, `action`, `outcome`, `statusCode`, `errorCode` y `durationMs`; el código no registra tokens ni cuerpos de solicitud.

**CloudTrail.** El stack `donaciones-cloudtrail` crea el trail `donaciones-trail`: eventos de administración (lectura y escritura) de todas las regiones, incluidos los de servicios globales como IAM, con validación de integridad de los archivos. Los logs van a un bucket S3 privado, cifrado, accesible solo por HTTPS y con vencimiento a los 30 días. No registra eventos de datos, que se cobran. Se despliega una sola vez, porque un trail es de la cuenta y no de cada stack:

```bash
cd infra
sam deploy --config-env cloudtrail
```

Para ver qué pasó sin esperar a los archivos de S3, el historial de eventos responde de inmediato. Por ejemplo, quién ejecutó los despliegues:

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=ExecuteChangeSet --max-results 5
aws cloudtrail lookup-events --region us-east-1 --lookup-attributes AttributeKey=EventName,AttributeValue=PutRolePolicy --max-results 5
```

Los eventos de IAM son globales y el historial los guarda en `us-east-1`, por eso la segunda consulta lleva esa región.

### Tablas

Las cuatro tablas usan claves genéricas para que el backend decida qué guarda en cada una: `pk` como clave de partición y un índice `gsi1` (`gsi1pk`, `gsi1sk`) en `Projects`, `Donations` y `AuditEvents`. `Idempotency` expira sus registros con TTL en el atributo `expiresAt` (epoch en segundos).

### Permisos IAM

Cada función tiene su propio rol (`<Nombre>Role` en `infra/template.yaml`) con una política en línea. Ningún rol usa `AWSLambdaBasicExecutionRole`, porque da permisos de logs sobre todos los recursos, y ninguno tiene comodines de acción. El único `*` es el sufijo `:*` del ARN del grupo de logs de la propia función, que cubre sus flujos de log. Ningún rol tiene `Scan`, `DeleteItem` ni `BatchWriteItem`.

| Función | Logs | DynamoDB |
| --- | --- | --- |
| `Health` | propios | ninguno |
| `ListProjects`, `GetStats` | propios | `Query` en el índice `gsi1` de Projects |
| `GetProject` | propios | `GetItem` en Projects |
| `CreateProject` | propios | `PutItem` en Projects y AuditEvents |
| `PublishProject` | propios | `GetItem` y `UpdateItem` en Projects; `PutItem` en AuditEvents |
| `CreateDonation` | propios | `GetItem` y `ConditionCheckItem` en Projects; `GetItem` y `PutItem` en Idempotency; `PutItem` en Donations y AuditEvents |
| `SimulateDonation` | propios | `GetItem` y `UpdateItem` en Donations y Projects; `PutItem` en AuditEvents |
| `ListMyDonations` | propios | `Query` en el índice `gsi1` de Donations |

Quien cambie el acceso a datos de una función ajusta su rol en el mismo pull request. La referencia de qué acciones necesita cada módulo está en `docs/data-model.md`. Una transacción (`TransactWriteItems`) se autoriza con la acción de cada ítem, y la lectura de un índice exige el ARN del índice.

### Limpieza

```bash
cd infra
sam delete --stack-name donaciones-<nombre>
sam delete --config-env academic
sam delete --config-env cognito   # al final: los otros stacks importan sus valores
```

El stack de CloudTrail se borra aparte. El bucket tiene que estar vacío, así que primero se detiene el trail y después se vacía; el nombre del bucket sale de la salida `TrailBucketName` del stack. Si CloudTrail alcanza a escribir otro archivo, el borrado falla: se vacía de nuevo y se repite.

```bash
aws cloudtrail stop-logging --name donaciones-trail
aws s3 rm s3://<TrailBucketName> --recursive
cd infra
sam delete --config-env cloudtrail
```

`sam delete` borra también los grupos de logs, porque son recursos del stack. Además borra del bucket de SAM los zips del código, que comparten todos los stacks con el mismo código; después de borrar un stack personal, Piero vuelve a subirlos con `sam deploy --config-env academic --no-fail-on-empty-changeset`. Queda el bucket que SAM crea para subir el código (`aws-sam-cli-managed-default`); se borra en la limpieza final del día 7.

## Equipo

| Integrante | Rol |
| --- | --- |
| Piero Mejía | Líder técnico y DevOps |
| Paolo Ramírez | Identidad y seguridad Zero Trust |
| Santiago Callocondo | Backend |
| Gabriel Llerena | Frontend |

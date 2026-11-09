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

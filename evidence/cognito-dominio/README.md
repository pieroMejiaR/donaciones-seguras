# Evidencia: dominio y página de inicio de sesión de Cognito

**Requisitos:** HU-03 (CA-03.1), RNF-HU-02, CA-NF09.2 (limpieza)
**Responsable:** Piero Mejía · **Fecha:** 2026-11-09

Sanitizado: el ID de la cuenta, los ID de pool y de app client y los identificadores de usuario se omitieron.

## Estado encontrado en el pool desplegado

El stack `donaciones-cognito` no define dominio, pero el pool desplegado tiene uno: `donaciones-seguras`, de managed login (versión 2). Según el historial de CloudTrail se creó desde la consola el 9 de noviembre a las 07:42 (hora de Lima), fuera de la plantilla. Con ese dominio:

| Prueba | Resultado |
| --- | --- |
| Discovery del emisor (`/.well-known/openid-configuration`) | anuncia `authorization_endpoint`, `token_endpoint`, `revocation_endpoint` y `end_session_endpoint` en el dominio |
| `/oauth2/authorize` con `redirect_uri` de `localhost` | `302` a `/login` |
| `/oauth2/authorize` con `redirect_uri` de CloudFront | `302` a `/error?error=redirect_mismatch`: la URL no está registrada |
| Página `/login` | `403` «Login pages unavailable»: el app client no tiene estilo de managed login |

Además, el app client no tiene `SupportedIdentityProviders`. Eso se descubrió al probar la plantilla corregida (ver abajo): sin proveedor, la página responde «Invalid request». En resumen, hoy nadie puede iniciar sesión, ni desde `localhost` ni desde CloudFront.

## Qué cambia

- `infra/cognito-authorizer.yaml`: `UserPoolDomain` (managed login, prefijo en el parámetro `DomainPrefix`, por defecto `donaciones-seguras`), `ManagedLoginBranding` con el estilo por defecto de Cognito, `SupportedIdentityProviders: [COGNITO]` en el app client y la salida `CognitoDomainUrl`.
- `infra/samconfig.toml`: las URL de CloudFront se suman a las de `localhost` en `CallbackUrls` (con `/callback`) y en `LogoutUrls` (el origen sin barra final).

## Cómo se probó

Sin tocar el pool real: se desplegó la plantilla nueva en un stack temporal, `donaciones-cognito-prueba`, con otro prefijo de dominio y las mismas URL del perfil `cognito` (una copia de `samconfig.toml`, para comprobar también que SAM lee la lista de parámetros con comas). No se inició sesión ni se crearon usuarios: las pruebas son de protocolo.

```bash
sam validate --lint --template-file cognito-authorizer.yaml
sam deploy --config-file samconfig-prueba.toml --config-env cognito --stack-name donaciones-cognito-prueba
curl "https://<prefijo>.auth.us-east-2.amazoncognito.com/oauth2/authorize?client_id=<client>&response_type=code&scope=openid&redirect_uri=<url>&code_challenge=<...>&code_challenge_method=S256"
sam delete --stack-name donaciones-cognito-prueba --no-prompts
```

## Resultados

### Flujo de autorización y cierre de sesión

| Solicitud | Resultado |
| --- | --- |
| `authorize` con `redirect_uri` de CloudFront (`/callback`) | `302` a `/login` |
| `authorize` con `redirect_uri` de `localhost` | `302` a `/login` |
| `authorize` con `redirect_uri` de un sitio ajeno | `302` a `/error?error=redirect_mismatch` |
| `authorize` con el origen de CloudFront sin `/callback` | `302` a `/error?error=redirect_mismatch` |
| `authorize` con `response_type=token` (flujo implícito) | rechazado: `error=invalid_request`, `error_description=unauthorized_client` |
| `logout` con `logout_uri` de CloudFront | `302` al origen de CloudFront |
| `logout` con `logout_uri` de un sitio ajeno | `302` a `/login`: no redirige al sitio ajeno |

### Página de inicio de sesión

| Plantilla | Resultado de `/login` |
| --- | --- |
| Con dominio y estilo, sin proveedor | `400` «Invalid request» |
| Con dominio, estilo y `COGNITO` como proveedor | `200`: formulario de correo y contraseña, con «Forgot your password?» y «Create an account» |

La página se abrió en un navegador (Chromium) y con `curl`. No se escribieron credenciales.

### Limpieza y recreación

`sam delete` borró el stack temporal con su pool, su dominio y su estilo, y el prefijo quedó libre. Un despliegue inmediato con el mismo prefijo lo volvió a crear en 45 segundos. Esto importa para el pool real: el dominio creado a mano se puede borrar y recrear desde la plantilla con el mismo nombre.

## Observaciones

- **PKCE no es obligatorio en el servidor.** `authorize` sin `code_challenge` también lleva a `/login`: Cognito admite PKCE pero no lo exige a un cliente público. La SPA siempre lo envía (`oidc-client-ts`), así que la protección depende del cliente. El comentario «PKCE obligatorio» de la plantilla describe la intención, no lo que hace Cognito.
- **Registro abierto.** La página ofrece «Create an account» porque `AllowAdminCreateUserOnly` es `false`. Un usuario nuevo no pertenece a ningún grupo, así que el API le niega las rutas que exigen rol.

## Lo que no se probó

- Iniciar sesión, canjear el código por tokens, renovarlos y revocarlos: requiere un usuario y credenciales.
- El despliegue sobre el pool real. Antes hay que borrar el dominio creado a mano, porque un pool admite un solo dominio de prefijo.

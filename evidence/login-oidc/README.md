# Evidencia: inicio y cierre de sesión OIDC en la SPA

**Requisitos:** HU-03 (CA-03.1, CA-03.3), RNF-HU-11 (CA-NF11.1); apoyo a HU-11 (CA-11.2, T14)
**Responsable:** Gabriel Llerena · **Fecha:** 2026-11-10 (pruebas automatizadas) y 2026-11-12 (capturas)

Sanitizado: los tokens, el correo del usuario de prueba, el `client_id`, el ID del pool y los valores de `code`, `state`, `code_challenge` y `code_verifier` se taparon en todas las capturas.

| Parte | Estado |
| --- | --- |
| 1. Pruebas automatizadas del frontend | Hecha |
| 2. Pruebas de mutación sobre los controles | Hecha |
| 3. Login real contra Cognito, con capturas | Pasos 1 a 8 hechos; **paso 9 no se cumple: el GESTOR no tiene TOTP** |

## Qué se probó

1. Que la SPA inicie sesión con Authorization Code y PKCE (S256), sin flujo implícito ni secreto de cliente (CA-03.1).
2. Que los tokens vivan solo en memoria: nada en `localStorage`, `sessionStorage` ni en cookies de la SPA (CA-NF11.1).
3. Que el access token dure 15 minutos o menos (CA-03.3).
4. Que el cierre de sesión revoque el refresh token, borre los tokens de memoria y cierre la sesión de Cognito (CA-03.3).
5. Que, tras el login, el usuario vuelva a la ruta que intentaba abrir, y que esa ruta no pueda apuntar a otro sitio.

## 1. Pruebas automatizadas

Pruebas de componentes con Vitest y Testing Library (`web/src/auth/oidcFlow.test.ts`, `web/src/app/app.test.tsx`, `web/src/auth/returnTo.test.ts`, `web/src/services/apiClient.test.ts`). Se ejecuta la biblioteca real `oidc-client-ts`; solo se simula la red de Cognito.

```bash
npm test -w web
```

Resultado: 59 de 59 pruebas superadas, en local (2026-11-10) y en el CI de GitHub sobre el mismo commit de `main`, `49486ad` ([ejecución](https://github.com/pieroMejiaR/donaciones-seguras/actions/runs/42816852463/job/129832005753)).

Pruebas relacionadas con esta evidencia:

```text
✓ CA-03.1: usa Authorization Code con PKCE S256 y nunca el flujo implícito
✓ CA-03.1: canjea el código con el code_verifier, sin secreto de cliente
✓ CA-NF11.1: tras el callback no quedan tokens ni code_verifier en el navegador
✓ CA-03.3: revoca solo el refresh token, borra la memoria y cierra la sesión de Cognito
✓ CA-03.3: borra la memoria y sale aunque la revocación falle, sin registrar el token
✓ CA-03.3: cerrar sesión revoca, limpia la caché y no vuelve a iniciar el login
✓ HU-03: un callback válido inicia sesión y vuelve a la ruta original
✓ HU-03: sin sesión, una ruta protegida redirige a Cognito conservando el destino
✓ procesar dos veces el callback canjea el código una sola vez
✓ rechaza un state desconocido y no crea sesión
✓ un callback sin respuesta válida muestra un error y limpia la URL
✓ si la sesión expira avisa, limpia la caché y deja al usuario iniciar sesión
✓ T11: con una sesión real envía el access token, nunca el ID token
✓ sanitizeReturnTo descarta destinos externos: "//malicioso.example/robar", "/.//malicioso.example", "javascript:alert(1)", …
```

## 2. Pruebas de mutación

Que las pruebas pasen no demuestra que detecten un fallo. Para comprobarlo, se rompió a propósito cada control, uno por vez, se ejecutaron las pruebas y se restauró el código. Un control está cubierto si al romperlo falla al menos una prueba.

Ejecución del 2026-11-10 sobre `main` (`49486ad`):

| Requisito | Control roto a propósito | Resultado |
| --- | --- | --- |
| CA-NF11.1 | Tokens en sessionStorage | Detectado |
| CA-NF11.1 | Tokens en localStorage | Detectado |
| CA-03.1 | Flujo implícito | Detectado |
| CA-03.1 | PKCE desactivado | Detectado |
| CA-03.3 | Logout con el parámetro estándar en vez de `logout_uri` | Detectado |
| CA-03.3 | Revoca también el access token | Detectado |
| CA-03.3 | No revoca el refresh token | Detectado |
| CA-03.3 | No borra los tokens de memoria | Detectado |
| CA-03.3 | El logout se detiene si falla la revocación | Detectado |
| CA-NF01.2 | Registra el refresh token en la consola | Detectado |
| HU-03 | Canjea dos veces el mismo código | Detectado |
| CA-03.2 | Envía un access token expirado | Detectado |
| T11 | Envía el ID token al API | Detectado |
| HU-03 | No valida el destino guardado en el `state` | Detectado |
| CA-04.3 | Acepta grupos desconocidos como roles | Detectado |
| HU-03 | `returnTo` sin validar el origen | Detectado |
| HU-03 | `returnTo` admite `//` (redirección abierta) | Detectado |
| HU-03 | Inicia varios flujos de login a la vez | Detectado |
| CA-03.3 | Inicia un login durante el cierre de sesión | Detectado |
| CA-03.3 | No limpia la caché al cerrar sesión | Detectado |
| CA-03.3 | No limpia la caché al expirar la sesión | Detectado |
| CA-04.1 | Guard de rol abierto | Detectado |
| HU-03 | Guard de sesión abierto | Detectado |
| HU-03 | Bucle de redirecciones tras un aviso | Detectado |
| HU-03 | El callback deja `code` y `state` en la URL | Detectado |
| CA-NF06.2 | El foco no se mueve al cambiar de ruta | Detectado |
| CA-NF06.2 | El enlace de salto no mueve el foco | Detectado |
| CA-NF01.1 | Acepta un API por HTTP | Detectado |
| RNF-HU-10 | Muestra el cuerpo de un error inesperado | Detectado |

**Resultado: 29 de 29 detectados.**

Las filas de guards (CA-04.1 y HU-03) prueban la experiencia de uso, no la autorización: el rechazo real lo hace el API, y su evidencia está en T03.

**Hallazgos durante el desarrollo.** La primera ronda dejó dos controles sin detectar, y ambos se corrigieron antes del PR #4:

- **Redirección abierta en `returnTo`.** `/.//malicioso.example` conserva el origen de la app al resolverse, pero queda como `//malicioso.example`, que el navegador interpreta como otro sitio. Se añadió la regla que rechaza rutas que empiezan por `//` y casos de prueba para ella.
- **Una prueba que no podía fallar.** La de "una sola redirección a Cognito" comprobaba el resultado antes de que llegara la segunda llamada. Se reescribió para contar las llamadas a la biblioteca.

## 3. Login real contra Cognito

### Preparación

- Usuario de prueba del grupo `DONANTE` y, para el paso 9, uno del grupo `GESTOR` con TOTP.
- SPA en `http://localhost:5173` (`npm run dev -w web`), con `web/.env.local` apuntando al pool desplegado.
- Una ventana de incógnito nueva, para que no haya sesión previa de Cognito ni datos de intentos anteriores.
- DevTools abierto en **Network**, con **Preserve log** y **Disable cache** activados: las redirecciones a Cognito borran el registro si no.

### Capturas

Guardar cada imagen en esta carpeta con el nombre indicado y anotar el resultado debajo de cada paso.

**1. Solicitud de autorización (CA-03.1)** · `01-authorize-pkce.png`
Abrir `http://localhost:5173/mis-donaciones` sin sesión. En Network, la petición `authorize`, pestaña **Payload**.
Debe verse: `response_type=code`, `code_challenge_method=S256`, que existe `code_challenge` y `redirect_uri=http://localhost:5173/callback`.
Resultado: la SPA envía `response_type=code`, `code_challenge` y `code_challenge_method=S256`, con `redirect_uri=http://localhost:5173/callback` y los scopes `openid email profile api/projects.write api/donations.*`. No se usa el flujo implícito.

**2. Canje del código (CA-03.1)** · `02-token-solicitud.png`
Iniciar sesión con el usuario DONANTE. Petición `POST /oauth2/token`, pestaña **Payload**.
Debe verse: `grant_type=authorization_code`, que existe `code_verifier` y que **no** hay `client_secret`.
Resultado: el cuerpo lleva `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri` y `client_id`. No hay `client_secret`: el cliente es público y el canje se protege con PKCE.

**3. Vigencia del access token (CA-03.3)** · `03-token-vigencia.png`
La misma petición, pestaña **Preview**.
Debe verse: `expires_in: 900` (15 minutos) y `token_type: "Bearer"`. Tapar los tres tokens por completo.
Resultado: Cognito responde `expires_in: 900` y `token_type: "Bearer"`. El access token dura 15 minutos, el máximo que permite CA-03.3.

**4. Regreso a la ruta original (HU-03)** · `04-regreso-ruta.png`
Debe verse: la barra de direcciones en `/mis-donaciones`, el título "Mis donaciones" y el botón "Cerrar sesión".
Resultado: tras el canje (`POST /oauth2/token`, `200`), la SPA vuelve a `/mis-donaciones` con la sesión iniciada.

**5. Nada guardado en el navegador (CA-NF11.1)** · `05-almacenamiento-vacio.png`
Con la sesión iniciada, DevTools → **Application**: Local storage, Session storage y Cookies de `http://localhost:5173`.
Debe verse: Local storage y Session storage vacíos, y ninguna cookie del dominio `localhost`. Mostrar la columna **Domain** de las cookies y tapar sus valores.
Resultado: Local storage (`05a`) y Session storage (`05b`) están vacíos con la sesión iniciada. En Cookies (`05c`) solo aparecen `cognito`, `lang` y `XSRF-TOKEN`, cuyo dominio (columna Domain) no es `localhost` sino el del managed login de Cognito, con `HttpOnly` y `Secure`: son la sesión de Cognito, no de la SPA, y JavaScript no puede leerlas. La SPA no guarda tokens en el navegador.

**6. Revocación del refresh token (CA-03.3)** · `06-revocacion.png`
Pulsar "Cerrar sesión". Petición `POST /oauth2/revoke`.
Debe verse: estado `200` y, en **Payload**, `token` y `client_id`, ambos tapados.
Resultado: `POST https://<dominio>/oauth2/revoke` responde `200 OK`. En la lista, la revocación va antes del `logout`.

**7. Cierre de la sesión de Cognito (CA-03.3)** · `07-logout.png`
Lista de Network filtrada con `/revoke|logout/`.
Debe verse: primero `/oauth2/revoke` y después `GET /logout?client_id=…&logout_uri=http://localhost:5173` con `302`, y la SPA de vuelta en `/`.
Resultado: primero `revoke` y después `logout`, con `logout_uri=http://localhost:5173`. Después Cognito devuelve a la SPA en `/`, como muestra el título de DevTools (`localhost:5173/`).

**8. Volver a entrar pide credenciales (CA-03.3)** · `08-reingreso.png`
Pulsar otra vez "Iniciar sesión".
Debe verse: el formulario de Cognito pidiendo correo y contraseña, sin entrar automáticamente.
Resultado: Cognito muestra `/login` con el formulario de correo y contraseña. La sesión de Cognito se cerró y no se entra automáticamente.

**9. Segundo factor del GESTOR (CA-11.2, apoyo a T14)** · `09-gestor-totp.png`
En una ventana de incógnito nueva, iniciar sesión con el usuario GESTOR.
Debe verse: Cognito pidiendo el código TOTP antes de devolver a la SPA. Coordinar con Paolo, responsable de T14.
Resultado (2026-11-12): **no se cumple.** El GESTOR inició sesión con correo y contraseña, sin segundo factor. El pool tiene `MfaConfiguration: "OPTIONAL"` (`infra/cognito-authorizer.yaml`), y con esa opción Cognito solo pide TOTP a los usuarios que lo tienen configurado. El usuario GESTOR de prueba no lo tiene. Así no se cumplen CA-11.1 (GESTOR y AUDITOR con TOTP) ni CA-11.2 (el GESTOR no completa el login sin segundo factor). El control depende de Cognito, no de la SPA, y queda a cargo de Paolo (HU-11, T14). Repetir este paso cuando los usuarios privilegiados tengan TOTP.

### Cómo sanitizar las capturas

- Tapar con **rectángulos sólidos**, no con desenfoque ni pixelado, que a veces se pueden revertir.
- Tapar: tokens, correo, `client_id`, ID del pool, `code`, `state`, `code_challenge` y `code_verifier`. Dejar visibles los nombres de los parámetros.
- Revisar también la **barra de título de DevTools**, que muestra la URL completa de la página, y la **lista de peticiones** de Network, cuyos nombres incluyen parámetros como `client_id` o `state`.
- Tapar los valores de las cookies.
- Comprobar que no se vean otras pestañas, marcadores ni el nombre del perfil del navegador.
- Revisar cada imagen otra vez antes del commit: el repositorio es público.

## Lo que no se probó

- **T13, token revocado usado antes de expirar (CA-03.4).** Se prueba con Paolo: guardar un access token antes del logout, llamar a `GET /v1/donations/me` con `curl` (se espera 200) y repetir pasados 15 minutos (se espera 401).
- **Renovación automática del access token.** La SPA renueva un minuto antes de que expire, a los 14 minutos. Las pruebas de componentes solo cubren el caso en que la renovación falla. La renovación correcta no se ha probado contra Cognito: para capturarla, dejar la sesión abierta 14 minutos y buscar en Network un `POST /oauth2/token` con `grant_type=refresh_token`.
- **Login desde CloudFront.** Depende de los PR #9 y #10 de Piero.
- **Accesibilidad a 375 px (RNF-HU-06).** Se documentará con el catálogo, el detalle y la donación.

## Observaciones

- **PKCE lo garantiza la SPA, no Cognito.** Según `evidence/cognito-dominio/` (PR #10), Cognito acepta un `authorize` sin `code_challenge` para un cliente público. La SPA lo envía siempre, y la prueba de mutación "PKCE desactivado" confirma que una regresión se detectaría.
- **Recargar la página cierra la sesión en la SPA**, porque los tokens solo están en memoria. Volver a una ruta protegida pasa de nuevo por Cognito, que no pide contraseña si su sesión sigue activa.
- **`sessionStorage` durante el login.** Guarda el `state` y el `code_verifier` mientras el usuario está en Cognito y los borra al volver. Si el login se abandona, se eliminan la siguiente vez que carga la app, una vez pasados 15 minutos. No contienen tokens.
- Durante el desarrollo se usó un simulador local de Cognito para revisar la interfaz. No forma parte del repositorio ni de esta evidencia.

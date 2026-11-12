# Evidencia: formulario de donación e historial propio en la SPA

**Requisitos:** HU-05 (CA-05.1 a CA-05.5), HU-07 (CA-07.1, CA-07.2), RNF-HU-06 (CA-NF06.1, CA-NF06.2); apoyo a CA-06.4, CA-09.1, CA-NF11.1, T04, T09 y T12 desde la interfaz
**Responsable:** Gabriel Llerena · **Fecha:** 2026-11-12

Sanitizado: las capturas usan un Cognito y un API simulados en local, con usuarios, tokens y proyectos ficticios. No contienen IDs del pool, `client_id`, correos ni tokens reales.

| Parte | Estado |
| --- | --- |
| 1. Pruebas automatizadas del frontend | Hecha |
| 2. Pruebas de mutación sobre los controles | Hecha: 25 de 25 detectados |
| 3. Revisión a 375 px en un navegador, contra Cognito y API simulados | Hecha |
| 4. Capturas contra el stack desplegado | **Pendiente:** `GET /v1/donations/me` aún responde 501 |

## Qué se probó

1. Que el formulario envíe solo `{ projectId, amountCents }`, con el monto en céntimos enteros y sin datos de identidad ni de pago (CA-05.1, CA-05.3, CA-05.5).
2. Que la SPA rechace antes de llamar al API los montos fuera de S/ 1.00 a S/ 1,000.00 o con más de dos decimales, con un error accesible (CA-05.2, T04 desde la interfaz).
3. Que la `Idempotency-Key` se reutilice al reintentar el mismo envío y cambie al cambiar el monto o al registrar otra donación (CA-05.4).
4. Que el historial muestre fecha, importe, proyecto y estado, sin enviar identificadores de usuario ni mostrar datos de identidad (CA-07.1, CA-07.2).
5. Que todo sea usable a 375 px, con etiquetas, foco visible y sin violaciones de axe (CA-NF06.1, CA-NF06.2).
6. Que ocultar el botón o la ruta a otros roles sea solo experiencia de uso: la interfaz también informa el 403 cuando el API rechaza (CA-04.3).

## 1. Pruebas automatizadas

Pruebas de componentes con Vitest y Testing Library sobre la app completa (router, proveedores, cliente OIDC y cliente del API reales). Solo se simula la red: `web/src/test/network.ts` imita a `POST /v1/donations` y `GET /v1/donations/me` según `docs/api.yaml`, incluida la validación de la `Idempotency-Key` y la respuesta original ante una clave repetida.

```bash
npm test -w web
```

Resultado (2026-11-12, local): 156 de 156 pruebas de la SPA superadas; 73 corresponden a esta evidencia (`web/src/pages/donations.test.tsx`, `web/src/donations/idempotency.test.ts` y `parseSolesToCents` en `web/src/lib/money.test.ts`). Lint, typecheck y build en verde.

Pruebas del formulario (HU-05):

```text
✓ CA-05.1: registra una intención válida en céntimos y muestra el estado pendiente
✓ CA-05.3 y T11: el cuerpo no lleva identidad y se envía el access token, no el ID token
✓ CA-NF11.1: la clave de idempotencia y los tokens no quedan en el navegador
✓ CA-05.5: solo pide el monto, nunca datos de tarjeta, cuenta bancaria ni DNI
✓ acepta «1,5» y envía 150 céntimos
✓ acepta «S/ 1000» y envía 100000 céntimos
✓ T04 (UX): «0», «0.99», «1000.01», «10.505», «-5», «1,000.00» y «diez» muestran un error accesible y no llaman al API
✓ un monto vacío pide completarlo
✓ CA-05.4: reintentar tras un fallo de red reutiliza la clave y no duplica
✓ CA-05.4: tras un 5xx, cambiar el monto es otro intento y usa otra clave
✓ CA-05.4: cada donación registrada usa una clave nueva
✓ CA-05.4: un doble clic no registra dos donaciones
✓ CA-05.2: si el API responde 409 lo explica sin códigos internos
✓ CA-04.3: la interfaz no autoriza; si el API responde 403 se informa
✓ con la sesión expirada ofrece volver a iniciar sesión
✓ CA-08.2: un borrador no muestra el formulario
✓ un GESTOR que entra por URL ve la página 403 (el API también lo rechazaría)
✓ CA-NF06.2: formulario, errores y resultado no tienen violaciones de axe
✓ un visitante / un donante ven el botón «Donar»; un gestor no
```

Pruebas del historial (HU-07):

```text
✓ CA-07.1: muestra fecha, importe, proyecto y estado, de lo más reciente a lo más antiguo
✓ CA-07.1: la consulta no envía identificadores de usuario, solo el access token
✓ CA-07.2 y RNF-HU-10: no muestra datos de identidad aunque el API los enviara
✓ sin donaciones muestra un estado vacío con enlace al catálogo
✓ si el API falla muestra un error comprensible y permite reintentar
✓ una respuesta fuera de contrato se trata como error, sin datos parciales
✓ T12 (UX): un GESTOR no ve el historial y no se consulta el API
✓ una donación recién registrada aparece aunque el historial ya estuviera en caché
```

Pruebas unitarias de apoyo:

```text
✓ createIdempotencyTracker: reutiliza la clave mientras se reintenta la misma carga
✓ createIdempotencyTracker: usa otra clave si cambia el monto o el proyecto
✓ createIdempotencyTracker: tras reiniciar, la misma carga es una donación nueva
✓ createIdempotencyTracker: por defecto genera UUID v4
✓ parseSolesToCents convierte «25.5», «25,50», «S/ 12.30», «0.30», … sin punto flotante
✓ parseSolesToCents rechaza «-5», «1.», «10.505», «1,000.00», «1e3», «S/», …
```

## 2. Pruebas de mutación

Como en `evidence/login-oidc/`: se rompió a propósito cada control, uno por vez, se ejecutaron las pruebas de esta evidencia y se restauró el código. Un control está cubierto si al romperlo falla al menos una prueba. El script reemplaza un fragmento exacto del código, ejecuta Vitest y restaura el archivo aunque la ejecución falle.

Ejecución del 2026-11-12 sobre `gabriel/catalogo-detalle`, con los cambios aún sin commit:

| Requisito | Control roto a propósito | Resultado |
| --- | --- | --- |
| CA-05.1 | Envía soles en lugar de céntimos | Detectado |
| CA-05.1 | Convierte el monto con punto flotante | Detectado |
| CA-05.2 | Admite tres decimales | Detectado |
| CA-05.2 | Sin monto mínimo en el formulario | Detectado |
| CA-05.2 | Sin monto máximo en el formulario | Detectado |
| CA-05.4 | No envía la cabecera `Idempotency-Key` | Detectado |
| CA-05.4 | Clave nueva en cada envío (el reintento duplica) | Detectado |
| CA-05.4 | Misma clave aunque cambie el monto | Detectado |
| CA-05.4 | No olvida la clave tras registrar | Detectado |
| CA-05.4 | Clave guardada en `localStorage` | Detectado |
| CA-05.3 | El cuerpo incluye el donante | Detectado |
| CA-05.5 | El formulario pide la tarjeta | Detectado |
| CA-06.4 | Sin el rótulo de simulación en el resultado | Detectado |
| RNF-HU-10 | Muestra el mensaje y el código del API | Detectado |
| CA-NF06.2 | El foco no pasa al resultado | Detectado |
| CA-NF06.2 | El error no se asocia al campo | Detectado |
| CA-04.1 | Formulario sin guard de rol | Detectado |
| CA-04.1 | Botón «Donar» visible para un gestor | Detectado |
| CA-08.2 | Muestra el formulario de un borrador | Detectado |
| CA-07.1 | Pide el historial con el `sub` del usuario | Detectado |
| CA-07.1 | No ordena por fecha | Detectado |
| CA-07.1 | El estado solo se distingue por color | Detectado |
| CA-09.1 | El total suma pendientes y rechazadas | Detectado |
| CA-07.2 | Historial sin validar el contrato | Detectado |
| CA-07.1 | No refresca el historial tras donar | Detectado |

**Resultado: 25 de 25 detectados.**

Las filas de CA-04.1 prueban la experiencia de uso, no la autorización: el rechazo real lo hace el API, y su evidencia está en T03, T09 y T12.

**Hallazgos durante el desarrollo.** Antes de ejecutar las mutaciones se revisó qué detectaría cada prueba, y dos controles quedaban sin cubrir:

- **Historial desactualizado tras donar.** La prueba abría el historial por primera vez después de donar, así que nunca había una caché que invalidar. Se reescribió para cargar el historial vacío antes de donar. Con ella, quitar la invalidación hace fallar la prueba.
- **Clave de idempotencia en el navegador.** Ninguna prueba revisaba dónde se guarda la clave. Se añadió una que busca la clave y el access token en `localStorage` y `sessionStorage` después de donar.

## 3. Revisión a 375 px en un navegador

### Preparación

- Chrome 375 × 812 px en modo móvil (`Emulation.setDeviceMetricsOverride`), controlado por DevTools Protocol, sin interfaz.
- SPA real en `http://localhost:5173` (`npm run dev -w web`).
- **Cognito y API simulados** en `https://localhost:4443`: emiten tokens ficticios del grupo `DONANTE` o `GESTOR` y responden según `docs/api.yaml`. No forman parte del repositorio. Se usan porque `GET /v1/donations/me` aún no está implementado en el backend, y porque así las capturas no contienen datos del pool real.
- En cada captura se midió el ancho del documento, el elemento con foco, el contenido de `localStorage` y `sessionStorage`, y los controles de menos de 24 px. Los datos completos están en `mediciones-donante.json` y `mediciones-gestor.json`, con los tokens recortados.

### Capturas

**1. Detalle del proyecto sin sesión** · `01-detalle-boton-donar.png`
Resultado: el detalle ofrece «Donar a este proyecto» e indica que hace falta iniciar sesión como donante. Al pulsarlo, la SPA pasa por el login y vuelve al formulario.

**2. Formulario (CA-05.1, CA-05.5)** · `02-formulario.png`
Resultado: un solo campo, «Monto a donar en soles (PEN)», con el rango y un ejemplo asociados como descripción. El texto aclara que no se piden tarjeta, CVV, cuenta bancaria ni DNI. Tras la navegación, el foco está en el `h1`.

**3. Monto inválido (CA-05.2, CA-NF06.2)** · `03-error-monto.png`
Con el monto `0`. Resultado: «El monto mínimo es S/ 1.00.», asociado al campo con `aria-describedby="monto-ayuda monto-error"`, borde de error y foco visible en el campo. No se envió ninguna solicitud al API: en `mediciones-donante.json` solo hay un `POST /v1/donations`, el del paso 4.

**4. Intención registrada (CA-05.1, CA-06.4)** · `04-resultado.png`
Con el monto `25.50`. Resultado: la solicitud fue `POST /v1/donations` con el cuerpo `{"projectId":"6f1c2b8e-…-000000000001","amountCents":2550}`, `Authorization: Bearer <access token>` e `Idempotency-Key` con un UUID v4. La pantalla muestra proyecto, S/ 25.50, «Pendiente de simulación» y el rótulo «Simulación académica: no se ha realizado ningún cobro». El foco pasa al título del resultado.

**5. Historial propio (CA-07.1, CA-09.1)** · `05-historial.png`
Resultado: la donación recién registrada aparece primera, seguida de una confirmada y una rechazada. Cada tarjeta muestra proyecto, estado en texto, fecha en hora de Lima e importe. El total confirmado es S/ 100.00: no suma la pendiente ni la rechazada. La solicitud fue `GET /v1/donations/me`, sin parámetros de identidad.

**6. GESTOR que entra por URL (CA-04.1, solo experiencia de uso)** · `06-gestor-403.png`
Resultado: la SPA muestra «No tienes acceso a esta sección» y no llama a `/v1/donations`. El rechazo con autoridad lo da el API (T03).

**7. GESTOR en el detalle** · `07-gestor-detalle-sin-boton.png`
Resultado: con sesión de GESTOR, el detalle no ofrece donar.

**Mediciones.** En las 7 capturas, el ancho del documento es 375 px (sin desplazamiento horizontal), `localStorage` y `sessionStorage` están vacíos con la sesión iniciada, y no hay controles de menos de 24 px.

**Hallazgos de esta revisión, corregidos antes de las capturas finales:**

- **La hora se partía en dos líneas.** En el historial, «a. m.» quedaba dividido entre «a.» y «m.». `formatDateTime` (`web/src/lib/dates.ts`) ahora une ambas partes con un espacio duro.
- **Enlace pequeño en la página 403.** «Volver al inicio» medía menos de 24 px de alto (WCAG 2.5.8). Se le dio la misma altura mínima de 44 px que al resto de enlaces sueltos.

## 4. Capturas contra el stack desplegado (pendiente)

Repetir cuando el backend implemente `GET /v1/donations/me` (hoy responde 501 por `notImplemented`). Usar el usuario de prueba del grupo DONANTE, una ventana de incógnito nueva y DevTools en **Network** con **Preserve log**. Sanitizar como en `evidence/login-oidc/`.

1. `08-post-donacion.png`: la petición `POST /v1/donations`. En **Headers**, `Idempotency-Key` y `Authorization` tapado; en **Payload**, solo `projectId` y `amountCents`; en **Response**, `201` con `PENDIENTE_SIMULACION`.
2. `09-reintento.png`: con **Offline** activado en Network, enviar un monto; desactivar **Offline** y pulsar otra vez. Las dos peticiones deben llevar la misma `Idempotency-Key`, y el historial debe mostrar una sola donación.
3. `10-historial-real.png`: `GET /v1/donations/me` con `200` y la pantalla del historial.

## Lo que no se probó

- **Contra el API desplegado.** `POST /v1/donations` está implementado (T04 a T07), pero `GET /v1/donations/me` no, así que el flujo completo solo se probó con el API simulado.
- **Lector de pantalla real.** Los nombres, descripciones y anuncios se comprobaron con Testing Library y axe; no se probó con NVDA ni TalkBack.
- **Contraste medido en el navegador.** axe no lo calcula en jsdom. Se calculó con la fórmula de WCAG sobre los valores de `web/src/styles.css`: texto `warning` sobre `warning-soft` 7.19:1, `brand` sobre `brand-soft` 6.74:1, `danger` sobre `danger-soft` 7.78:1 y borde del campo (`muted` sobre blanco) 6.69:1. Todos superan 4.5:1 para texto y 3:1 para bordes, pero no se midieron con una herramienta sobre la página renderizada.
- **Simulación de la donación (HU-06).** La pantalla para confirmar o rechazar todavía no existe; el rótulo de CA-06.4 ya está en `web/src/donations/SimulationNotice.tsx`.

## Observaciones

- **La `Idempotency-Key` vive solo en memoria**, igual que los tokens. Si el usuario recarga la página tras un fallo de red, el siguiente envío lleva otra clave. Si la primera solicitud sí se guardó, quedarían dos donaciones pendientes; ninguna suma al total hasta que se confirme.
- **La validación del monto en la SPA es experiencia de uso.** El API valida lo mismo con su propio esquema (T04), y la interfaz informa el 400 si llegara a ocurrir.
- **La SPA no envía ni muestra el `sub`.** El historial lo filtra el API con el `sub` del token (T09); el esquema Zod de la SPA descarta además cualquier campo fuera del contrato.
- Archivos: `web/src/pages/DonatePage.tsx`, `web/src/pages/MyDonationsPage.tsx`, `web/src/donations/`, `web/src/lib/money.ts` (`parseSolesToCents`) y `web/src/lib/dates.ts` (`formatDateTime`).

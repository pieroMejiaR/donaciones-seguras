# Evidencia: simulación de donaciones y panel del gestor en la SPA

**Requisitos:** HU-06 (CA-06.1 a CA-06.4), HU-08 (CA-08.1, CA-08.2), RNF-HU-06 (CA-NF06.1, CA-NF06.2); apoyo a CA-09.1, CA-NF02.2, CA-NF11.1 y T03 desde la interfaz
**Responsable:** Gabriel Llerena · **Fecha:** 2026-11-12

Sanitizado: las capturas usan un Cognito y un API simulados en local, con usuarios, tokens y proyectos ficticios. No contienen IDs del pool, `client_id`, correos ni tokens reales.

| Parte | Estado |
| --- | --- |
| 1. Pruebas automatizadas del frontend | Hecha |
| 2. Revisión a 375 px en un navegador, contra Cognito y API simulados | Hecha |
| 3. Capturas contra el stack desplegado | **Pendiente:** guía en la sección 3 |

## Qué se probó

1. Que una donación propia pendiente se pueda confirmar o rechazar desde el historial y desde el resultado de la donación, con una confirmación previa porque el resultado es definitivo (CA-06.1).
2. Que solo la confirmación sume: el historial, el detalle y los indicadores se actualizan con la respuesta del API, y un rechazo no suma (CA-06.2, CA-06.3, CA-09.1).
3. Que un segundo clic, o una donación que ya tenía resultado, no produzcan una segunda simulación ni un estado incorrecto en pantalla (CA-06.2).
4. Que el rótulo «Simulación académica: no se ha realizado ningún cobro» acompañe a la simulación (CA-06.4).
5. Que el gestor cree proyectos en BORRADOR con título, descripción y meta en céntimos enteros, sin poder fijar el estado ni el acumulado (CA-08.1, CA-NF02.2).
6. Que publicar pida confirmación, lleve el proyecto al catálogo y explique el 409 de un proyecto ya publicado (CA-08.2).
7. Que todo sea usable a 375 px, con etiquetas, errores asociados a cada campo, foco gestionado y sin violaciones de axe (CA-NF06.1, CA-NF06.2).

## 1. Pruebas automatizadas

Pruebas de componentes con Vitest y Testing Library sobre la app completa (router, proveedores, cliente OIDC y cliente del API reales). Solo se simula la red: `web/src/test/network.ts` imita `POST /v1/donations/{id}/simulate`, `POST /v1/projects` y `POST /v1/projects/{id}/publish` según `docs/api.yaml`, incluida la regla de que solo la primera transición suma al acumulado. Además, puede retener una respuesta para observar la interfaz mientras la solicitud está en curso.

```bash
npm test -w web
```

Resultado (2026-11-12, local): 191 de 191 pruebas de la SPA superadas; 35 son de esta evidencia (`web/src/pages/simulation.test.tsx` y `web/src/pages/manager.test.tsx`). Lint, typecheck y build en verde.

Simulación (HU-06):

```text
✓ CA-06.1: confirma una donación propia pendiente tras pedir confirmación
✓ CA-06.3: un rechazo no suma al total confirmado
✓ cancelar no llama al API y devuelve el foco al botón elegido
✓ CA-06.2: durante el envío el botón se deshabilita y un segundo clic no envía otra
✓ solo las pendientes ofrecen simular
✓ CA-06.2: si ya tenía resultado lo explica y muestra el estado real
✓ explica sin detalles internos: ruta fuera del stage académico (404 NOT_FOUND), donación inexistente o ajena (404), operación en curso (409), 403 y fallo de red
✓ CA-NF06.2: opciones, confirmación y resultado no tienen violaciones de axe
✓ CA-06.4: confirma recién registrada, con el rótulo de simulación y el avance actualizado
```

Panel del gestor (HU-08):

```text
✓ CA-08.1: crea un borrador con título, descripción y meta en céntimos
✓ CA-NF02.2: el cuerpo solo lleva los campos del contrato, nunca el estado ni el acumulado
✓ CA-08.1 (UX): título corto o largo, descripción corta, meta vacía, cero, negativa o mayor que S/ 1,000,000.00 muestran un error en su campo y no llaman al API
✓ dos envíos seguidos crean un solo borrador
✓ CA-04.1: si el API responde 403 se informa; la interfaz no autoriza
✓ un 400 del API pide revisar los datos
✓ CA-08.2: publica un borrador de la sesión tras confirmar y aparece en el catálogo
✓ cancelar la publicación no llama al API y devuelve el foco
✓ CA-08.2: publicar uno ya publicado explica el 409
✓ los proyectos de la sesión siguen al volver al panel minutos después y se borran al cerrar sesión
✓ CA-08.2: publica un borrador anterior por su identificador
✓ un identificador mal formado no llama al API
✓ un identificador inexistente responde «no existe»
✓ T03 (UX): un donante o un auditor que entra por URL ve 403 y no llama al API
✓ CA-NF06.2: el panel, sus errores y sus resultados no tienen violaciones de axe
```

## 2. Revisión a 375 px en un navegador

### Preparación

La misma de `evidence/donacion-historial/`:

- Chrome 375 × 812 px en modo móvil, controlado por DevTools Protocol, sin interfaz.
- SPA real en `http://localhost:5173` (`npm run dev -w web`).
- **Cognito y API simulados** en `https://localhost:4443`, con tokens ficticios del grupo `DONANTE` o `GESTOR`. Responden según `docs/api.yaml`, incluido que solo una confirmación suma al acumulado y que los borradores no aparecen en las rutas públicas. No forman parte del repositorio.
- En cada captura se midió el ancho del documento, el elemento con foco, el contenido de `localStorage` y `sessionStorage`, y los controles de menos de 24 px. Los datos completos y las solicitudes al API, con los tokens recortados, están en `mediciones-simulacion.json` y `mediciones-panel.json`.

### Simulación (DONANTE)

**1. Historial con pendientes (CA-06.1)** · `01-historial-pendientes.png`
Resultado: las dos donaciones pendientes muestran «Simular confirmación» y «Simular rechazo»; la confirmada y la rechazada no ofrecen acciones. El rótulo de CA-06.4 encabeza el historial.

**2. Confirmación previa (CA-06.1)** · `02-pedir-confirmacion.png`
Resultado: «¿Confirmar la donación simulada de S/ 250.00? Sumará al avance del proyecto. El resultado no se puede cambiar después.», con «Sí, confirmar» y «Cancelar». El foco pasa a la pregunta.

**3. Confirmada (CA-06.2, CA-09.1)** · `03-confirmada.png`
Resultado: la solicitud fue `POST /v1/donations/{id}/simulate` con el cuerpo `{"outcome":"CONFIRMADA_SIMULADA"}` y el access token. La tarjeta pasa a «Confirmada (simulada)», el mensaje de resultado recibe el foco y el total confirmado sube de S/ 100.00 a S/ 350.00.

**4. Rechazada (CA-06.3)** · `04-rechazada.png`
Resultado: con `{"outcome":"RECHAZADA_SIMULADA"}`, la tarjeta pasa a «Rechazada (simulada)» con el mensaje «No suma al avance del proyecto», y el total confirmado sigue en S/ 350.00.

**5. Avance del proyecto (CA-09.1)** · `05-avance-actualizado.png`
Resultado: el detalle del proyecto confirmado muestra S/ 3,375.50 recaudados: los S/ 3,125.50 previos más los S/ 250.00 confirmados (22.5 % de la meta).

### Panel del gestor (GESTOR)

**6. Panel (HU-08)** · `06-panel.png`
Resultado: tres secciones: «Nuevo proyecto», «Proyectos de esta sesión» (vacía, con la explicación de por qué no se listan borradores anteriores) y «Publicar un borrador anterior».

**7. Errores de validación (CA-08.1, CA-NF06.2)** · `07-errores.png`
Con el título `ab`, sin descripción y con la meta `0`. Resultado: cada campo muestra su error asociado y el foco queda en el primero, «Título». No se envió ninguna solicitud: en `mediciones-panel.json` solo hay un `POST /v1/projects`, el del paso 8.

**8. Borrador creado (CA-08.1, CA-NF02.2)** · `08-borrador-creado.png`
Resultado: la solicitud fue `POST /v1/projects` con el cuerpo `{"title":"Botiquín comunitario en Yura","description":"…","goalAmountCents":1200000}`: sin estado ni acumulado. El mensaje de borrador creado recibe el foco y la tarjeta muestra «Borrador», la meta de S/ 12,000.00 y el identificador.

**9. Confirmar la publicación (CA-08.2)** · `09-confirmar-publicacion.png`
Resultado: «¿Publicar «Botiquín comunitario en Yura»? Aparecerá en el catálogo y aceptará donaciones. Un proyecto publicado no vuelve a borrador.» El foco pasa a la pregunta.

**10. Publicado (CA-08.2)** · `10-publicado.png`
Resultado: la solicitud fue `POST /v1/projects/{id}/publish`, sin cuerpo. La tarjeta pasa a «Publicado» con la fecha y el enlace al catálogo, y el mensaje de resultado recibe el foco. El aviso de «borrador creado» desaparece.

**11. En el catálogo (CA-08.2)** · `11-proyecto-en-catalogo.png`
Resultado: el proyecto tiene detalle público con S/ 0.00 recaudados de S/ 12,000.00. Al GESTOR no se le ofrece donar.

**Mediciones.** En las 11 capturas, el ancho del documento es 375 px (sin desplazamiento horizontal), `localStorage` y `sessionStorage` están vacíos con la sesión iniciada, y no hay controles de menos de 24 px.

**Hallazgos de esta revisión, corregidos antes de las capturas finales:**

- **La hora se partía de su «a. m.».** En el historial, «11:20» quedaba en una línea y «a. m.» en la siguiente. `formatDateTime` (`web/src/lib/dates.ts`) ahora une la hora con su indicador.
- **Aviso contradictorio tras publicar.** El mensaje «Borrador … creado. Puedes publicarlo…» seguía visible después de publicar. Ahora solo se muestra mientras ese proyecto sigue en borrador, y una prueba lo comprueba.

## 3. Capturas contra el stack desplegado (pendiente)

Repetir en el stage `academic` con los usuarios de prueba DONANTE y GESTOR (este último con TOTP, HU-11). Usar una ventana de incógnito nueva y DevTools en **Network** con **Preserve log**. Sanitizar como en `evidence/login-oidc/`.

1. `12-simulate-real.png`: la petición `POST /v1/donations/{id}/simulate` con `200` y, en **Payload**, solo `outcome`.
2. `13-simulate-repetido.png`: repetir la misma simulación con **Replay XHR** en DevTools. Se espera `409` y que el total no cambie.
3. `14-crear-proyecto-real.png`: `POST /v1/projects` con `201` y estado `BORRADOR`.
4. `15-publicar-real.png`: `POST /v1/projects/{id}/publish` con `200` y el proyecto visible en el catálogo.

## Lo que no se probó

- **Contra el API desplegado.** Todo el flujo se probó con el API simulado. El backend ya implementa las tres rutas, con sus propias pruebas (T08 para la concurrencia de la simulación).
- **Fuera del stage académico.** La interfaz muestra un aviso si el API responde `404 NOT_FOUND` en `/simulate`, y hay una prueba con esa respuesta simulada; no se probó contra un stage sin la ruta.
- **Lector de pantalla real.** Los nombres, descripciones, foco y anuncios se comprobaron con Testing Library, axe y la medición del foco en el navegador; no se probó con NVDA ni TalkBack.

## Observaciones

- **El gestor no puede listar sus borradores.** El API no tiene esa ruta (`docs/informe-backend.md`), así que el panel muestra los proyectos creados o publicados en la sesión y ofrece publicar uno anterior por su identificador. Esa lista vive solo en memoria, como los tokens: sobrevive al cambio de página y se borra al cerrar sesión o recargar.
- **Ocultar botones no es autorizar.** La interfaz solo ofrece simular las donaciones pendientes del propio historial y solo muestra el panel a GESTOR, pero el API vuelve a comprobar rol, propietario y estado. Las pruebas cubren que la interfaz informe el 403 y el 409 si el API rechaza.
- **Crear un proyecto no tiene clave de idempotencia en el API.** La SPA evita el doble envío en el cliente; si dos solicitudes llegaran igual, quedarían dos borradores, que no aparecen en el catálogo hasta publicarse.
- Archivos: `web/src/donations/SimulationActions.tsx`, `web/src/donations/queries.ts` (`useSimulateDonation`), `web/src/pages/ManagerPage.tsx`, `web/src/projects/management.ts`, `web/src/components/FormField.tsx` y `web/src/services/errorMessages.ts`.

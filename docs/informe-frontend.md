## Frontend (React), Accesibilidad y OIDC (Gabriel Llerena)

### 4.1 Alcance y pantallas

La interfaz es una SPA en React 19 con Vite y Tailwind CSS. Usa React Router para las rutas, TanStack Query para los datos remotos, React Hook Form con Zod para los formularios y oidc-client-ts para el inicio de sesión. Se publica en CloudFront (sección 5.4) y habla solo con el API y con Cognito. La Tabla 4.1 resume las pantallas.

Tabla 4.1: Pantallas de la SPA

| Ruta | Quién la ve | Contenido | Historia |
| --- | --- | --- | --- |
| `/` | Todos | Catálogo de proyectos publicados con indicadores agregados y estado vacío | HU-01, HU-09 |
| `/proyectos/{id}` | Todos | Detalle, avance en PEN y botón «Donar a este proyecto» | HU-02 |
| `/proyectos/{id}/donar` | DONANTE | Formulario de intención de donación y resultado con la simulación | HU-05, HU-06 |
| `/mis-donaciones` | DONANTE | Historial propio con estado, fecha, importe y opciones para simular | HU-07, HU-06 |
| `/gestor` | GESTOR | Crear borradores y publicarlos | HU-08 |
| `/callback` | Todos | Recibe la respuesta de Cognito y vuelve a la ruta original | HU-03 |

El navegador no confía en el API: cada respuesta se valida con un esquema Zod antes de mostrarse. Lo que no cumple el contrato se trata como error y no se muestra a medias, y los campos que no pertenecen al contrato se descartan. Así, ni un dato de donantes que el API enviara por error llegaría a la pantalla (CA-02.1, CA-09.2). Los montos viajan en céntimos enteros y se convierten a soles sin punto flotante. Los errores se muestran sin códigos internos ni el mensaje del servidor.

### 4.2 Inicio de sesión OIDC con PKCE (HU-03, RNF-HU-11)

El inicio de sesión usa el managed login de Cognito con el flujo Authorization Code y PKCE S256, sin flujo implícito y sin secreto de cliente. La Tabla 4.2 resume los controles de la SPA.

Tabla 4.2: Controles del inicio y cierre de sesión en la SPA

| Control | Cómo se implementa | Criterio |
| --- | --- | --- |
| Authorization Code + PKCE | oidc-client-ts con `response_type=code`; añade `code_challenge` S256 en cada inicio de sesión | CA-03.1 |
| Tokens solo en memoria | Almacén `InMemoryWebStorage`. En `sessionStorage` solo quedan el `state` y el `code_verifier` mientras el usuario está en Cognito, y se borran al volver | CA-NF11.1 |
| Vida corta y renovación | El access token dura 15 minutos y se renueva con el refresh token un minuto antes de vencer. Si la renovación falla, se borra la sesión y se avisa al usuario | CA-03.3 |
| Cierre de sesión | Revoca el refresh token en `/oauth2/revoke`, borra los tokens y la caché de datos y cierra la sesión de Cognito en `/logout` con `logout_uri`. Si la revocación falla, el cierre continúa | CA-03.3 |
| Solo access token al API | El cliente HTTP envía el access token, nunca el ID token | T11, CA-NF02.1 |
| Retorno seguro | Tras el login el usuario vuelve a la ruta que intentaba abrir. La ruta se valida: se rechazan otros orígenes, `//` y `javascript:` (redirección abierta) | HU-03 |
| Callback limpio | El código se canjea una sola vez, aunque React ejecute el efecto dos veces, y `code` y `state` no quedan en la URL | HU-03 |

Se verificó contra el Cognito desplegado, con capturas sanitizadas en `evidence/login-oidc/`. La solicitud de autorización lleva `code_challenge_method=S256`. El canje lleva `code_verifier` y no `client_secret`. Cognito responde `expires_in: 900`. Con la sesión iniciada, `localStorage` y `sessionStorage` están vacíos. Al cerrar sesión se ve primero el `revoke` y después el `logout`, y volver a entrar pide credenciales.

Una observación importante: Cognito acepta un `authorize` sin `code_challenge` para un cliente público (sección 6.3), así que PKCE lo garantiza la SPA. Para que una regresión no pase desapercibida, una prueba falla si se desactiva PKCE.

### 4.3 La interfaz no autoriza (CA-04.3)

La SPA lee los roles de `cognito:groups` solo para adaptar la interfaz: mostrar u ocultar el panel del gestor, el historial o el botón de donar. Esos guards son experiencia de uso. Quien decide es el API, que vuelve a comprobar scope, rol y propietario en cada solicitud (secciones 6.1 y 6.4, prueba T03). Por eso la interfaz también está preparada para el rechazo: si el API responde 401, ofrece volver a iniciar sesión. Un 403 y un 409 los explica con un mensaje comprensible. Un 404 del detalle se presenta igual para un borrador y para un id inexistente, sin revelar cuál es.

### 4.4 Accesibilidad WCAG 2.2 AA (RNF-HU-06)

Se evaluaron los 55 criterios de nivel A y AA de WCAG 2.2. La Tabla 4.3 resume el resultado por principio, y la evaluación criterio por criterio está en `evidence/accesibilidad/`.

Tabla 4.3: Resultado de la evaluación WCAG 2.2 AA

| Principio | Criterios | Cumple | No aplica | No verificado |
| --- | --- | --- | --- | --- |
| Perceptible | 20 | 12 | 8 (sin audio, video ni tooltips) | 0 |
| Operable | 20 | 15 | 5 (sin atajos, gestos ni arrastre) | 0 |
| Comprensible | 13 | 11 | 1 (sin mecanismo de ayuda) | 1 (3.3.8, login de Cognito) |
| Robusto | 2 | 2 | 0 | 0 |
| **Total** | **55** | **40** | **14** | **1** |

Las decisiones principales fueron estas:

- **Estructura semántica:** cada página tiene landmarks (`header`, `nav`, `main`, `footer`), un solo `h1`, secciones con `h2` y montos en listas de definición. Un enlace «Saltar al contenido principal» es lo primero al pulsar Tab.
- **Foco gestionado:** en una SPA el navegador no mueve el foco al cambiar de ruta, así que se lleva al `h1` y se actualiza el título de la pestaña. Al registrar una donación, el foco pasa al resultado. Al elegir simular o publicar, pasa a la pregunta de confirmación. Al cancelar, vuelve al botón elegido.
- **Formularios:** etiquetas visibles, ayudas con el formato y un ejemplo, y errores en texto unidos al campo con `aria-describedby` y `aria-invalid`. Al enviar con errores, el foco va al primer campo inválido.
- **Visibilidad:** contorno de foco de 3 px en todos los elementos y controles de al menos 44 px de alto. Los estados se dicen en texto, no solo con color, y el encabezado no es fijo para que nunca tape el elemento con foco.

La verificación combinó tres métodos, resumidos en la Tabla 4.4.

Tabla 4.4: Métodos de verificación de accesibilidad

| Método | Qué mide | Resultado |
| --- | --- | --- |
| axe-core en las pruebas de componentes | Reglas WCAG A y AA en cada pantalla y en cada estado (carga, vacío, error y resultado) | 0 violaciones |
| Pruebas de contraste y de teclado | Contraste de 21 combinaciones de colores del tema. Flujos de donar, simular, crear y publicar solo con teclado, y ausencia de trampas de foco | Todas superadas; contraste de texto mínimo 6.14:1 y de foco 4.95:1 |
| Navegador real a 375 y 320 px | axe con contraste renderizado, desplazamiento horizontal, controles de menos de 24 px, espaciado de texto (1.4.12) y foco visible | 0 violaciones, sin desplazamiento horizontal ni controles pequeños |

La revisión en el navegador encontró tres enlaces sueltos («Volver al inicio» en la página 404, en el error del login y en la página de error inesperado) sin la altura mínima de 44 px. Se corrigieron.

### 4.5 Informe de experiencia de usuario

**Usuarios y tareas.** La interfaz atiende tres perfiles con objetivos distintos, resumidos en la Tabla 4.5.

Tabla 4.5: Perfiles y tareas principales

| Perfil | Objetivo | Recorrido principal |
| --- | --- | --- |
| Visitante | Conocer las causas antes de decidir | Catálogo → detalle → «Donar a este proyecto», que lo lleva al login y lo devuelve al formulario |
| Donante | Registrar un aporte de prueba y seguir su estado | Formulario con un solo campo → resultado con simulación → historial |
| Gestor | Publicar campañas sin errores | Crear borrador → revisar → publicar con confirmación → ver el proyecto en el catálogo |

**Decisiones de diseño.**

- **Un solo dato para donar:** el formulario pide solo el monto. Acepta «25.50», «25,50» o «S/ 25.50» y abre el teclado numérico en el móvil. Un texto aclara que no se piden tarjeta, CVV, cuenta bancaria ni DNI (CA-05.5).
- **Honestidad sobre la simulación:** el rótulo «Simulación académica: no se ha realizado ningún cobro» acompaña a toda pantalla que muestra una donación (CA-06.4). El pie de página recuerda que la fundación es ficticia y que no se procesan pagos reales (CA-NF10.2). Los totales dicen «Recaudado (simulado)».
- **Confirmar lo irreversible:** simular un resultado y publicar un proyecto no se pueden deshacer, así que piden confirmación con el monto o el título a la vista. La confirmación es en línea, no una ventana modal: funciona igual a 375 px y no atrapa el foco.
- **Sin callejones sin salida:** el visitante ve el botón «Donar» con la nota «Necesitas iniciar sesión como donante», y tras el login vuelve al formulario. Cada carga tiene estados de espera, vacío y error con «Reintentar». Si la sesión expira a mitad de un envío, se ofrece volver a iniciar sesión.
- **Pensado primero para móvil:** a 375 px los indicadores se agrupan en una tarjeta de tres filas para no empujar el catálogo fuera de la pantalla. Los botones principales ocupan todo el ancho, y los montos e identificadores largos se parten sin desbordar.
- **Mensajes en el idioma del usuario:** montos en formato PEN, fechas en hora de Lima y errores que dicen cómo corregir («El monto mínimo es S/ 1.00.»), sin códigos técnicos.

**Evaluación heurística.** Se revisó la interfaz con las diez heurísticas de Nielsen (Tabla 4.6).

Tabla 4.6: Evaluación heurística de Nielsen

| Heurística | Cómo se atiende |
| --- | --- |
| Visibilidad del estado del sistema | Botones que cambian a «Registrando…» o «Publicando…», estados de carga y estado de cada donación en texto |
| Relación con el mundo real | Soles y céntimos como los usa el donante, estados en español («Pendiente de simulación») |
| Control y libertad del usuario | «Cancelar» en cada confirmación, «Registrar otra donación» y enlaces de regreso en cada pantalla |
| Consistencia y estándares | Mismo encabezado, pie, botones y rótulo de simulación en todas las pantallas |
| Prevención de errores | Validación del monto antes de enviar, botón deshabilitado durante el envío y clave de idempotencia para que un reintento no duplique |
| Reconocer antes que recordar | Rango y ejemplo visibles junto a cada campo, y el proyecto y el monto repetidos en la confirmación |
| Flexibilidad y eficiencia | Todo se hace con teclado, y Enter envía los formularios |
| Diseño estético y minimalista | Una tarea por pantalla, sin datos innecesarios del donante |
| Recuperarse de errores | Mensajes que explican qué pasó y cómo seguir, con «Reintentar» o «Iniciar sesión» |
| Ayuda y documentación | Ayudas junto a cada campo; no hay una sección de ayuda aparte |

**Hallazgos corregidos durante el desarrollo.** En el historial, la hora se partía entre «a.» y «m.» a 375 px. Tras publicar, el aviso «Borrador creado, puedes publicarlo» seguía visible. Cuatro enlaces sueltos medían menos de 44 px. Los tres problemas se encontraron al revisar las pantallas en el navegador y se corrigieron. El del aviso quedó cubierto por una prueba. Los otros dos dependen del diseño renderizado, así que se comprueban en el navegador.

**Límites de esta evaluación.** No se hicieron pruebas con usuarios reales ni con lector de pantalla. La evaluación es heurística y técnica, y una prueba corta con tres o cuatro personas de cada perfil sería el siguiente paso.

### 4.6 Pruebas y trazabilidad

Las pruebas de componentes usan Vitest y Testing Library sobre la aplicación completa: router, proveedores, cliente OIDC y cliente del API reales. Solo se simula la red, que imita al API según `docs/api.yaml` e incluye la idempotencia y la regla de que solo la primera simulación suma al acumulado. La Tabla 4.7 resume la cobertura.

Tabla 4.7: Pruebas del frontend

| Área | Pruebas | Qué cubren |
| --- | --- | --- |
| Inicio de sesión, configuración y cliente del API | 57 | PKCE, tokens en memoria, revocación, retorno seguro, guards, solo HTTPS y envío del access token (CA-03.1, CA-03.3, CA-NF11.1, T11) |
| Catálogo, detalle e indicadores | 17 | Solo publicados, estado vacío, 404 sin revelar borradores y totales confirmados (HU-01, HU-02, HU-09) |
| Donación e historial | 40 | Céntimos, límites del monto, `Idempotency-Key`, datos de pago ausentes e historial propio (HU-05, HU-07, T04 y T12 desde la interfaz) |
| Simulación y panel del gestor | 35 | Confirmación previa, un solo envío, 409 explicado, crear y publicar (HU-06, HU-08) |
| Montos y fechas | 33 | Conversión de soles a céntimos sin punto flotante y formato PEN |
| Accesibilidad | 38 | Contraste del tema, flujos con teclado, landmarks, enlace de salto, foco y títulos (RNF-HU-06). Las demás áreas incluyen además axe en cada pantalla |
| **Total** | **220** | |

Para comprobar que las pruebas detectan errores, se rompió a propósito cada control, uno por vez: tokens en `localStorage`, PKCE desactivado, el monto en soles en lugar de céntimos, una clave de idempotencia nueva en cada reintento, el foco sin moverse, entre otros. En las cuatro rondas documentadas se detectaron las 75 mutaciones (29 de login, 12 del catálogo, 25 de donación e historial y 9 de accesibilidad). Además, el ejercicio reveló pruebas que no podían fallar, y se reforzaron. El CI ejecuta lint, typecheck, pruebas y build en cada pull request.

### 4.7 Limitaciones

- **Recargar la página cierra la sesión en la SPA:** es el costo de tener los tokens solo en memoria (CA-NF11.1). Volver a una ruta protegida pasa por Cognito, que no pide contraseña si su sesión sigue activa. Por la misma razón, la `Idempotency-Key` se pierde al recargar: un envío repetido tras recargar crea otra donación pendiente, que no suma hasta confirmarse.
- **El gestor no puede listar sus borradores:** el API no tiene esa ruta (sección 3.6). El panel muestra los proyectos creados en la sesión y permite publicar uno anterior por su identificador.
- **MFA del gestor:** en el login real, el GESTOR de prueba entró sin segundo factor, porque el pool tiene MFA opcional y ese usuario no tiene TOTP (sección 6.3). Es un control de Cognito, no de la SPA.
- **Evidencia contra el stack desplegado:** el login se probó contra Cognito real. La donación, el historial, la simulación y el panel del gestor se probaron con un API simulado según el contrato, y sus capturas contra el entorno académico quedan pendientes.
- **Sin lector de pantalla:** nombres, descripciones y anuncios se comprobaron con Testing Library y axe, no con NVDA ni TalkBack. El login de Cognito (criterio 3.3.8) es una interfaz de AWS y no se auditó.

### Para «Lecciones aprendidas»

- **Una prueba en verde no prueba nada hasta que falla (Gabriel Llerena):** romper a propósito cada control reveló pruebas que no podían fallar, como una que medía la redirección a Cognito antes de que llegara la segunda llamada. Desde entonces, cada control se dio por cubierto solo cuando al romperlo fallaba al menos una prueba.
- **PKCE lo garantiza el cliente (Gabriel Llerena):** Cognito acepta un cliente público sin `code_challenge`. Si la SPA dejara de enviarlo, nadie lo notaría sin una prueba que lo exija.
- **La accesibilidad se mide en el navegador (Gabriel Llerena):** axe en jsdom no calcula contraste ni tamaños. Los enlaces de menos de 44 px y la hora partida en dos líneas solo aparecieron al revisar las pantallas a 375 px en un navegador real.

### Para «Conclusiones»

- **La interfaz informa, el API decide (Gabriel Llerena):** ocultar el panel del gestor o el botón de donar mejora la experiencia, pero no protege nada. Por eso la SPA envía solo el access token, no manda identidad en el cuerpo y está preparada para explicar un 401, un 403 o un 409 cuando el API rechaza.
- **Seguridad y accesibilidad sin oponerse (Gabriel Llerena):** los tokens viven solo en memoria, las acciones irreversibles se confirman y los errores no muestran detalles internos, y la interfaz cumple los 40 criterios de WCAG 2.2 AA aplicables y verificados. Se usa con teclado y a 320 px de ancho.

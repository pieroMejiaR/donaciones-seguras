# Evidencia: accesibilidad WCAG 2.2 AA y pruebas de interfaz

**Requisitos:** RNF-HU-06 (CA-NF06.1, CA-NF06.2); apoyo a HU-01 a HU-09 desde la interfaz
**Responsable:** Gabriel Llerena · **Fecha:** 2026-11-12

Sanitizado: la revisión en navegador usó la SPA en `localhost` con proyectos ficticios inyectados en la página. No hay IDs del pool, `client_id`, correos ni tokens.

| Parte | Estado |
| --- | --- |
| 1. Evaluación de los criterios WCAG 2.2 A y AA aplicables | Hecha: tabla de §1 |
| 2. Pruebas automatizadas nuevas: contraste del tema y flujos solo con teclado | Hecha |
| 3. Pruebas de mutación sobre esas pruebas | Hecha: 9 de 9 detectadas |
| 4. Revisión en navegador a 375 px y 320 px de las páginas públicas | Hecha |
| 5. Lector de pantalla real (NVDA, TalkBack) | **Pendiente** |

Esta carpeta reúne la evaluación completa. Las pantallas con sesión ya se revisaron a 375 px en [`donacion-historial/`](../donacion-historial/README.md) y [`simulacion-gestor/`](../simulacion-gestor/README.md); aquí se cita esa evidencia en lugar de repetirla.

## 1. Evaluación WCAG 2.2 nivel AA

Se evaluaron los 55 criterios de nivel A y AA de WCAG 2.2 (4.1.1 ya no forma parte de 2.2). «No aplica» significa que la interfaz no tiene ese tipo de contenido.

**Cómo leer la columna «Evidencia»:** *axe* son las comprobaciones automáticas que corren en cada pantalla dentro de las pruebas; *teclado* es `web/src/app/keyboard.test.tsx`; *contraste* es `web/src/styles.test.ts`; *navegador* es la revisión de §4.

### Perceptible

| Criterio | Nivel | Resultado | Cómo se cumple | Evidencia |
| --- | --- | --- | --- | --- |
| 1.1.1 Contenido no textual | A | Cumple | No hay imágenes. La barra de avance es decorativa (`aria-hidden`) y su valor está en texto («20.8 % de la meta»). El prefijo «S/» del campo es decorativo: la etiqueta ya dice «en soles (PEN)». | axe |
| 1.2.1 a 1.2.5 Multimedia | A/AA | No aplica | Sin audio ni video. | — |
| 1.3.1 Información y relaciones | A | Cumple | Landmarks (`header`, `nav`, `main`, `footer`), un `h1` por página y `h2`/`h3` por sección, montos en listas de definición (`dl`), etiquetas `label` y ayudas y errores unidos con `aria-describedby`. | axe; prueba de landmarks en `app.test.tsx` |
| 1.3.2 Secuencia significativa | A | Cumple | El orden del DOM es el orden visual; en móvil el diseño solo apila. | teclado (orden de los campos) |
| 1.3.3 Características sensoriales | A | Cumple | Ninguna instrucción depende de forma, posición o color. | Revisión |
| 1.3.4 Orientación | AA | Cumple | No se bloquea la orientación. | Revisión |
| 1.3.5 Identificar el propósito de la entrada | AA | No aplica | Los campos piden un monto, un título o un identificador de proyecto, no datos personales del usuario. Login y registro están en Cognito. | — |
| 1.4.1 Uso del color | A | Cumple | El estado de una donación o proyecto se dice en texto («Estado: Pendiente de simulación»); el color solo lo refuerza. Los enlaces van subrayados. | Mutación «el estado solo se distingue por color», detectada en `donacion-historial/` |
| 1.4.2 Control del audio | A | No aplica | Sin audio. | — |
| 1.4.3 Contraste mínimo | AA | Cumple | 12 combinaciones de texto del tema, todas ≥ 4.5:1 (la menor, `muted` sobre `canvas`, 6.14:1). | contraste; axe con `color-contrast` en navegador |
| 1.4.4 Cambio de tamaño del texto | AA | Cumple | Tamaños en `rem`; a 320 px de ancho (equivalente a 400 % de zoom) no se pierde contenido. | navegador |
| 1.4.5 Imágenes de texto | AA | Cumple | No hay imágenes de texto. | — |
| 1.4.10 Reajuste del contenido (reflow) | AA | Cumple | Sin desplazamiento horizontal a 375 px ni a 320 px. Identificadores y montos largos se parten (`break-all`). | navegador |
| 1.4.11 Contraste de elementos no textuales | AA | Cumple | Borde de campos, borde del botón secundario e indicador de foco ≥ 3:1 sobre todos los fondos donde aparecen (el foco, 4.95:1 en el peor caso). | contraste |
| 1.4.12 Espaciado del texto | AA | Cumple | Con interlineado 1.5, letras 0.12 em, palabras 0.16 em y párrafos 2 em no hay contenido recortado ni desplazamiento horizontal. | navegador |
| 1.4.13 Contenido en hover o foco | AA | No aplica | Sin tooltips ni menús emergentes. | — |

### Operable

| Criterio | Nivel | Resultado | Cómo se cumple | Evidencia |
| --- | --- | --- | --- | --- |
| 2.1.1 Teclado | A | Cumple | Donar y simular (donante) y crear y publicar (gestor) se completan solo con Tab, Enter y Espacio. Solo se usan `button`, `a` e `input` nativos. | teclado |
| 2.1.2 Sin trampas para el foco | A | Cumple | Mayús+Tab recorre la página hacia atrás hasta el enlace de salto. Las confirmaciones son en línea, no modales. | teclado |
| 2.1.4 Atajos de teclado | A | No aplica | Sin atajos de una tecla. | — |
| 2.2.1 Tiempo ajustable | A | Cumple | El access token dura 15 min (CA-03.3) pero se renueva solo con el refresh token (`automaticSilentRenew`). Si la sesión termina, se avisa y se ofrece volver a iniciar sesión. | `app.test.tsx`: «si la sesión expira avisa…» |
| 2.2.2 Pausar, detener, ocultar | A | No aplica | Nada se mueve ni se actualiza solo. | — |
| 2.3.1 Tres destellos | A | Cumple | Sin animaciones; con `prefers-reduced-motion` se anulan transiciones. | Revisión |
| 2.4.1 Evitar bloques | A | Cumple | «Saltar al contenido principal» es lo primero con Tab y mueve el foco a `main`. | `app.test.tsx` |
| 2.4.2 Titulado de páginas | A | Cumple | Cada página fija `document.title` como «Título · Donaciones Seguras». | `app.test.tsx`; navegador |
| 2.4.3 Orden del foco | A | Cumple | Al cambiar de ruta, el foco va al `h1`. Al registrar una donación, al resultado. Al elegir simular o publicar, a la pregunta de confirmación. Al cancelar, vuelve al botón elegido. | teclado; pruebas de cada pantalla |
| 2.4.4 Propósito de los enlaces | A | Cumple | Los enlaces de proyectos son su título; «Ver «título» en el catálogo» en el panel. | axe |
| 2.4.5 Múltiples vías | AA | Cumple | Las secciones se alcanzan desde la navegación principal. El catálogo lista todos los proyectos publicados y sirve de mapa; el historial y el panel enlazan también a cada proyecto. | Revisión |
| 2.4.6 Encabezados y etiquetas | AA | Cumple | Encabezados y etiquetas describen el contenido («Monto a donar en soles (PEN)»). | Revisión |
| 2.4.7 Foco visible | AA | Cumple | Contorno de 3 px `#b3400f` en `:focus-visible` para todo elemento. Medido en navegador en cada parada del recorrido con Tab. | navegador |
| 2.4.11 Foco no oculto (mínimo) | AA | Cumple | El encabezado no es fijo, así que nada tapa el elemento con foco. En el recorrido con Tab, cada elemento enfocado quedó dentro de la ventana. | navegador |
| 2.5.1 Gestos del puntero | A | No aplica | Sin gestos multipunto ni de trazo. | — |
| 2.5.2 Cancelación del puntero | A | Cumple | Controles nativos: la acción ocurre al soltar. | — |
| 2.5.3 Etiqueta en el nombre | A | Cumple | El nombre accesible empieza por el texto visible («Publicar «Botiquín rural»» para el botón «Publicar»). | teclado (busca el botón por ese nombre) |
| 2.5.4 Activación por movimiento | A | No aplica | — | — |
| 2.5.7 Movimientos de arrastre | AA | No aplica | Nada se arrastra. | — |
| 2.5.8 Tamaño del objetivo (mínimo) | AA | Cumple | Botones, campos y enlaces sueltos miden al menos 44 px de alto. Ningún control mide menos de 24 px. Esta ronda corrigió tres enlaces sueltos que no tenían la altura mínima (§5). | navegador; axe `target-size` |

### Comprensible

| Criterio | Nivel | Resultado | Cómo se cumple | Evidencia |
| --- | --- | --- | --- | --- |
| 3.1.1 Idioma de la página | A | Cumple | `<html lang="es">`. | axe |
| 3.1.2 Idioma de las partes | AA | Cumple | Todo el texto visible está en español. | Revisión |
| 3.2.1 Al recibir el foco | A | Cumple | Enfocar no cambia el contexto. | — |
| 3.2.2 Al introducir datos | A | Cumple | Escribir no envía nada; se envía con el botón o Enter. | teclado |
| 3.2.3 Navegación coherente | AA | Cumple | Encabezado, navegación y pie comunes a todas las páginas (`Layout`). | — |
| 3.2.4 Identificación coherente | AA | Cumple | El mismo rótulo de simulación (`SimulationNotice`) y los mismos nombres de estado en todas las pantallas. | — |
| 3.2.6 Ayuda coherente | A | No aplica | La SPA no ofrece un mecanismo de ayuda. | — |
| 3.3.1 Identificación de errores | A | Cumple | El error aparece en texto bajo el campo, con `aria-invalid` y unido por `aria-describedby`. El foco va al primer campo inválido. | teclado; pruebas de formularios |
| 3.3.2 Etiquetas o instrucciones | A | Cumple | Etiquetas visibles y ayudas con el formato y un ejemplo («Entre S/ 1.00 y S/ 1,000.00 …»). | — |
| 3.3.3 Sugerencias ante errores | AA | Cumple | El mensaje dice cómo corregir («El monto mínimo es S/ 1.00.»). | Pruebas T04 de la interfaz |
| 3.3.4 Prevención de errores (financieros) | AA | Cumple | La intención queda pendiente y no suma hasta que se simula. Simular un resultado o publicar un proyecto, que no se pueden deshacer, pide confirmación explícita. | `simulation.test.tsx`; `manager.test.tsx` |
| 3.3.7 Entrada redundante | A | Cumple | No se pide dos veces el mismo dato. | — |
| 3.3.8 Autenticación accesible (mínimo) | AA | **No verificado** | El login es el managed login de Cognito, fuera del código del equipo. Admite gestores de contraseñas. El código TOTP se copia desde la app autenticadora. No se auditó esa interfaz. | — |

### Robusto

| Criterio | Nivel | Resultado | Cómo se cumple | Evidencia |
| --- | --- | --- | --- | --- |
| 4.1.2 Nombre, función, valor | A | Cumple | Controles nativos; botones deshabilitados durante el envío con texto que lo indica («Registrando…»). | axe |
| 4.1.3 Mensajes de estado | AA | Cumple | Cargas con `role="status"`, errores con `role="alert"`, resultados con `role="status"` y foco. | teclado; pruebas de cada pantalla |

**Resumen:** 40 criterios cumplen, 14 no aplican y 1 no se verificó (3.3.8, interfaz de Cognito).

## 2. Pruebas automatizadas nuevas

```bash
npm test -w web
```

Resultado (2026-11-12, local): 220 de 220 pruebas de la SPA superadas, 29 de ellas nuevas en esta ronda (23 de contraste y 6 de teclado y página de error). Lint, typecheck y build en verde.

**Contraste del tema** (`web/src/styles.test.ts`). axe no calcula contraste en jsdom, así que la prueba lee los colores del bloque `@theme` de `web/src/styles.css` y aplica la fórmula de WCAG. Cada combinación de la lista es una que la interfaz usa; si alguien cambia un color, la prueba nombra la combinación que deja de cumplir.

```text
✓ la fórmula coincide con los valores de referencia de WCAG
✓ lee todos los colores del tema
✓ CA-NF06.2 (1.4.3): 12 combinaciones de texto ≥ 4.5:1
✓ CA-NF06.2 (1.4.11): 9 combinaciones de bordes y foco ≥ 3:1
```

**Flujos solo con teclado** (`web/src/app/keyboard.test.tsx`). Cada paso se hace con `Tab`, `Enter` o `Espacio`, y comprueba a dónde va el foco cuando el contenido cambia.

```text
✓ HU-05 y HU-06: un donante va del detalle a la donación y la simula sin ratón
✓ HU-06: Cancelar con el teclado devuelve el foco al botón elegido
✓ HU-08: un gestor crea y publica un proyecto sin ratón
✓ CA-NF06.2: un error de validación lleva el foco al primer campo inválido
✓ no hay trampas de foco: Mayús+Tab recorre la página hacia atrás hasta el inicio
✓ página de error inesperado: no muestra detalles técnicos y no tiene violaciones de axe
```

Las pruebas anteriores siguen cubriendo axe en cada pantalla y estado, el enlace de salto, el foco al cambiar de ruta, `aria-current` y el título del documento (`app.test.tsx` y `pages/*.test.tsx`).

## 3. Pruebas de mutación

Como en las otras evidencias: se rompió a propósito cada control, uno por vez, se ejecutó la prueba correspondiente y se restauró el archivo.

Ejecución del 2026-11-12 sobre `gabriel/accesibilidad-ui`, con los cambios aún sin commit:

| Criterio | Control roto a propósito | Prueba que lo detecta | Resultado |
| --- | --- | --- | --- |
| 1.4.3 | Texto `muted` aclarado a `#8a9596` | `styles.test.ts` | Detectado |
| 1.4.3 | Rótulo de simulación (`warning`) aclarado a `#c27a1a` | `styles.test.ts` | Detectado |
| 1.4.11 | Color del foco aclarado a `#f0b090` | `styles.test.ts` | Detectado |
| 2.1.1 | «Donar a este proyecto» con `tabIndex={-1}` | `keyboard.test.tsx` | Detectado |
| 2.4.3 | El foco no pasa a la pregunta al elegir simular | `keyboard.test.tsx` | Detectado |
| 2.4.3 | «Cancelar» no devuelve el foco al botón elegido | `keyboard.test.tsx` | Detectado |
| 3.3.1 | El formulario del gestor no lleva el foco al campo con error (`shouldFocusError: false`) | `keyboard.test.tsx` | Detectado |
| 4.1.3 | El resultado del gestor no recibe el foco | `keyboard.test.tsx` | Detectado |
| — | La página de error inesperado muestra el mensaje interno | `keyboard.test.tsx` | Detectado |

**Resultado: 9 de 9 detectados.**

No se incluyó la altura mínima de los enlaces (2.5.8): jsdom no calcula diseño, así que ninguna prueba de componentes puede medirla. Se comprueba en el navegador (§4).

## 4. Revisión en navegador

### Preparación

- Chromium del panel de navegador de Claude Code, viewport emulado de 375 × 812 px (modo móvil) y de 320 × 640 px.
- SPA real en `http://localhost:5173` (`npm run dev -w web`) contra el API desplegado. El API desplegado no tenía proyectos publicados, así que, tras revisar el estado vacío, se reemplazó `fetch` en la página para devolver tres proyectos ficticios según `docs/api.yaml`. Uno tiene título y descripción largos y otro una meta de S/ 1,000,000.00, para forzar el ajuste de línea.
- axe-core 4.14 cargado desde `web/node_modules` con las etiquetas `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` y `best-practice`, **con** la regla `color-contrast`, que en jsdom está desactivada.
- Script reutilizable: [`auditoria-navegador.js`](auditoria-navegador.js). Se pega en la consola de DevTools con la SPA abierta.

### Resultados

| Pantalla | Ancho | Violaciones axe | Ancho del documento | Controles < 24 px |
| --- | --- | --- | --- | --- |
| Catálogo vacío (API desplegado) | 375 | 0 | 375 | 0 |
| Catálogo con 3 proyectos | 375 | 0 | 375 | 0 |
| Detalle sin sesión (visitante) | 375 | 0 | 375 | 0 |
| Detalle con error 500 del API («Reintentar») | 375 | 0 | 375 | 0 |
| Página 404 | 375 | 0 | 375 | 0 |
| Página 403 | 375 | 0 | 375 | 0 |
| Catálogo, detalle, 403 y 404 | 320 | — | 320 | — |

- **Contraste medido:** `color-contrast` evaluó 36 nodos de texto en el catálogo con proyectos y 20 en el detalle, sin fallos y sin casos «incompletos» (los que axe no puede decidir, como texto sobre imágenes).
- **Espaciado de texto (1.4.12):** con el estilo de la prueba aplicado, en el catálogo y el detalle solo quedan «recortados» los textos `sr-only`, que están ocultos a propósito.
- **Foco (2.4.7, 2.4.11):** recorrido con Tab real en el catálogo. En los 7 elementos recorridos (enlace de salto, logo, «Iniciar sesión», «Inicio» y los tres proyectos) el contorno computado es `solid 3px rgb(179, 64, 15)` y el elemento queda dentro de la ventana.
- **Almacenamiento:** `localStorage` y `sessionStorage` vacíos en todas las pantallas.

### Capturas

**1. Catálogo a 375 px** · `01-catalogo-375.jpg`
Indicadores en una sola tarjeta de tres filas, montos en PEN sin desbordar y el título largo del primer proyecto partido en dos líneas.

**2. Foco visible** · `02-foco-375.jpg`
Desde el `h1`, donde el cambio de ruta deja el foco, un Tab lo lleva al primer proyecto, que muestra el contorno de 3 px.

**3. Detalle a 320 px con el espaciado de 1.4.12** · `03-detalle-320-espaciado.jpg`
Con interlineado, espaciado entre letras y entre palabras aumentados, el texto se reacomoda sin cortarse ni generar desplazamiento horizontal. El botón «Iniciar sesión» pasa a otra línea.

### Pantallas con sesión

Las pantallas con sesión (formulario, historial, simulación y panel del gestor) se revisaron a 375 px en las evidencias anteriores, con las mismas mediciones de ancho, controles < 24 px y almacenamiento: 7 capturas en `donacion-historial/` y 11 en `simulacion-gestor/`. Su contraste queda cubierto por `styles.test.ts`, porque usan las mismas combinaciones de colores.

## 5. Hallazgos corregidos en esta ronda

- **Enlaces sueltos de menos de 44 px.** «Volver al inicio» en la página 404, en el error del callback de login y en la página de error inesperado no tenían la altura mínima que sí tenían los demás enlaces sueltos. Ya se había corregido en la página 403 (`donacion-historial/`). Ahora los cuatro usan `inline-flex min-h-11 items-center`.
- **Contraste sin prueba automática.** El contraste se había calculado a mano en `donacion-historial/`. Ahora lo comprueba una prueba en CI y no depende de que alguien lo recalcule.
- **Página de error inesperado sin prueba.** No había ninguna prueba que verificara que no muestra el error interno; ahora la hay.

## Lo que no se probó

- **Lector de pantalla real.** Los nombres, descripciones y anuncios se comprobaron con Testing Library y axe; no se probó con NVDA ni TalkBack. Recomendado antes de la sustentación: recorrer donar → simular con NVDA + Chrome.
- **Managed login de Cognito (3.3.8).** Es una interfaz de AWS; no se auditó.
- **Pantallas con sesión en navegador contra el stack desplegado.** Se revisaron con Cognito y API simulados (ver evidencias citadas).
- **Zoom del navegador al 200 %.** Se cubre por inferencia con la revisión a 320 px, que es más exigente.

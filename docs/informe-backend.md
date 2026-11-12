# Informe técnico: backend

**Autor:** Santiago Callocondo · **Rol:** backend (dominio, idempotencia y concurrencia)
**Alcance:** módulos `projects`, `donations` y `audit` de `api/src/`, contrato `docs/api.yaml` y diseño de datos `docs/data-model.md`.

## 1. Qué se construyó

| Ruta | Acceso | Historia |
| --- | --- | --- |
| `GET /v1/projects` | Público | HU-01 |
| `GET /v1/projects/{id}` | Público | HU-02 |
| `GET /v1/stats` | Público | HU-09 |
| `POST /v1/projects` | GESTOR | HU-08 |
| `POST /v1/projects/{id}/publish` | GESTOR | HU-08 |
| `POST /v1/donations` | DONANTE | HU-05 |
| `POST /v1/donations/{id}/simulate` | DONANTE, solo stage `academic` | HU-06 |
| `GET /v1/donations/me` | DONANTE | HU-07 |

Además, el módulo `audit` registra cada operación de escritura y el formato de error es uniforme en todas las rutas.

## 2. Recorrido de una solicitud

1. **API Gateway** valida la firma, el emisor, la audiencia, la expiración y el scope del access token (PEP perimetral).
2. **`withHttp`** envuelve cada handler: convierte cualquier error en `{ code, message, requestId }` y escribe una línea de log JSON con `requestId`, acción, resultado y duración, sin cuerpos ni tokens (RNF-HU-07, RNF-HU-10).
3. **Autorización en Lambda:** se vuelven a comprobar el scope y el rol (`cognito:groups`) y, en donaciones, el dueño del recurso. Es necesario porque Cognito concede cualquier scope del app client a quien lo pida: un DONANTE puede obtener `api/projects.write`, y lo que lo detiene es el rol.
4. **Validación con Zod** de esquemas estrictos: un campo que decide el servidor (`status`, `donorSub`, `role`) o un dato de pago responde 400 (CA-NF02.2, CA-05.5).
5. **Repositorio DynamoDB:** cada cambio de estado se escribe en un `TransactWriteItems` junto con su evento de auditoría.

## 3. Decisiones de diseño

- **Montos en céntimos enteros.** Evita errores de redondeo, y un importe «con más de dos decimales» deja de ser válido por tipo.
- **Consultas por índice, nunca `Scan`.** El catálogo consulta la partición `STATUS#PUBLICADO` y el historial, `DONOR#<sub>`. Así, por construcción, no se puede pedir el historial de otra persona (RNF-HU-05, CA-07.1).
- **Mismo 404 para lo que no se debe ver.** Un borrador, una donación ajena y un id inventado responden igual, para que la respuesta no revele qué existe (CA-02.2, CA-07.2).
- **Auditoría transaccional y seudonimizada.** No hay cambio sin evento ni evento sin cambio (CA-08.3). El actor se guarda como `usr_` más un SHA-256 recortado del `sub` (CA-10.2). Los intentos denegados o rechazados también se registran.
- **Idempotencia (CA-05.4).** La clave se guarda por usuario (`IDEMP#<sub>#<clave>`) con el hash del cuerpo ya validado y la respuesta original, y vence en 24 h. Misma clave y mismo cuerpo devuelven la respuesta original; otro cuerpo, 409. Si dos solicitudes con la misma clave llegan a la vez, la condición de la transacción deja escribir solo a una.
- **Concurrencia en la confirmación (CA-06.2, CA-NF04.1).** La transición está condicionada a `PENDIENTE_SIMULACION`, en la misma transacción que el `ADD` al acumulado. Se eligió esto en lugar de una agregación derivada, porque las lecturas quedan baratas y el estado y el total cambian juntos. La justificación completa está en `docs/data-model.md` (CA-NF04.2).

## 4. Trazabilidad y pruebas

| Prueba | Escenario | Dónde | Estado |
| --- | --- | --- | --- |
| T01 | El visitante ve solo publicados | `projects.read.test.ts`, `evidence/T01` | Superada (unitaria) |
| T03 | Un donante intenta crear o publicar | `projects.write.test.ts` | Superada (unitaria); evidencia de Paolo |
| T04 | S/ 0 o S/ 1000.01 | `donations.create.test.ts`, `evidence/T04` | Superada (unitaria) |
| T05 | Intención válida | `donations.create.test.ts`, `evidence/T05` | Superada (unitaria) |
| T06 | Repetición idéntica | `donations.create.test.ts`, `evidence/T06` | Superada (unitaria) |
| T07 | Misma clave, otro cuerpo | `donations.create.test.ts`, `evidence/T07` | Superada (unitaria) |
| T08 | 10 confirmaciones en paralelo | `donations.simulate.test.ts`, `evidence/T08` | Superada (unitaria); script listo para el stack |
| T09 | Historial ajeno | `donations.list.test.ts`, `donations.simulate.test.ts` | Cubierta en mis rutas; evidencia de Paolo |

Cada identificador HU, CA o T aparece en el nombre de al menos una prueba. Las pruebas corren en Vitest contra los handlers reales, con DynamoDB simulado (`aws-sdk-client-mock`). Para comprobar que detectan errores, se rompió el código a propósito en cada caso clave:

- sin el filtro de borradores falla T01;
- sin comparar el hash falla T07;
- sin la condición de estado falla T08;
- sin verificar el dueño falla CA-07.2.

El CI ejecuta lint, typecheck, pruebas y build en cada PR.

## 5. Limitaciones

- **Sin prueba en AWS todavía.** Las funciones aún no tienen permisos de DynamoDB en `infra/template.yaml`. La lista exacta por función está en `docs/data-model.md`, como insumo de mínimo privilegio (T10). Hasta entonces, la evidencia es unitaria.
- **El seudónimo no es anonimización.** Quien conozca un `sub` puede calcular su `actorRef`. Un despliegue real usaría un HMAC con una clave en Secrets Manager.
- **Contención.** Muchas confirmaciones simultáneas sobre el mismo proyecto producen conflictos de transacción. Se reintentan hasta 3 veces y luego se responde 409 reintentable. A gran escala convendría un contador repartido.
- **La repetición idempotente devuelve la respuesta original,** aunque la donación se haya simulado después. Es intencional: «el mismo resultado» de CA-05.4. El estado actual se consulta en `GET /v1/donations/me`.
- **El gestor no puede listar sus borradores:** solo publica el proyecto cuyo id recibió al crearlo. Agregar esa ruta requiere un scope y un cambio en la plantilla.

## 6. Uso de IA

Usé Claude Code para implementar, probar y documentar. Cada uso está registrado en `AI_USAGE.md` con los archivos afectados y cómo se verificó. Las pruebas se validaron rompiendo el código a propósito, y la revisión humana se hizo en cada PR, por alguien distinto del autor.

# Modelo de datos y diseño de claves

**Responsable:** Santiago Callocondo (backend). Complementa el modelo lógico de los requerimientos (§4) y las tablas de `infra/template.yaml`.

Las cuatro tablas usan claves genéricas (`pk`, `gsi1pk`, `gsi1sk`). Este documento fija qué guarda cada una. Los montos son céntimos enteros de PEN y las fechas, ISO 8601 en UTC, así que el orden de los textos es el orden cronológico.

## Projects

| Atributo | Valor |
| --- | --- |
| `pk` | `PROJECT#<projectId>` |
| `gsi1pk` | `STATUS#BORRADOR` o `STATUS#PUBLICADO` |
| `gsi1sk` | `<createdAt>#<projectId>` en borrador; `<publishedAt>#<projectId>` al publicar |
| Datos | `projectId`, `title`, `description`, `goalAmountCents`, `confirmedAmountCents`, `currency`, `status`, `createdAt`, `updatedAt`, `publishedAt` |

- El catálogo y `/stats` hacen `Query` sobre `gsi1` con `gsi1pk = STATUS#PUBLICADO`, sin `Scan` (RNF-HU-05). Además, el código descarta cualquier ítem que no esté `PUBLICADO` antes de responder (CA-01.2).
- Publicar es un `Update` condicionado a `#status = BORRADOR`, en la misma transacción que su evento de auditoría. Si dos gestores publican a la vez, solo uno lo consigue y el otro recibe 409.
- `confirmedAmountCents` solo cambia con `ADD` al confirmar una donación (ver Donations).
- No se guarda quién creó el proyecto: ese dato vive en `AuditEvents` con seudónimo.

## Donations

| Atributo | Valor |
| --- | --- |
| `pk` | `DONATION#<donationId>` |
| `gsi1pk` | `DONOR#<donorSub>` |
| `gsi1sk` | `<createdAt>#<donationId>` |
| Datos | `donationId`, `projectId`, `projectTitle`, `donorSub`, `amountCents`, `currency`, `status`, `idempotencyKey`, `payloadHash`, `createdAt`, `updatedAt` |

- El historial propio hace `Query` sobre `gsi1` con el `sub` del token: no hay forma de pedir el de otro donante (CA-07.1).
- Para simular, se lee por `pk` y se compara `donorSub` con el `sub` del token. Si no coincide, la respuesta es 404, igual que si no existiera (CA-07.2).
- La simulación es un único `TransactWriteItems` con tres operaciones:
  - el `Update` de la donación, condicionado a `#status = PENDIENTE_SIMULACION AND donorSub = :sub`;
  - solo si se confirma, `ADD confirmedAmountCents` en el proyecto;
  - el evento de auditoría.

  Si llegan 10 confirmaciones a la vez, la condición deja pasar solo a la primera; las demás responden 409 `DONATION_ALREADY_FINALIZED` (CA-06.2, T08). Una rechazada no toca el proyecto (CA-06.3).
- Si la transacción choca con otra sobre el mismo proyecto (`TransactionConflict`), no se aplica nada. El handler vuelve a leer y reintenta hasta 3 veces; si sigue el choque, responde 409 `DONATION_SIMULATION_IN_PROGRESS`.

### Decisión: acumulado transaccional en lugar de agregación derivada (CA-NF04.2)

El requerimiento admite dos opciones: una operación condicional o transacción, o una agregación derivada consistente. Se eligió la primera:

- **Lectura barata.** El catálogo y `/stats` leen el acumulado ya calculado, sin sumar donaciones en cada consulta (RNF-HU-05).
- **Una sola fuente de verdad.** El estado de la donación y el acumulado cambian juntos o no cambian. No hay ventana en la que una donación figure como confirmada sin estar sumada.
- **Costo:** cada confirmación escribe en el ítem del proyecto. Con muchas confirmaciones simultáneas del mismo proyecto aparecen conflictos de transacción, que se reintentan. En el volumen académico no es un problema; a gran escala convendría un contador repartido o la agregación con DynamoDB Streams.

## Idempotency

| Atributo | Valor |
| --- | --- |
| `pk` | `IDEMP#<donorSub>#<idempotencyKey>` |
| Datos | `payloadHash` (SHA-256 del cuerpo validado, con los campos en orden fijo), `donationId`, `response` (la respuesta 201 original), `expiresAt` (epoch en segundos, TTL de 24 h) |

- La clave incluye el `sub`, así que dos donantes no pueden chocar con la misma clave.
- Antes de escribir se lee el registro. Con el mismo `payloadHash` se devuelve `response` tal cual, con la cabecera `Idempotent-Replayed: true`. Con otro hash se responde 409 `IDEMPOTENCY_KEY_REUSED` (CA-05.4).
- Si no existe, se escriben en un único `TransactWriteItems` la donación, el registro, un `ConditionCheck` de que el proyecto sigue `PUBLICADO` y el evento de auditoría. El registro va condicionado a `attribute_not_exists(pk) OR expiresAt <= :now`.
- Si dos solicitudes con la misma clave llegan a la vez, solo una se escribe. La otra vuelve a leer el registro y responde como repetición, o con 409 `IDEMPOTENCY_KEY_IN_PROGRESS` si la ganadora aún no se confirmó.
- El TTL de DynamoDB borra con retraso: un registro con `expiresAt` vencido se trata como inexistente.

## AuditEvents

| Atributo | Valor |
| --- | --- |
| `pk` | `EVENT#<eventId>` |
| `gsi1pk` | `ACTION#<action>` |
| `gsi1sk` | `<timestamp>#<eventId>` |
| Datos | `eventId`, `timestamp`, `requestId`, `actorRef`, `action`, `resourceRef`, `outcome`, `reason` |

- `actorRef` es `usr_` más los primeros 16 caracteres hexadecimales del SHA-256 del `sub`. Permite seguir a un mismo actor sin guardar su identificador (CA-10.2). No es anonimización: quien conozca un `sub` puede calcular su seudónimo.
- Las operaciones exitosas escriben su evento en la misma transacción que el cambio, de modo que no hay cambio sin evento ni evento sin cambio. Los intentos denegados o rechazados se escriben aparte, en modo best effort.
- `GET /v1/audit` (HU-10) filtra por tipo con `gsi1pk` y por fecha con `gsi1sk BETWEEN`. Sin filtro de tipo, consulta cada acción por separado.

## Permisos DynamoDB que necesita cada función

Esta tabla sirve de insumo para los roles de mínimo privilegio (RNF-HU-03, T10). `TransactWriteItems` se autoriza con la acción de cada ítem (`PutItem`, `UpdateItem`, `ConditionCheck`).

| Función | Tabla | Acciones |
| --- | --- | --- |
| `listProjects`, `getStats` | Projects, índice `gsi1` | `Query` |
| `getProject` | Projects | `GetItem` |
| `createProject` | Projects, AuditEvents | `PutItem` |
| `publishProject` | Projects | `GetItem`, `UpdateItem` |
| | AuditEvents | `PutItem` |
| `createDonation` | Projects | `GetItem`, `ConditionCheckItem` |
| | Idempotency | `GetItem`, `PutItem` |
| | Donations, AuditEvents | `PutItem` |
| `simulateDonation` | Donations | `GetItem`, `UpdateItem` |
| | Projects | `UpdateItem` |
| | AuditEvents | `PutItem` |
| `listMyDonations` | Donations, índice `gsi1` | `Query` |

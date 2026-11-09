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
- `confirmedAmountCents` solo cambia con `ADD` al confirmar una donación (día 5).
- No se guarda quién creó el proyecto: ese dato vive en `AuditEvents` con seudónimo.

## Donations (día 4)

| Atributo | Valor |
| --- | --- |
| `pk` | `DONATION#<donationId>` |
| `gsi1pk` | `DONOR#<donorSub>` |
| `gsi1sk` | `<createdAt>#<donationId>` |
| Datos | `donationId`, `projectId`, `projectTitle`, `donorSub`, `amountCents`, `currency`, `status`, `idempotencyKey`, `payloadHash`, `createdAt`, `updatedAt` |

- El historial propio hace `Query` sobre `gsi1` con el `sub` del token: no hay forma de pedir el de otro donante (CA-07.1).
- Para simular, se lee por `pk` y se compara `donorSub` con el `sub` del token. Si no coincide, la respuesta es 404, igual que si no existiera (CA-07.2).

## Idempotency (día 4)

| Atributo | Valor |
| --- | --- |
| `pk` | `IDEMP#<donorSub>#<idempotencyKey>` |
| Datos | `payloadHash` (SHA-256 del cuerpo canónico), `donationId`, `expiresAt` (epoch en segundos, TTL de 24 h) |

- La clave incluye el `sub`, así que dos donantes no pueden chocar con la misma clave.
- La donación y su registro de idempotencia se escriben en un único `TransactWriteItems` con `attribute_not_exists(pk)`. Si la transacción falla por esa condición, se lee el registro: con el mismo `payloadHash` se devuelve la donación original, y con otro hash se responde 409 (CA-05.4).

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
| `createDonation` (día 4) | Projects | `GetItem` |
| | Donations, Idempotency, AuditEvents | `PutItem` |
| | Idempotency | `GetItem` |
| | Donations | `GetItem` |
| `simulateDonation` (día 5) | Donations, Projects | `GetItem`, `UpdateItem` |
| | AuditEvents | `PutItem` |
| `listMyDonations` (día 5) | Donations, índice `gsi1` | `Query` |

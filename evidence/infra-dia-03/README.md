# Evidencia: un rol IAM por función (día 3)

**Requisitos:** RNF-HU-03 (mínimo privilegio). Adelanta parte de T10.
**Responsable:** Piero Mejía · **Fecha:** 2026-11-09

Sanitizado: el ID de la cuenta, los ARN, los nombres físicos de roles y tablas, y el ID del API se omitieron.

## Qué se probó

1. Que cada función use su propio rol, sin políticas gestionadas ni comodines.
2. Que esos permisos alcancen para ejecutar el código real contra DynamoDB.
3. Que las políticas desplegadas coincidan exactamente con las acciones esperadas y que IAM Access Analyzer no reporte hallazgos.

## Cómo se probó

```bash
sam validate --lint
npm run build
cd infra
sam deploy --stack-name donaciones-piero --parameter-overrides Stage=academic   # stack temporal con las 9 funciones
aws lambda invoke --function-name <función> --payload file://evento.json salida.json
aws iam get-role-policy --role-name <rol> --policy-name <política>
aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY --policy-document file://política.json
sam delete --stack-name donaciones-piero --no-prompts
sam deploy --config-env academic --no-fail-on-empty-changeset
```

Las funciones se invocaron directamente con un evento de HTTP API que incluye el contexto del authorizer (`sub`, grupo y scopes), porque todavía no hay usuarios de Cognito para obtener un token. Así se ejecuta el código real con su rol real contra las tablas reales; lo que no pasa por API Gateway es el rechazo del token, que cubren T02 y T11.

## Resultados

### Ejecución con cada rol

| Función | Solicitud | Resultado |
| --- | --- | --- |
| `Health` | `GET /v1/health` | `200` |
| `ListProjects` | `GET /v1/projects` | `200`, `items` vacío y luego con 1 proyecto |
| `GetStats` | `GET /v1/stats` | `200`, con `publishedProjects` en 0 y luego en 1 |
| `GetProject` | id inexistente | `404 PROJECT_NOT_FOUND` |
| `GetProject` | proyecto publicado | `200` |
| `CreateProject` | GESTOR | `201` (transacción en Projects y AuditEvents) |
| `CreateProject` | DONANTE | `403 INSUFFICIENT_SCOPE`, con evento `DENIED` |
| `PublishProject` | GESTOR | `200` |
| `PublishProject` | repetido | `409 PROJECT_ALREADY_PUBLISHED`, con evento `REJECTED` |
| `CreateDonation` | DONANTE con `Idempotency-Key` | `201` (transacción de 4 ítems: Donations, Idempotency, ConditionCheck en Projects y AuditEvents) |
| `CreateDonation` | misma clave y mismo cuerpo | `201` con la respuesta original |
| `CreateDonation` | misma clave y otro monto | `409 IDEMPOTENCY_KEY_REUSED` |
| `CreateDonation` | proyecto inexistente | `409 PROJECT_NOT_ELIGIBLE` |
| `CreateDonation` | sin `Idempotency-Key` | `400 INVALID_IDEMPOTENCY_KEY` |
| `CreateDonation` | GESTOR | `403 INSUFFICIENT_SCOPE` |

Quedaron 1 donación, 1 registro de idempotencia y 9 eventos de auditoría (4 de proyectos y 5 de donaciones, entre éxitos, rechazos y denegaciones). El acumulado confirmado del proyecto siguió en 0, como exige CA-05.2. Ninguna invocación terminó en `AccessDeniedException`.

`CreateDonation` se probó con el código del PR de Santiago (módulo donations), solo dentro del stack temporal: en esta rama el handler sigue siendo provisional. `SimulateDonation` y `ListMyDonations` son provisionales hasta el día 5, así que su rol no se ejecutó: se contrastó con el código esperado y con `docs/data-model.md`.

### Políticas desplegadas

Se leyó cada política en línea con `get-role-policy` y se comparó, par por par (acción y recurso), con lo esperado. La comparación se hizo en `donaciones-piero` y otra vez en `donaciones-academic`, con el mismo resultado.

| Rol | Sentencias | Pares acción/recurso | Coincide | Políticas gestionadas | Access Analyzer |
| --- | --- | --- | --- | --- | --- |
| `Health` | 1 | 2 | sí | 0 | sin hallazgos |
| `ListProjects` | 2 | 3 | sí | 0 | sin hallazgos |
| `GetStats` | 2 | 3 | sí | 0 | sin hallazgos |
| `GetProject` | 2 | 3 | sí | 0 | sin hallazgos |
| `CreateProject` | 2 | 4 | sí | 0 | sin hallazgos |
| `PublishProject` | 3 | 5 | sí | 0 | sin hallazgos |
| `CreateDonation` | 4 | 8 | sí | 0 | sin hallazgos |
| `SimulateDonation` | 3 | 7 | sí | 0 | sin hallazgos |
| `ListMyDonations` | 2 | 3 | sí | 0 | sin hallazgos |

Ninguna política tiene comodines de acción ni de recurso. El único `*` es el sufijo `:*` del grupo de logs de la propia función.

### API publicada del stack `donaciones-academic`

Después del redespliegue: `GET /v1/health` `200`, `GET /v1/projects` `200`, `GET /v1/stats` `200`, `GET /v1/projects/{id}` con un id inexistente `404`, y `POST /v1/projects` y `GET /v1/donations/me` sin token `401`. Cada función usa su rol `donaciones-academic-<Nombre>Role` y los nueve grupos de logs conservan 14 días de retención.

### Limpieza

`sam delete --stack-name donaciones-piero` no dejó stack, tablas, grupos de logs ni roles. Como en el día 2, `sam delete` borró del bucket de SAM los zips compartidos con `donaciones-academic`; el redespliegue de `academic` los volvió a subir.

## Limitaciones

- El simulador de políticas de IAM no sirve en esta cuenta: marca `AllowedByOrganizations: false` para acciones de DynamoDB que las Lambdas sí ejecutan sin error. Por eso se verificó el contenido de las políticas desplegadas y no su evaluación simulada.
- No se ejecutó una acción prohibida con un rol real, por ejemplo un `Scan`. La ausencia de permisos se comprueba leyendo la política.
- El día 6 se repite la validación con Access Analyzer sobre la plantilla final, ya con `SimulateDonation` y `ListMyDonations` implementadas.

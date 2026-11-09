# Evidencia: despliegue de la plantilla SAM base (día 2)

**Requisitos:** CA-06.1, RNF-HU-07 (logs), D-01 (throttling), CA-NF09.2 (limpieza)
**Responsable:** Piero Mejía
**Fecha:** 2026-11-08

Sanitizado: el ID de la cuenta, los ARN y el ID del API se reemplazaron por marcadores.

## Qué se probó

Que el stack `donaciones-academic` (rama `piero/sam-base`, `Stage=academic`) quede desplegado con las rutas, la autorización, CORS, el throttling y los logs que define `infra/template.yaml`.

## Cómo se probó

```bash
npm run build
cd infra
sam deploy --config-env cognito
sam deploy --config-env academic
aws apigatewayv2 get-routes --api-id <api-id>
aws apigatewayv2 get-stage --api-id <api-id> --stage-name academic
curl https://<api-id>.execute-api.us-east-2.amazonaws.com/academic/v1/...
aws logs describe-log-groups --log-group-name-prefix /donaciones/donaciones-academic
```

## Resultados

### Rutas en API Gateway

| Ruta | Autorización | Scope |
| --- | --- | --- |
| `GET /v1/health` | ninguna | |
| `GET /v1/projects` | ninguna | |
| `GET /v1/projects/{id}` | ninguna | |
| `GET /v1/stats` | ninguna | |
| `POST /v1/projects` | JWT | `api/projects.write` |
| `POST /v1/projects/{id}/publish` | JWT | `api/projects.write` |
| `POST /v1/donations` | JWT | `api/donations.*` |
| `POST /v1/donations/{id}/simulate` | JWT | `api/donations.*` |
| `GET /v1/donations/me` | JWT | `api/donations.*` |

`/simulate` aparece porque el stage es `academic`.

### Stage `dev` sin `/simulate` (CA-06.1)

Se desplegó un stack temporal con `sam deploy --stack-name donaciones-piero` (`Stage=dev`):

- `get-routes` devolvió 8 rutas: las de la tabla anterior menos `POST /v1/donations/{id}/simulate`.
- El stack tenía 8 funciones Lambda: no se creó `SimulateDonationFunction`.
- `POST /v1/donations/abc/simulate` respondió `404`, mientras `GET /v1/health` respondía `200`.

### Limpieza con `sam delete` (CA-NF09.2)

`sam delete --stack-name donaciones-piero --no-prompts` borró el stack. Después no quedaron tablas `donaciones-piero-*` ni grupos de logs `/donaciones/donaciones-piero/*` o `/aws/lambda/donaciones-piero*` (antes había 8).

`sam delete` también borra del bucket de SAM los zips del código, que son los mismos que usan los demás stacks si el código es idéntico. Se volvieron a subir con `sam deploy --config-env academic --no-fail-on-empty-changeset`.

### Respuestas

| Solicitud | Resultado |
| --- | --- |
| `GET /v1/health` | `200 {"status":"ok"}` |
| `GET /v1/stats` | `501 {"code":"NOT_IMPLEMENTED","message":"La ruta existe, pero todavía no está implementada","requestId":"Gjl2jgLB…"}` |
| `POST /v1/projects` sin token | `401 {"message":"Unauthorized"}` |
| `GET /v1/donations/me` sin token | `401` |
| `POST /v1/donations/{id}/simulate` sin token | `401` |
| `POST /v1/projects` con un JWT sin firma (`alg: none`) y scope `api/projects.write` | `401`: el gateway lo rechaza antes de llegar a la Lambda |

El 401 lo genera API Gateway, así que no usa el formato `{ code, message, requestId }`; ese formato aplica a las respuestas de las Lambdas.

### CORS

Preflight `OPTIONS /v1/donations` con `Origin: http://localhost:5173`: `204`, `Access-Control-Allow-Origin: http://localhost:5173`, `Access-Control-Allow-Headers: authorization,content-type,idempotency-key`.

### Throttling del stage

`ThrottlingRateLimit: 10`, `ThrottlingBurstLimit: 20`, aplicados a cada ruta.

### Logs

Nueve grupos `/donaciones/donaciones-academic/<función>` con retención de 14 días. La invocación de `health` escribió en su grupo en formato JSON y no se creó ningún grupo `/aws/lambda/...`, así que `sam delete` los borra junto con el stack.

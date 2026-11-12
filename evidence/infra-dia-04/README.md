# Evidencia: logs y CloudTrail (día 4)

**Requisitos:** RNF-HU-07 (observabilidad), CA-NF09.2 (limpieza)
**Responsable:** Piero Mejía · **Fecha:** 2026-11-09

Sanitizado: el ID de la cuenta, los ARN, el nombre del bucket, los ID de solicitud y las direcciones IP se omitieron.

## Qué se probó

1. Que las funciones escriban logs JSON con retención de 14 días y sin datos sensibles.
2. Que el trail exista, esté activo, cubra todas las regiones y valide la integridad de sus archivos.
3. Que el bucket de logs esté cerrado y que su política no tenga hallazgos en IAM Access Analyzer.
4. Que CloudTrail entregue archivos de log al bucket, con lecturas y escrituras.
5. Que el procedimiento de limpieza del README funcione.

## Cómo se probó

```bash
sam validate --lint --template-file cloudtrail.yaml
sam deploy --config-env cloudtrail
aws cloudtrail describe-trails
aws cloudtrail get-trail-status --name donaciones-trail
aws s3api get-public-access-block --bucket <bucket>
aws accessanalyzer validate-policy --policy-type RESOURCE_POLICY --validate-policy-resource-type AWS::S3::Bucket --policy-document file://política.json
aws s3 cp s3://<bucket>/<archivo>.json.gz .
aws cloudtrail stop-logging --name donaciones-trail
aws s3 rm s3://<bucket> --recursive
sam delete --config-env cloudtrail
```

## Resultados

### Logs de las funciones

Los nueve grupos `/donaciones/donaciones-academic/<función>` tienen retención de 14 días. Se invocaron `ListProjects` y `GetProject` (con un id inexistente) y se leyeron sus grupos. Cada invocación deja las líneas de la plataforma (`platform.start`, `platform.report`) y una línea de la aplicación:

```json
{"timestamp":"2026-11-09T16:46:45.122Z","level":"INFO","requestId":"<id de Lambda>","message":"{\"level\":\"INFO\",\"requestId\":\"<id de la solicitud>\",\"action\":\"projects.get\",\"outcome\":\"FAILURE\",\"statusCode\":404,\"errorCode\":\"PROJECT_NOT_FOUND\",\"durationMs\":358}"}
```

La línea de la aplicación solo tiene identificador de solicitud, acción, resultado, código HTTP, código de error y duración: ni tokens, ni cuerpo, ni datos del donante.

### Trail

| Propiedad | Valor |
| --- | --- |
| Nombre | `donaciones-trail` |
| Activo (`IsLogging`) | sí |
| Todas las regiones | sí (región de origen `us-east-2`) |
| Eventos de servicios globales | sí |
| Validación de integridad de archivos | sí |
| Eventos | administración, lectura y escritura |
| Eventos de datos | ninguno |
| Error de entrega | ninguno |

### Bucket

| Control | Resultado |
| --- | --- |
| Bloqueo de acceso público (los cuatro) | activado |
| Cifrado | SSE-S3 (`AES256`) |
| Propiedad de objetos | `BucketOwnerEnforced` (sin ACL) |
| Vencimiento de archivos | 30 días |
| Acceso anónimo por HTTPS | `403` |
| Escritura | solo `cloudtrail.amazonaws.com` desde este trail, en `AWSLogs/<cuenta>/*` y con `bucket-owner-full-control` |
| HTTP sin TLS | denegado por la política (`aws:SecureTransport`) |
| IAM Access Analyzer (`validate-policy`) | 0 hallazgos |

### Entrega de archivos

El primer archivo llegó unos 6 minutos después de crear el trail. En la primera entrega hubo 3 archivos y 20 registros:

- Un archivo de `us-east-1` con un `LookupEvents` hecho desde la CLI contra esa región. Que un trail con origen en `us-east-2` registre un evento de otra región confirma que cubre todas las regiones.
- Archivos de `us-east-2` con lecturas (`DescribeStacks`, `GetTrailStatus`, `GetBucketAcl`, `AssumeRole`) y una escritura.

La escritura se provocó a propósito y sin efecto: `PutRetentionPolicy` con 14 días sobre un grupo que ya tenía 14. El registro entregado tiene `readOnly: false`, categoría `Management`, identidad `AssumedRole`, agente `aws-cli`, TLS 1.3 y los parámetros `retentionInDays: 14` y el grupo de logs. Trae además la IP de origen y el ARN de la identidad, que no se publican.

Las 2 invocaciones de funciones Lambda de esa ventana no aparecen: `Invoke` es un evento de datos y el trail no los registra.

### Historial de eventos

`aws cloudtrail lookup-events` responde de inmediato, sin esperar a los archivos de S3. `ExecuteChangeSet` devolvió los despliegues del día. Los eventos de IAM (`PutRolePolicy` de los roles del día 3) solo aparecen con `--region us-east-1`: son eventos globales y el historial los guarda allí.

### Limpieza (CA-NF09.2)

Se probó el procedimiento del README sobre el stack recién creado: `stop-logging`, `aws s3 rm --recursive` (5 objetos) y `sam delete --config-env cloudtrail`. No quedaron stack, trail ni bucket. Después se volvió a desplegar el stack para dejar el trail registrando. Por eso el bucket de esta evidencia ya no existe: los archivos de arriba se leyeron antes de la prueba de limpieza.

## Limitaciones

- No se registran eventos de datos (invocaciones de Lambda, operaciones sobre ítems de DynamoDB), porque se cobran. Para eso están los logs de las funciones y la tabla `AuditEvents`.
- No se ejecutó `aws cloudtrail validate-logs`: los archivos de integridad llegan cada hora y todavía no había ninguno. Queda para el día 6, junto con la validación de políticas.
- La validación detecta archivos modificados o borrados, pero no impide que un administrador de la cuenta los borre: el bucket no tiene versionado ni Object Lock.
- El trail no envía a CloudWatch Logs ni tiene alarmas: registra, pero no avisa.
- La línea de la aplicación llega como texto JSON dentro del campo `message`, no como campos separados. Se puede consultar con Logs Insights, pero hay que usar `parse`. Convendría que `withHttp` registre un objeto en lugar de un texto: es código de Santiago y no se tocó.

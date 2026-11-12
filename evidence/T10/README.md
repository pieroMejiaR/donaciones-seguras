# T10: mínimo privilegio de las funciones

**Esperado:** cada función con su propio rol, sin comodines y sin hallazgos en IAM Access Analyzer. **Trazabilidad:** RNF-HU-03, RNF-HU-07.
**Responsable:** Piero Mejía · **Fecha:** 2026-11-09

Sanitizado: el ID de la cuenta, los ARN y los nombres físicos de roles, tablas y buckets se omitieron.

## Qué se probó

1. Que las políticas de permisos de los 9 roles desplegados en `donaciones-academic` sean exactamente las esperadas y no tengan hallazgos.
2. Que las políticas de confianza de esos roles solo dejen asumirlos al servicio Lambda.
3. Que las políticas de los dos buckets (logs de CloudTrail y sitio de la SPA) no tengan hallazgos.
4. Que los archivos de log de CloudTrail no se hayan alterado.

## Cómo se probó

```bash
aws iam get-role-policy --role-name <rol> --policy-name <política>
aws iam get-role --role-name <rol>                         # política de confianza
aws s3api get-bucket-policy --bucket <bucket>
aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY --policy-document file://permisos.json
aws accessanalyzer validate-policy --policy-type RESOURCE_POLICY --validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument --policy-document file://confianza.json
aws accessanalyzer validate-policy --policy-type RESOURCE_POLICY --validate-policy-resource-type AWS::S3::Bucket --policy-document file://bucket.json
aws cloudtrail validate-logs --trail-arn <arn> --s3-bucket <bucket> --start-time <inicio>
```

`validate-policy` es la validación de políticas de IAM Access Analyzer: revisa cada política y devuelve errores, advertencias de seguridad, advertencias y sugerencias. No requiere crear un analizador en la cuenta, y no se creó ninguno.

Cada política de permisos se comparó par por par (acción y recurso) con la tabla de permisos de `docs/data-model.md` y con el código de `api/src`.

## Resultados

### Políticas de permisos

| Rol | Sentencias | Pares acción/recurso | Coincide con lo esperado | Políticas gestionadas | Hallazgos |
| --- | --- | --- | --- | --- | --- |
| `Health` | 1 | 2 | sí | 0 | 0 |
| `ListProjects` | 2 | 3 | sí | 0 | 0 |
| `GetStats` | 2 | 3 | sí | 0 | 0 |
| `GetProject` | 2 | 3 | sí | 0 | 0 |
| `CreateProject` | 2 | 4 | sí | 0 | 0 |
| `PublishProject` | 3 | 5 | sí | 0 | 0 |
| `CreateDonation` | 4 | 8 | sí | 0 | 0 |
| `SimulateDonation` | 3 | 7 | sí | 0 | 0 |
| `ListMyDonations` | 2 | 3 | sí | 0 | 0 |

Ninguna política tiene comodines de acción ni de recurso. El único `*` es el sufijo `:*` del grupo de logs de cada función, que cubre sus flujos de log. Ningún rol tiene `Scan`, `DeleteItem` ni `BatchWriteItem`.

### Políticas de confianza

Los 9 roles solo admiten a `lambda.amazonaws.com` como principal. Access Analyzer: 0 hallazgos en los 9.

### Políticas de los buckets

| Bucket | Qué permite | Hallazgos |
| --- | --- | --- |
| Logs de CloudTrail | escribir solo a CloudTrail desde este trail; todo lo demás, solo por HTTPS | 0 |
| Sitio de la SPA | leer solo a CloudFront desde esta distribución; todo lo demás, solo por HTTPS | 0 |

### Integridad de los logs de CloudTrail

`aws cloudtrail validate-logs` entre las 17:02 y las 18:01 UTC del 9 de noviembre, en `us-east-2`:

```text
1/1 digest files valid
10/10 log files valid
```

La validación tiene que empezar después de la primera hora del trail actual. Ese trail se recreó el día 4 durante la prueba de limpieza, con el mismo nombre y por eso el mismo ARN. Su primer archivo de firma (16:01 a 17:01 UTC) todavía lista dos archivos de log del trail anterior, cuyo bucket ya no existe, y `validate-logs` falla con `NoSuchBucket` si el rango los incluye.

### Ejecución real

Los permisos alcanzan para el código real: el día 3 se invocaron las funciones con sus roles y ninguna terminó en `AccessDeniedException` (`evidence/infra-dia-03/`). La prueba de rendimiento repitió 150 lecturas con los mismos roles sin errores (`evidence/rendimiento/`).

## Limitaciones

- El simulador de políticas de IAM no sirve en esta cuenta: marca `AllowedByOrganizations: false` para acciones que las funciones sí ejecutan. Por eso se comparó el contenido de las políticas en lugar de simular su evaluación.
- No se ejecutó con un rol real una acción prohibida, por ejemplo un `Scan`. La ausencia del permiso se comprueba leyendo la política.
- `validate-policy` revisa cada política por separado. No combina la política de identidad con las políticas de recurso ni con las de la organización.
- `SimulateDonation` y `ListMyDonations` todavía no tienen código propio. Su rol se contrastó con lo previsto en `docs/data-model.md`; cuando se implementen, hay que repetir esta prueba.
- Lo validado es lo desplegado en `donaciones-academic`, que corresponde a la rama de los roles por función (PR #7).
- No se probó que `validate-logs` detecte un archivo alterado: habría que modificar un archivo de log real del bucket y restaurarlo después, y no se hizo. La validación solo muestra que los archivos actuales coinciden con sus firmas.
- `validate-logs` revisó la región de origen del trail (`us-east-2`); no se validaron los archivos de las demás regiones.

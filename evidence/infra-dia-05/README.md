# Evidencia: publicación de la SPA en CloudFront (día 5)

**Requisitos:** RNF-HU-01, CA-NF11.2
**Responsable:** Piero Mejía · **Fecha:** 2026-11-09

Sanitizado: el ID de la cuenta, los ARN, el nombre del bucket, el ID de la distribución y el ID del API se omitieron o se reemplazaron por marcadores.

## Qué se probó

1. Que el bucket sea privado y solo CloudFront pueda leerlo.
2. Que las cabeceras de seguridad lleguen en la página, en los archivos y en las respuestas de error.
3. Que la CSP funcione en un navegador real: que la SPA cargue y que se bloquee lo ajeno.
4. Que la caché distinga `index.html` de `/assets/*` y que recargar una ruta de la SPA funcione.
5. Que el API acepte llamadas desde el origen de CloudFront y solo desde ese.

## Cómo se probó

```bash
sam validate --lint --template-file frontend.yaml
sam deploy --config-env frontend --parameter-overrides ApiUrl=<salida ApiUrl de donaciones-academic>
npm run build -w web        # con las variables VITE_* de Cognito y del API
aws s3 sync web/dist s3://<bucket> --delete
curl -D - https://<dominio>.cloudfront.net/
aws accessanalyzer validate-policy --policy-type RESOURCE_POLICY --validate-policy-resource-type AWS::S3::Bucket --policy-document file://política.json
```

Además se abrió la URL en el navegador integrado (Chromium) y se ejecutó JavaScript en la página para provocar cada violación y registrar los eventos `securitypolicyviolation`.

## Resultados

### Bucket y distribución

| Control | Resultado |
| --- | --- |
| Bloqueo de acceso público (los cuatro) | activado |
| Cifrado | SSE-S3 (`AES256`) |
| Hosting de sitio web | desactivado |
| Lectura directa del bucket por HTTPS | `403` |
| Quién puede leer | solo `cloudfront.amazonaws.com`, con la condición `aws:SourceArn` de esta distribución (OAC) |
| HTTP sin TLS al bucket | denegado por la política |
| IAM Access Analyzer sobre la política del bucket | 0 hallazgos |
| `http://` en CloudFront | `301` a `https://` |
| Protocolos | HTTP/2 y HTTP/3, IPv6 |

### Cabeceras

Con el bucket vacío (respuesta `403` de S3) ya llegaban las ocho cabeceras. Con la SPA publicada, `GET /`, un archivo de `/assets/`, una ruta de la SPA y un archivo inexistente devolvieron las ocho:

| Cabecera | Valor |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<origen-del-api> https://cognito-idp.us-east-2.amazonaws.com https://*.auth.us-east-2.amazoncognito.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |

### CSP en el navegador

La SPA publicada cargó su JavaScript y su CSS desde el propio origen y mostró su página de inicio, sin ningún mensaje en la consola. Después se intentó cada acción que la política debe impedir:

| Intento | Resultado | Directiva que lo bloqueó |
| --- | --- | --- |
| Insertar un `<script>` en línea | no se ejecutó | `script-src-elem` |
| Poner un `style` en línea en el cuerpo | no se aplicó | `style-src-attr` |
| `fetch` a un sitio externo | bloqueado | `connect-src` |
| Insertar un `<iframe>` de un sitio externo | bloqueado | `frame-src` (por `default-src`) |

Con el origen del API permitido por la política, `fetch` hacia el API devolvió `200` en `/v1/health` y en `/v1/projects`, y `401` en `/v1/donations/me` sin token, sin ninguna violación de CSP. Antes de agregar el origen de CloudFront a `SpaOrigin`, esa misma llamada fallaba por CORS y no por CSP: la lista de violaciones no la incluía.

### CORS

| Solicitud | Resultado |
| --- | --- |
| Preflight `POST /v1/donations` con `Origin` de CloudFront | `204` con `Access-Control-Allow-Origin` igual al origen de CloudFront y `authorization, content-type, idempotency-key` permitidos |
| Preflight desde un origen ajeno | `204` sin `Access-Control-Allow-Origin`, que el navegador trata como bloqueo |

Para esto se actualizó `SpaOrigin` del stack `donaciones-academic`. El cambio solo modificó el recurso `HttpApi`; los roles del día 3 quedaron intactos.

### Caché y rutas

| Solicitud | Resultado |
| --- | --- |
| `GET /` (dos veces) | `200`, `X-Cache: Miss from cloudfront` las dos veces |
| `GET /assets/index-<hash>.js`, primera vez | `200`, `Miss`, `Content-Encoding: br` |
| `GET /assets/index-<hash>.js`, segunda vez | `200`, `Hit`, `Age: 1` |
| `GET /proyectos/abc` (ruta de la SPA) | `200`, `text/html`, con las mismas cabeceras |

## Limitaciones

- **TLS mínimo.** Con el certificado por defecto de CloudFront, la política de seguridad queda en `TLSv1` (se leyó `MinimumProtocolVersion` de la distribución). Exigir TLS 1.2 como mínimo requiere un dominio propio y un certificado en ACM, y el proyecto no tiene dominio.
- **El inicio de sesión no se probó de extremo a extremo.** El stack de Cognito todavía no tiene `UserPoolDomain`, así que el sitio de la prueba se compiló con un dominio de Cognito que nunca resuelve (`.invalid`). La CSP admite por ahora cualquier `https://*.auth.us-east-2.amazoncognito.com`; cuando exista el dominio se pasa el exacto. Además hay que agregar la URL de CloudFront a las URL de callback y de cierre de sesión del app client.
- **Un 403 se convierte en 200.** La regla que devuelve `index.html` ante un 403 o 404 hace que un método no permitido (por ejemplo `POST /`) o un archivo inexistente también respondan `200` con la página. No cambia nada en el bucket: el OAC solo permite `GetObject`.
- **Sin WAF ni logs de acceso de CloudFront**, por costo. Los eventos de administración quedan en CloudTrail (día 4).
- **El borrado del stack no se probó.** CloudFront tarda varios minutos en eliminar la distribución y la URL cambiaría. Se prueba en la limpieza final del día 7.
- **Un solo navegador.** La CSP se comprobó en Chromium; no se probó en Firefox ni en Safari.

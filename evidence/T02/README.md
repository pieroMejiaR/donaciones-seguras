# Evidencia de Prueba T02: Rechazo Estricto de ID Token

**Criterio de Aceptación:** CA-NF02.1 / RNF-HU-02  
**Responsable:** Paolo Ramírez (Identidad y Seguridad Zero Trust)  
**Fecha:** 2026-11-08  

---

## 1. Qué se probó
Se validó que el sistema rechace de manera determinante cualquier intento de autenticar una solicitud a la API utilizando un **ID Token** en lugar de un **Access Token**.

En arquitecturas OIDC / OAuth 2.0, el ID Token certifica la identidad ante la SPA del cliente, pero **no contiene autorización ni scopes** para acceder a recursos protegidos en el Resource Server (`api`).

---

## 2. Cómo se probó
Se ejecutó la prueba automatizada en Vitest (`api/src/auth/authorizer.test.ts`), simulando:
1. Una petición HTTP a una ruta protegida con encabezado `Authorization: Bearer <id_token>`.
2. El token presentado contiene el claim estándar de Cognito `token_use: "id"`.
3. Invocación de `extractAuthContext(event)` para verificar el Policy Enforcement Point.

### Payload de la Solicitud (Sanitizado):
```http
POST /v1/projects HTTP/1.1
Host: api.donaciones-seguras.local
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3ItMTExMS1hYWFhIiwidG9rZW5fdXNlIjoiaWQiLCJlbWFpbCI6ImRvbmFudGVAZXhlbXBsby5jb20ifQ...[TRUNCATED]
Content-Type: application/json
```

---

## 3. Qué resultó
El authorizer interceptó el claim `token_use === "id"` e interrumpió de inmediato el procesamiento sin delegar al backend de negocio, retornando una respuesta **HTTP 401 Unauthorized** con estructura uniforme:

```json
{
  "code": "ID_TOKEN_NOT_ALLOWED",
  "message": "Operación denegada: se presentó un ID Token en lugar de un Access Token.",
  "requestId": "req-test-123"
}
```

### Salida del Ejecutor de Pruebas:
```text
✓ src/auth/authorizer.test.ts > Authorizer & Token Validation (Día 2) > Prueba T02: Rechazo estricto de ID Tokens (RNF-HU-02, CA-NF02.1)
  ✓ rechaza con 401 (ID_TOKEN_NOT_ALLOWED) cuando se presenta un ID Token via header Authorization
  ✓ rechaza con 401 (ID_TOKEN_NOT_ALLOWED) cuando API Gateway envia claims de un ID Token
  ✓ rechaza cuando token_use no es 'access'
```
**Estado:** Superada con éxito.

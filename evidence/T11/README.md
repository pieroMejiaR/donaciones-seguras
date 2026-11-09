# Evidencia de Prueba T11: Validación de Scopes por Ruta

**Criterio de Aceptación:** RNF-HU-02 / CA-NF02.1  
**Responsable:** Paolo Ramírez (Identidad y Seguridad Zero Trust)  
**Fecha:** 2026-11-08  

---

## 1. Qué se probó
Se validó que el sistema restrinja el acceso a rutas protegidas verificando que el Access Token contenga exactamente el **OAuth 2.0 Scope** asignado a dicha operación en el Resource Server de Cognito.

Específicamente:
- La ruta `POST /v1/projects` exige el scope `api/projects.write`.
- Se probó el envío de un Access Token válido emitido para un `DONANTE` con scope `api/donations.*`, intentando acceder a la creación de proyectos.

---

## 2. Cómo se probó
Se ejecutó la prueba automatizada en Vitest (`api/src/auth/authorizer.test.ts`), evaluando la función de control perimetral `validateScope(ctx, "api/projects.write")`:

### Payload de la Solicitud (Sanitizado):
```http
POST /v1/projects HTTP/1.1
Host: api.donaciones-seguras.local
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3ItZG9uYW50ZS0xIiwidG9rZW5fdXNlIjoiYWNjZXNzIiwic2NvcGUiOiJhcGkvZG9uYXRpb25zLiogb3BlbmlkIn0...[TRUNCATED]
Content-Type: application/json
```

---

## 3. Qué resultó
El authorizer comprobó los scopes del token (`['api/donations.*', 'openid']`) contra el scope requerido (`api/projects.write`). Al no existir coincidencia ni regla comodín aplicable, se denegó el acceso con **HTTP 403 Forbidden**:

```json
{
  "code": "INSUFFICIENT_SCOPE",
  "message": "Acceso denegado: el token no cuenta con el scope requerido 'api/projects.write'",
  "requestId": "req-test-123"
}
```

### Salida del Ejecutor de Pruebas:
```text
✓ src/auth/authorizer.test.ts > Authorizer & Token Validation (Día 2) > Prueba T11: Validacion de scopes por ruta (RNF-HU-02)
  ✓ permite el acceso cuando el token contiene el scope exacto requerido
  ✓ rechaza con 403 (INSUFFICIENT_SCOPE) cuando falta el scope requerido
  ✓ reconoce el comodin api/donations.* para sub-scopes de donacion
```
**Estado:** Superada con éxito.

# Evidencia de Prueba T03: Control de Acceso RBAC y Demostración Zero Trust

**Criterio de Aceptación:** HU-04 / CA-07.2  
**Responsable:** Paolo Ramírez (Identidad y Seguridad Zero Trust)  
**Fecha:** 2026-11-08  

---

## 1. Qué se probó
Se demostró el principio fundamental de Zero Trust: **«Ocultar botones en la interfaz no es autorización»**.

En una aplicación segura, la visibilidad de elementos en el cliente (como el botón «Crear Proyecto» en la SPA) es solo una conveniencia de experiencia de usuario (UX). El verdadero control de acceso reside invariablemente en el backend.

Se probó el escenario donde un usuario con rol `DONANTE` realiza una llamada directa al API (`POST /v1/projects`) utilizando su Access Token legítimo de donante, intentando evadir la restricción visual del frontend.

---

## 2. Cómo se probó
Se ejecutó la prueba automatizada en Vitest (`api/src/auth/authz.test.ts`), simulando:
1. Un `AuthContext` autenticado con claims válidos de Cognito:
   - `sub: "donante-sub-001"`
   - `roles: ["DONANTE"]`
   - `tokenUse: "access"`
2. El handler de creación de proyectos invoca `requireRole(ctx, "GESTOR")`.
3. Se evalúa el rechazo HTTP y el formato de error uniforme con `formatErrorResponse`.

### Payload de la Solicitud Directa al API (Sanitizado):
```http
POST /v1/projects HTTP/1.1
Host: api.donaciones-seguras.local
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkb25hbnRlLXN1Yi0wMDEiLCJjb2duaXRvOmdyb3VwcyI6WyJET05BTlRFIl0sInRva2VuX3VzZSI6ImFjY2VzcyJ9...[TRUNCATED]
Content-Type: application/json

{
  "title": "Proyecto no autorizado creado por donante",
  "targetAmountCents": 500000
}
```

---

## 3. Qué resultó
El módulo `authz` verificó que el claim `cognito:groups` del usuario no incluye el rol `GESTOR`. La solicitud fue inmediatamente bloqueada con **HTTP 403 Forbidden**, previniendo cualquier escritura en la base de datos:

```json
{
  "code": "FORBIDDEN_ROLE",
  "message": "Acceso denegado: se requiere el rol GESTOR",
  "requestId": "req-t03-audit-trace"
}
```

### Salida del Ejecutor de Pruebas:
```text
✓ src/auth/authz.test.ts > Módulo authz: RBAC y Ownership (Día 3) > Prueba T03: Control de Acceso RBAC Negativo (HU-04)
  ✓ demuestra que ocultar botones no es autorizacion: DONANTE llamando a endpoint de GESTOR es rechazado con 403
  ✓ permite la ejecucion cuando el usuario pertenece al grupo GESTOR
  ✓ permite verificar multiples roles con requireAnyRole
```
**Estado:** Superada con éxito.

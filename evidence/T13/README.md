# T13: MFA TOTP obligatorio para rol GESTOR

**Esperado:** 403 (`MFA_REQUIRED`) si no completó TOTP; 200/permitido con TOTP activo.  
**Trazabilidad:** HU-11.  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11

Sanitizado: los identificadores de usuario y tokens son sintéticos de prueba.

## Qué se probó

- Un usuario perteneciente al grupo `GESTOR` autenticado únicamente con contraseña (`amr: "[pwd]"`) intenta acceder a una operación privilegiada (`requireRoleWithMfa(ctx, "GESTOR")`).
- Comportamiento del trigger Pre-Token Generation v2.0 de Cognito (`preTokenGenerationMfaHandler`) cuando un `GESTOR` intenta obtener tokens sin haber completado `SOFTWARE_TOKEN_MFA`.
- Caso positivo: un `GESTOR` con `amr: "[pwd sw_token]"` (o `mfa_verified: "true"`) completa exitosamente la validación.

## Cómo

Pruebas unitarias en Vitest (`api/src/auth/mfa.test.ts`), evaluando tanto la barrera en Lambda (`authz.ts`) como el trigger Pre-Token Generation de Cognito (`cognitoMfaTrigger.ts`).

## Resultado

```text
✓ MFA obligatorio, validación de origen y revocación JWT (Día 5) > Prueba T13: MFA TOTP obligatorio para rol GESTOR (HU-11)
  ✓ rechaza con 403 (MFA_REQUIRED) cuando GESTOR se autentica solo con contraseña
  ✓ permite el acceso cuando GESTOR presenta amr con sw_token o mfa_verified
  ✓ Cognito Pre-Token Trigger bloquea emisión para GESTOR sin TOTP MFA y la propaga si tiene MFA
```

Respuesta ante ausencia de TOTP MFA:

```json
{
  "code": "MFA_REQUIRED",
  "message": "Acceso denegado: se requiere autenticación multifactor (TOTP MFA)",
  "requestId": "req-mfa-test"
}
```

**Estado:** superada.

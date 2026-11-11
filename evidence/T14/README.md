# T14: MFA TOTP obligatorio y aislamiento de rol AUDITOR

**Esperado:** 403 (`MFA_REQUIRED` / `FORBIDDEN_ROLE`) ante falta de MFA o rol; permitido solo a `AUDITOR` con TOTP MFA.  
**Trazabilidad:** HU-10, HU-11.  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11

Sanitizado: los identificadores de usuario y tokens son sintéticos de prueba.

## Qué se probó

- Un usuario perteneciente al grupo `AUDITOR` sin verificación MFA (`mfa_verified: "false"`) intenta consultar eventos de auditoría (`requireRoleWithMfa(ctx, "AUDITOR")`).
- Un `DONANTE` con MFA activo intenta acceder a la ruta de auditoría (verificando que MFA no sustituye al rol RBAC).
- Caso positivo: un `AUDITOR` con `api/audit.read` y TOTP MFA completado es autorizado.

## Cómo

Pruebas unitarias en Vitest (`api/src/auth/mfa.test.ts`).

## Resultado

```text
✓ MFA obligatorio, validación de origen y revocación JWT (Día 5) > Prueba T14: MFA TOTP obligatorio para rol AUDITOR (HU-11)
  ✓ rechaza con 403 (MFA_REQUIRED) a un AUDITOR sin TOTP MFA al consultar auditoría
  ✓ rechaza con 403 (FORBIDDEN_ROLE) a un DONANTE aunque tenga TOTP MFA activo
  ✓ autoriza a un AUDITOR que completó TOTP MFA (mfa_verified: true)
```

**Estado:** superada.

# T13: MFA TOTP obligatorio para rol GESTOR

**Esperado:** 403 (`MFA_REQUIRED`) si no completó TOTP; 200/permitido con TOTP activo.  
**Trazabilidad:** HU-11.  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11  
**Actualizado:** Piero Mejía · 2026-11-16 (MFA obligatorio en el pool y guarda en los handlers)

Sanitizado: en las pruebas unitarias, los identificadores de usuario y los tokens son sintéticos. Del token real solo se registran los claims de autenticación.

## Qué se probó

- Que un `GESTOR` autenticado solo con contraseña (`amr: "[pwd]"`) reciba 403 `MFA_REQUIRED` en la guarda (`requireRoleWithMfa(ctx, "GESTOR")`) y en los handlers que crean y publican proyectos, sin escribir nada y con el intento auditado como `DENIED`.
- Que un token de `GESTOR` sin el claim `amr` también se rechace.
- Caso positivo: un `GESTOR` con el `amr` que Cognito emite tras contraseña y TOTP (`"[pwd otp mfa]"`) pasa la validación.
- Antes del cambio, qué claims trae un token real del pool para un `GESTOR` que entró sin TOTP.

## Cómo

- Pruebas unitarias en Vitest: `api/src/auth/mfa.test.ts` (guarda) y `api/src/handlers/projects.write.test.ts` (handlers).
- Token real: el 16 de noviembre de 2026 se inició sesión con un usuario `GESTOR` en el login de Cognito, con PKCE, y se leyeron solo los claims de autenticación del Access Token y del ID Token. El refresh token se revocó al terminar.

## Resultado

### Token real antes del cambio (pool con MFA opcional)

| Claim | Access Token | ID Token |
| --- | --- | --- |
| `amr` | `["pwd"]` | `["pwd"]` |
| `acr` | `urn:cognito:loa:1` | `urn:cognito:loa:1` |
| `cognito:groups` | `["GESTOR"]` | `["GESTOR"]` |

Cognito ya incluye `amr` en el Access Token, sin trigger. El `GESTOR` entró sin segundo factor y, como los handlers usaban `requireRole`, podía crear y publicar proyectos. Esto confirma el hueco de HU-11 en el despliegue de ese momento.

### Pruebas unitarias

```text
✓ mfa.test.ts > Prueba T13: MFA TOTP obligatorio para rol GESTOR (HU-11)
  ✓ rechaza con 403 (MFA_REQUIRED) cuando GESTOR se autentica solo con contraseña
  ✓ permite el acceso cuando GESTOR presenta el amr que Cognito emite tras contraseña y TOTP
✓ projects.write.test.ts > POST /v1/projects (HU-08)
  ✓ T13: un GESTOR que entró sin TOTP recibe 403 MFA_REQUIRED y queda auditado DENIED
  ✓ T13: un GESTOR con token sin claim amr recibe 403 MFA_REQUIRED
✓ projects.write.test.ts > POST /v1/projects/{id}/publish (HU-08)
  ✓ T13: un GESTOR que entró sin TOTP no puede publicar: 403 MFA_REQUIRED sin leer ni escribir
```

Respuesta ante ausencia de TOTP MFA:

```json
{
  "code": "MFA_REQUIRED",
  "message": "Acceso denegado: se requiere autenticación multifactor (TOTP MFA)",
  "requestId": "req-mfa-test"
}
```

**Estado:** superada en pruebas unitarias.

**Pendiente en despliegue vivo:** desplegar `donaciones-cognito` con `MfaConfiguration: "ON"` y `donaciones-academic` con los handlers nuevos. Después, iniciar sesión con un `GESTOR`, registrar TOTP cuando el login lo pida y comprobar que el Access Token trae `amr` con `otp` y `mfa` y que crear un proyecto responde 201.

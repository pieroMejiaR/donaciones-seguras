# CA-03.4: Demostración de Limitación de Revocación de Tokens JWT

**Esperado:** demostrar que la revocación del Refresh Token (`/oauth2/revoke`) no invalida inmediatamente un Access Token vigente hasta que vence su TTL ($\le 15$ min).  
**Trazabilidad:** HU-03 (CA-03.4), §6.3 del informe.  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11

Sanitizado: el token JWT es generado localmente con firma simulada para fines de demostración de protocolo.

## Qué se probó

1. Que los Access Tokens configurados en Cognito tienen una ventana de validez corta ($\le 900$ segundos / 15 minutos).
2. Que al simular la revocación del Refresh Token en el logout de la SPA, un Access Token ya emitido con `exp` futuro sigue siendo aceptado por `extractAuthContext` (*stateless validation*).
3. Que una vez superado su `exp`, el mismo token es rechazado con **HTTP 401 `TOKEN_EXPIRED`**.

## Cómo

Prueba automatizada en Vitest (`api/src/auth/mfa.test.ts`), evaluando la ventana `exp - iat` y la aceptación/rechazo temporal en `extractAuthContext`.

## Resultado

```text
✓ MFA obligatorio, validación de origen y revocación JWT (Día 5) > Demostración CA-03.4: Limitación de revocación de Access Tokens stateless
  ✓ un Access Token vigente (TTL <= 15 min) sigue siendo aceptado tras revocar el Refresh Token hasta su exp
```

**Conclusión:** La naturaleza stateless del JWT limita la revocación inmediata en el PEP perimetral/Lambda. Por diseño, la plataforma acota el riesgo combinando TTL corto ($\le 15$ min) + tokens exclusivamente en memoria en la SPA + opción de evaluación centralizada (HU-12).

**Estado:** demostrada y verificada.

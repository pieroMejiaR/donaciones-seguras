# T09: Verificación de Ownership por `sub` sobre recurso ajeno

**Esperado:** 403 (`FORBIDDEN_OWNERSHIP`) / aislamiento total por `sub`.  
**Trazabilidad:** HU-04, HU-07 (CA-07.2).  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11

Sanitizado: los identificadores `sub` son sintéticos de prueba y no corresponden a usuarios reales de Cognito.

## Qué se probó

- Un `DONANTE B` con Access Token y scope `api/donations.*` válidos intenta operar sobre una donación persistida cuyo propietario es `DONANTE A`.
- Un `DONANTE B` envía parámetros de suplantación en query string (`?donorSub=<sub_de_A>`) hacia `GET /v1/donations/me` intentando acceder al historial de otro donante.

## Cómo

Pruebas unitarias en Vitest (`api/src/auth/ownership.test.ts`), evaluando `assertOwnership(donanteBCtx, persistedDonation.donorSub)` y `extractDonorSub(ctx)` con eventos HTTP API v2.

## Resultado

```text
✓ Ownership por sub y aislamiento entre roles (Día 4: T09, T12) > Prueba T09: Verificación de Ownership por sub contra recurso persistido (HU-04, CA-07.2)
  ✓ rechaza con 403 (FORBIDDEN_OWNERSHIP) cuando un DONANTE intenta operar la donación de otro
  ✓ ignora parámetros ?donorSub= o intentos de suplantación y extrae la identidad solo del token (CA-07.2)
```

Respuesta uniforme devuelta ante intento de acceso cruzado:

```json
{
  "code": "FORBIDDEN_OWNERSHIP",
  "message": "Acceso denegado: el recurso pertenece a otro donante",
  "requestId": "req-test-0001"
}
```

**Estado:** superada.

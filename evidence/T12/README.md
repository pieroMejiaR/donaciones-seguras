# T12: Aislamiento entre roles en flujos exclusivos de DONANTE

**Esperado:** 403 (`INSUFFICIENT_SCOPE` / `FORBIDDEN_ROLE`), sin escrituras en DynamoDB.  
**Trazabilidad:** HU-04 (CA-04.2), HU-05, HU-07.  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11

Sanitizado: las tablas son mocks en memoria y los `sub` de prueba son sintéticos.

## Qué se probó

- Un usuario con rol `GESTOR` intenta invocar directamente `POST /v1/donations` tanto con su scope habitual (`api/projects.write`) como en el escenario adverso donde obtuvo `api/donations.*`.
- Un usuario con rol `AUDITOR` intenta acceder a `GET /v1/donations/me` (flujo exclusivo de `DONANTE`).

## Cómo

Pruebas unitarias e integración con el handler real `createDonation` (`api/src/handlers/createDonation.ts`) y `authz` en Vitest (`api/src/auth/ownership.test.ts`), con DynamoDB simulado mediante `aws-sdk-client-mock`.

## Resultado

```text
✓ Ownership por sub y aislamiento entre roles (Día 4: T09, T12) > Prueba T12: Aislamiento entre roles en flujos exclusivos de DONANTE (CA-04.2)
  ✓ un GESTOR llamando directamente a POST /v1/donations recibe 403 y no escribe en DynamoDB
  ✓ un GESTOR incluso con el scope api/donations.* recibe 403 (FORBIDDEN_ROLE) por no tener rol DONANTE
  ✓ un AUDITOR intentando acceder a ruta de DONANTE (GET /v1/donations/me) recibe 403 (FORBIDDEN_ROLE)
  ✓ un DONANTE legítimo sí puede validar ownership cuando coincide el sub
```

Cero transacciones escritas en DynamoDB (`TransactWriteCommand` = 0 llamadas) y el intento rechazado queda registrado como `DENIED` en auditoría.

**Estado:** superada.

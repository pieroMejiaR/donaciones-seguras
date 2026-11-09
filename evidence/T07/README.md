# T07: se repite la clave con un payload distinto

**Esperado:** 409. **Trazabilidad:** HU-05 (CA-05.4), amenaza T-02 de `docs/threat-model.md`.
**Responsable:** Santiago Callocondo · **Fecha:** 2026-11-09

## Qué se probó

- Se reutiliza una `Idempotency-Key` ya usada, pero con otro monto. La respuesta es 409 `IDEMPOTENCY_KEY_REUSED` y no se crea otra donación.
- El intento queda en auditoría como `REJECTED`, con motivo `IDEMPOTENCY_KEY_REUSED` y el actor seudonimizado.

## Cómo

Prueba unitaria del handler real en Vitest (`api/src/handlers/donations.create.test.ts`). La primera llamada crea la donación y la segunda encuentra el registro de idempotencia con otro `payloadHash` (SHA-256).

Se verificó que la prueba detecta el defecto: si se quita la comparación del hash, la prueba falla.

## Resultado

```text
✓ T07: misma clave con otro monto responde 409 y no crea otra donación
```

```json
{
  "code": "IDEMPOTENCY_KEY_REUSED",
  "message": "La clave de idempotencia ya se usó con una solicitud distinta",
  "requestId": "req-test-0001"
}
```

**Estado:** superada en pruebas unitarias. **Pendiente:** repetirla contra el stack desplegado.

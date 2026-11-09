# T06: se repite la clave con un payload idéntico

**Esperado:** mismo resultado, una sola donación. **Trazabilidad:** HU-05 (CA-05.4), RNF-HU-04.
**Responsable:** Santiago Callocondo · **Fecha:** 2026-11-09

## Qué se probó

- Una segunda solicitud con la misma `Idempotency-Key` y el mismo cuerpo devuelve **exactamente la misma respuesta** que la primera: mismo `donationId`, mismo cuerpo y la cabecera `Idempotent-Replayed: true`. Se envía una sola transacción de escritura.
- Cambiar el orden de los campos del cuerpo no cuenta como otro payload, porque el hash se calcula sobre el cuerpo ya validado y con los campos en orden fijo.
- Si dos solicitudes iguales llegan a la vez, la transacción condicionada deja escribir solo a una. La otra vuelve a leer el registro y responde como repetición.
- La clave es por usuario: el registro es `IDEMP#<sub>#<clave>`, así que otro donante con la misma clave no ve la respuesta del primero.
- Un registro vencido que el TTL de DynamoDB aún no borró se trata como clave nueva.

## Cómo

Pruebas unitarias del handler real en Vitest (`api/src/handlers/donations.create.test.ts`). Se hace una primera llamada y se toma el registro de idempotencia que escribió su transacción. Luego se hace una segunda llamada que encuentra ese registro en DynamoDB simulado.

Se verificó que la prueba detecta el defecto: si se quita la consulta del registro antes de escribir, fallan 5 pruebas.

## Resultado

```text
✓ T06: misma clave y mismo cuerpo devuelven la misma respuesta y una sola donación
✓ T06: el orden de los campos del cuerpo no cambia el resultado
✓ la clave es por usuario: otro donante con la misma clave consulta otro registro
✓ un registro vencido que el TTL aún no borró se trata como clave nueva
✓ dos solicitudes simultáneas con la misma clave: la que pierde responde como repetición
✓ si la transacción ganadora aún no se confirma, responde 409 IDEMPOTENCY_KEY_IN_PROGRESS
```

**Estado:** superada en pruebas unitarias. **Pendiente:** repetirla con solicitudes reales contra el stack desplegado.

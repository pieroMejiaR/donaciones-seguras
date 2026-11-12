# T08: se confirma dos veces la misma donación

**Esperado:** un solo incremento del monto agregado. **Trazabilidad:** HU-06 (CA-06.2, CA-06.3), RNF-HU-04 (CA-NF04.1, CA-NF04.2).
**Responsable:** Santiago Callocondo · **Fecha:** 2026-11-09

## Qué se probó

- **10 confirmaciones en paralelo** de la misma donación: una responde 200, nueve responden 409 `DONATION_ALREADY_FINALIZED`, y el acumulado del proyecto sube una sola vez.
- Las 10 solicitudes leen la donación como pendiente y las 10 llegan a escribir. Lo que impide el doble conteo es la **condición de la transacción** (`#status = PENDIENTE_SIMULACION`), no la lectura previa.
- Una donación ya confirmada responde 409 sin escribir.
- Una donación rechazada no toca el acumulado (CA-06.3).
- Ante un `TransactionConflict` con otras confirmaciones del mismo proyecto, se reintenta sin aplicar nada dos veces.

## Cómo

**Pruebas unitarias** en Vitest (`api/src/handlers/donations.simulate.test.ts`). La prueba de paralelismo usa un DynamoDB en memoria que aplica la condición de estado como la tabla real, y lanza 10 llamadas al handler con `Promise.all`.

Se verificó que la prueba detecta el defecto: si se quita `#status = :pending` de la condición, fallan esta prueba y la de confirmación simple.

**Contra el stack desplegado** (pendiente): `api/scripts/t08-concurrency.mjs` crea una donación de S/ 1,00, envía 10 confirmaciones simultáneas y compara el acumulado antes y después. Necesita el access token de un usuario DONANTE y un proyecto PUBLICADO:

```powershell
$env:API_URL = "https://<api-id>.execute-api.us-east-2.amazonaws.com/academic"
$env:ACCESS_TOKEN = "<access token DONANTE>"
$env:PROJECT_ID = "<proyecto PUBLICADO>"
node api/scripts/t08-concurrency.mjs
```

## Resultado (pruebas unitarias)

```text
✓ T08 > una donación ya confirmada responde 409 y no vuelve a escribir
✓ T08 > 10 confirmaciones en paralelo: un 200, nueve 409 y un solo incremento del acumulado
✓ T08 > si otra solicitud la finaliza entre la lectura y la escritura, responde 409
✓ transición válida > CA-06.3: rechazar no toca el acumulado del proyecto
✓ contención > reintenta tras un TransactionConflict y aplica la transición
✓ contención > si la contención persiste, responde 409 DONATION_SIMULATION_IN_PROGRESS tras 3 intentos
```

**Estado:** superada en pruebas unitarias. **Pendiente:** ejecutar el script contra `donaciones-academic` y pegar aquí su salida, cuando las funciones tengan permisos de DynamoDB.

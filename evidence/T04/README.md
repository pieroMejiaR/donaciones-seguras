# T04: un donante envía S/ 0 o S/ 1000.01

**Esperado:** 400. **Trazabilidad:** HU-05 (CA-05.1, CA-05.2).
**Responsable:** Santiago Callocondo · **Fecha:** 2026-11-09

## Qué se probó

- `POST /v1/donations` con `amountCents` 0 o 100001 responde 400 `VALIDATION_ERROR`, y el mensaje nombra el campo.
- También se rechazan los montos negativos, con más de dos decimales en soles (céntimos no enteros) o enviados como texto.
- La validación ocurre antes de tocar la base: no se lee el proyecto ni se escribe nada, así que el acumulado no cambia.
- Los límites sí se aceptan: 100 céntimos (S/ 1,00) y 100000 céntimos (S/ 1 000,00).

## Cómo

Pruebas unitarias en Vitest a dos niveles: el esquema (`api/src/donations/schemas.test.ts`) y el handler real (`api/src/handlers/donations.create.test.ts`), este último contra DynamoDB simulado con `aws-sdk-client-mock`. Cada caso comprueba además que no hubo ninguna llamada a DynamoDB.

## Resultado

```text
✓ T04: montos fuera de rango (CA-05.2) > S/ 0 responde 400 sin leer ni escribir en la base
✓ T04: montos fuera de rango (CA-05.2) > S/ 1000.01 responde 400 sin leer ni escribir en la base
✓ T04: montos fuera de rango (CA-05.2) > un monto negativo responde 400 sin leer ni escribir en la base
✓ T04: montos fuera de rango (CA-05.2) > más de dos decimales responde 400 sin leer ni escribir en la base
✓ T05: intención válida > acepta los límites: 100 céntimos
✓ T05: intención válida > acepta los límites: 100000 céntimos
```

**Estado:** superada en pruebas unitarias. **Pendiente:** repetirla contra el stack desplegado.

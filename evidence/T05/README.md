# T05: un donante crea una intención válida

**Esperado:** 201, pendiente, sin cargo real. **Trazabilidad:** HU-05 (CA-05.1, CA-05.2, CA-05.3, CA-05.5).
**Responsable:** Santiago Callocondo · **Fecha:** 2026-11-09

## Qué se probó

- Un DONANTE con un proyecto PUBLICADO, un monto válido y una `Idempotency-Key` recibe 201 con la donación en `PENDIENTE_SIMULACION`.
- **Sin cargo real:** el API no tiene ningún campo de pago y rechaza con 400 `cardNumber`, `cvv` y similares (CA-05.5). Al proyecto solo se le comprueba que esté publicado (`ConditionCheck`): su acumulado no se modifica hasta la confirmación simulada.
- El `donorSub` guardado es el `sub` del token. Uno enviado en el cuerpo responde 400, y la respuesta no lo expone (CA-05.3).
- Donación, clave de idempotencia y auditoría se escriben en una sola transacción.
- Un GESTOR, aunque tenga el scope de donaciones, recibe 403 por rol.

## Cómo

Pruebas unitarias del handler real en Vitest (`api/src/handlers/donations.create.test.ts`) contra DynamoDB simulado con `aws-sdk-client-mock`. Se revisa el contenido de la transacción enviada a DynamoDB.

## Resultado

```text
✓ T05: intención válida > responde 201 con la donación en PENDIENTE_SIMULACION (CA-05.1)
✓ T05: intención válida > CA-05.3: guarda el donorSub del token y no lo devuelve en la respuesta
✓ T05: intención válida > sin cargo ni cambio del acumulado: el proyecto solo se verifica, no se modifica (CA-05.2)
✓ T05: intención válida > escribe donación, clave de idempotencia (24 h) y auditoría en una sola transacción
✓ entradas y permisos > CA-05.5: datos de tarjeta en el cuerpo responden 400
✓ entradas y permisos > un GESTOR con el scope de donaciones recibe 403 por rol
```

**Estado:** superada en pruebas unitarias. **Pendiente:** repetirla contra el stack desplegado con el usuario de prueba del grupo DONANTE.

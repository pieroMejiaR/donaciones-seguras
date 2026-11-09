# Evidencia: rendimiento del catálogo con 50 proyectos

**Requisito:** RNF-HU-05
**Responsable:** Piero Mejía · **Fecha:** 2026-11-09

Sanitizado: el ID de la cuenta, los ARN y el ID del API se omitieron.

## Qué se probó

Que las rutas públicas de lectura respondan bien y rápido con 50 proyectos publicados y 10 borradores en la tabla: el catálogo (`GET /v1/projects`), los indicadores (`GET /v1/stats`) y el detalle (`GET /v1/projects/{id}`).

El umbral de RNF-HU-05 no está escrito en el repositorio. Aquí se reportan las latencias medidas; la comparación con el umbral va en el informe.

## Cómo se probó

Con `scripts/rendimiento.mjs`, sobre un stack temporal (`donaciones-rendimiento`, stage `dev`) desplegado desde la rama de los roles por función (PR #7):

```bash
cd infra
sam deploy --stack-name donaciones-rendimiento --s3-prefix donaciones-rendimiento
cd ..
node scripts/rendimiento.mjs --stack donaciones-rendimiento --publicados 50 --borradores 10 --solicitudes 50 --intervalo-ms 200
cd infra
sam delete --stack-name donaciones-rendimiento --s3-prefix donaciones-rendimiento --no-prompts
```

El script:

1. Escribe 60 proyectos en la tabla Projects con el mismo diseño de claves que el backend (`docs/data-model.md`): 50 en `PUBLICADO` y 10 en `BORRADOR`.
2. Comprueba que las respuestas sean correctas antes de medir.
3. Hace 50 solicitudes por ruta, una cada 200 ms como mínimo. Eso da unas 5 por segundo, por debajo del throttling de 10 por segundo, así que ninguna se rechaza por límite.
4. Lee de CloudWatch Logs el `durationMs` que cada función registra, para separar el tiempo de la función del tiempo de red.

El cliente fue un equipo en Perú; el API está en `us-east-2` (Ohio).

## Resultados

### Corrección

- El catálogo devolvió los 50 proyectos, todos `PUBLICADO`, y ningún borrador.
- `/v1/stats` contó 50 proyectos y sumó bien las metas.
- El detalle de un proyecto publicado respondió `200`; el de un borrador, `404`.

### Desde el cliente (incluye red y API Gateway)

| Ruta | n | mín | p50 | p95 | p99 | máx | Estados |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/projects` | 50 | 148 ms | 168 ms | 267 ms | 330 ms | 330 ms | `200` × 50 |
| `GET /v1/stats` | 50 | 148 ms | 166 ms | 217 ms | 355 ms | 355 ms | `200` × 50 |
| `GET /v1/projects/{id}` | 50 | 147 ms | 157 ms | 207 ms | 312 ms | 312 ms | `200` × 50 |

La primera solicitud al catálogo, con la función en frío, tardó 1749 ms.

### Dentro de la función (sin red ni API Gateway)

| Ruta | n | mín | p50 | p95 | p99 | máx | Arranques en frío |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/projects` | 51 | 5 ms | 7 ms | 76 ms | 471 ms | 471 ms | 1 |
| `GET /v1/stats` | 51 | 4 ms | 6 ms | 52 ms | 446 ms | 446 ms | 1 |
| `GET /v1/projects/{id}` | 52 | 3 ms | 5 ms | 44 ms | 376 ms | 376 ms | 1 |

La `n` incluye las solicitudes de la comprobación de corrección. Cada función tuvo un arranque en frío. Los máximos (376 a 471 ms) son del orden de una primera ejecución, que abre la conexión con DynamoDB, aunque el script no registra a qué solicitud corresponde cada valor.

## Lectura de los resultados

- **La red domina.** Con la función caliente, la mediana dentro de la función es de 5 a 7 ms y la del cliente, de 157 a 168 ms: casi todo el tiempo es el viaje hasta Ohio.
- **Sin `Scan`.** El catálogo y los indicadores consultan el índice `gsi1` por la partición `STATUS#PUBLICADO`, así que leen solo los publicados aunque haya borradores. Además, el rol de esas funciones solo tiene `Query` sobre ese índice: aunque el código intentara un `Scan`, AWS lo negaría.
- **El arranque en frío es el peor caso.** La primera solicitud al catálogo tardó 1,7 s de punta a punta. En las 150 solicitudes medidas después, ninguna pasó de 355 ms en el cliente.

## Limitaciones

- Una sola corrida, en un horario y desde una sola red. Las cifras sirven como orden de magnitud, no como garantía.
- No se midió con concurrencia: las solicitudes fueron secuenciales. La concurrencia de escritura la cubre T08.
- El arranque en frío depende del tamaño del paquete y de la memoria (256 MB, arm64). No se probó concurrencia aprovisionada, que se cobra.

## Limpieza

`sam delete` borró el stack temporal y sus tablas. El despliegue usó un prefijo propio en el bucket de SAM (`--s3-prefix`), así que el borrado no tocó los archivos de código de `donaciones-academic`.

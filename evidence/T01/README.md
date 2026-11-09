# T01: un visitante consulta proyectos publicados

**Esperado:** 200, sin borradores. **Trazabilidad:** HU-01 (CA-01.1, CA-01.2, CA-01.3), HU-02 (CA-02.2).
**Responsable:** Santiago Callocondo · **Fecha:** 2026-11-08

## Qué se probó

- `GET /v1/projects` sin token devuelve 200 solo con proyectos `PUBLICADO`, con nombre, finalidad, meta y acumulado confirmado en PEN.
- Aunque DynamoDB devolviera un `BORRADOR`, la respuesta no lo incluye.
- Sin proyectos publicados, la respuesta es 200 con `items: []`, para que la SPA muestre su estado vacío.
- `GET /v1/projects/{id}` de un `BORRADOR` responde el mismo 404 que un id inexistente, sin revelar contenido.

## Cómo

Pruebas unitarias en Vitest (`api/src/handlers/projects.read.test.ts`). Los handlers reales se ejecutan contra un DynamoDB simulado con `aws-sdk-client-mock`. La prueba principal hace que la consulta devuelva un proyecto publicado y uno en borrador. Además, comprueba que el catálogo consulta el índice `gsi1` con `gsi1pk = STATUS#PUBLICADO`.

Se verificó que la prueba detecta el defecto: al quitar el filtro de estado del repositorio, fallan T01 y la prueba de `/stats`.

## Resultado

```text
✓ GET /v1/projects (HU-01) > T01: un visitante sin token recibe 200 solo con proyectos PUBLICADO (CA-01.1, CA-01.2)
✓ GET /v1/projects (HU-01) > no expone las claves internas de DynamoDB
✓ GET /v1/projects (HU-01) > CA-01.3: sin proyectos publicados responde 200 con una lista vacía
✓ GET /v1/projects/{id} (HU-02) > CA-02.2: un BORRADOR responde el mismo 404 que un id inexistente
✓ GET /v1/projects/{id} (HU-02) > un id mal formado responde 404 sin consultar la tabla
```

**Estado:** superada en pruebas unitarias.

**Pendiente:** repetir T01 con `curl` contra el stack desplegado. Para eso hace falta que las funciones tengan permisos de DynamoDB en `infra/template.yaml` (día 3 de Piero; la lista de acciones por función está en `docs/data-model.md`) y SAM CLI instalado.

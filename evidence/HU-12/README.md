# HU-12 (Extensión): Autorización Externalizada con Amazon Verified Permissions y Cedar

**Esperado:** repetir T03, T09 y T12 llamando a `IsAuthorized` desde Lambda con políticas Cedar equivalentes a HU-04, HU-07 y HU-08.  
**Trazabilidad:** HU-12, HU-04, HU-07, HU-08.  
**Responsable:** Paolo Ramírez · **Fecha:** 2026-11-11

Sanitizado: el `policyStoreId` y los `sub` utilizados en las pruebas son sintéticos.

## Qué se implementó y probó

- **Esquema formal Cedar:** [`docs/cedar/schema.cedarschema.json`](../../docs/cedar/schema.cedarschema.json) (`User`, `Project`, `Donation` y acciones `createProject`, `publishProject`, `createDonation`, `listOwnDonations`, `simulateDonation`).
- **Políticas declarativas Cedar:** [`docs/cedar/policies.cedar`](../../docs/cedar/policies.cedar), reescribiendo las reglas de HU-04, HU-07 y HU-08 incluyendo bloqueo `forbid` por defecto ante falta de Access Token o discrepancia de `ownerSub`.
- **Integración AWS SDK v3:** [`api/src/auth/cedar.ts`](../../api/src/auth/cedar.ts) usando `@aws-sdk/client-verifiedpermissions` (`VerifiedPermissionsClient` y `IsAuthorizedCommand`).
- **Repetición de T03, T09 y T12:** pruebas automatizadas en [`api/src/auth/cedar.test.ts`](../../api/src/auth/cedar.test.ts) usando `aws-sdk-client-mock` y el evaluador local equivalente.

## Resultados

```text
✓ HU-12 (Opcional): Autorización Externalizada con Amazon Verified Permissions + Cedar
  ✓ Repetición T03 con Cedar: RBAC en creación y publicación de proyectos (HU-08)
    ✓ deniega con 403 (CEDAR_DENIED) cuando un DONANTE llama a createProject
    ✓ permite (ALLOW) cuando un GESTOR con scope api/projects.write llama a createProject / publishProject
  ✓ Repetición T09 con Cedar: Ownership por sub sobre donación ajena (HU-04, CA-07.2)
    ✓ deniega (DENY) cuando DONANTE B intenta simular una donación propiedad de DONANTE A
    ✓ permite (ALLOW) cuando DONANTE A simula su propia donación en stage academic
    ✓ deniega (DENY) cuando DONANTE B intenta consultar historial pasando requestedOwnerSub de DONANTE A (HU-07)
  ✓ Repetición T12 con Cedar: Aislamiento de roles en flujo de donaciones (HU-04, HU-07)
    ✓ deniega (DENY) cuando un GESTOR intenta crear una donación o listar historial de donaciones
```

La comparativa completa entre autorización embebida (`authz.ts`) y externalizada (Amazon Verified Permissions + Cedar) figura en [`docs/informe-seguridad.md`](../../docs/informe-seguridad.md).

**Estado:** superada en pruebas automatizadas con AWS SDK v3 mockeado.

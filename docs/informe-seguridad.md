# Informe de Identidad y Seguridad Zero Trust

**Proyecto:** Plataforma de Donaciones Seguras  
**Responsable:** Paolo Ramírez (Identidad y Seguridad Zero Trust)  
**Fecha:** 2026-11-11  

---

## 1. Arquitectura de Identidad y Seguridad Zero Trust

La plataforma implementa una arquitectura de seguridad por capas basada en **AWS Cognito**, **API Gateway HTTP API JWT Authorizer** y el módulo de autorización en Lambda ([`api/src/auth/`](../api/src/auth/index.ts)):

1. **Proveedor de Identidad (IdP — AWS Cognito):**
   - Definido como infraestructura declarativa en [`infra/cognito-authorizer.yaml`](../infra/cognito-authorizer.yaml).
   - **App Client público (`GenerateSecret: false`):** configurado para **Authorization Code Flow con PKCE (`S256`)** y sin flujo implícito.
   - **Resource Server `api`:** registra scopes granulares `api/projects.write`, `api/donations.*` y `api/audit.read`.
   - **Grupos RBAC:** `DONANTE`, `GESTOR` y `AUDITOR`.
   - **Tiempo de vida corto:** Access Token configurado en **15 minutos** (HU-03).
2. **PEP Perimetral (API Gateway HTTP API JWT Authorizer):**
   - Valida criptográficamente la firma RS256 contra JWKS de Cognito, el emisor (`iss`), el `client_id` (`aud`) y los scopes exigidos por ruta.
   - Como los ID Tokens carecen del claim `scope`, el gateway rechaza automáticamente su uso en rutas protegidas (CA-NF02.1).
3. **PEP / PE de Aplicación (Lambdas + Módulo `auth`):**
   - [`extractAuthContext`](../api/src/auth/authorizer.ts): exige estrictamente `token_use === "access"` (rechaza ID Tokens con 401 `ID_TOKEN_NOT_ALLOWED`), valida expiración `exp`, normaliza `cognito:groups` (tanto arreglos como formato cadena `"[GESTOR]"` de HTTP API) y extrae `amr` / `mfaVerified`.
   - [`authz.ts`](../api/src/auth/authz.ts): verifica roles (`requireRole`, `requireRoleWithMfa`), scopes (`requireScope`) y pertenencia del recurso (`assertOwnership`, `extractDonorSub`).
4. **MFA TOTP Obligatorio para Roles Privilegiados (HU-11):**
   - Habilitación de `SOFTWARE_TOKEN_MFA` en el User Pool.
   - Trigger Pre-Token Generation v2.0 ([`cognitoMfaTrigger.ts`](../api/src/auth/cognitoMfaTrigger.ts)) que bloquea la emisión para `GESTOR` o `AUDITOR` sin TOTP completado y propaga `mfa_verified: "true"` al Access Token.
   - Verificación en backend mediante `requireRoleWithMfa`.

---

## 2. Mapeo a los 7 Principios NIST SP 800-207 y PE / PA / PEP (CA-NF02.3)

El detalle completo se mantiene también en [`docs/threat-model.md`](threat-model.md#L173-L194).

| Componente Lógico NIST | Elemento en el Sistema | Responsabilidad |
| :--- | :--- | :--- |
| **PE (Policy Engine)** | [`api/src/auth/authz.ts`](../api/src/auth/authz.ts) / [`docs/cedar/policies.cedar`](cedar/policies.cedar) | Evalúa reglas RBAC (`cognito:groups`), MFA (`amr`/`mfa_verified`) y ownership (`sub == donorSub`) para decidir `ALLOW` o `DENY`. |
| **PA (Policy Administrator)** | **AWS Cognito User Pool** + **HTTP API Stage** | Emite tokens cortos ($\le 15$ min), gestiona MFA TOTP y revoca Refresh Tokens en `/oauth2/revoke`. |
| **PEP (Policy Enforcement Point)** | **JWT Authorizer** (API Gateway) + `extractAuthContext` en Lambda | Intercepta toda petición antes de la lógica de negocio/DynamoDB; rechaza con 401/403 si falla cualquier política. |

---

## 3. Cobertura de Pruebas Negativas y Evidencias

Todas las pruebas de seguridad se automatizaron en Vitest y cuentan con evidencia sanitizada en [`evidence/`](../evidence/README.md):

| ID | Qué valida | Resultado esperado | Ubicación de pruebas y evidencia |
| :---: | :--- | :--- | :--- |
| **T02** | Envío de ID Token en lugar de Access Token (CA-NF02.1) | **401** `ID_TOKEN_NOT_ALLOWED` | [`authorizer.test.ts`](../api/src/auth/authorizer.test.ts), [`evidence/T02/`](../evidence/T02/README.md) |
| **T11** | Access Token sin el scope requerido por la ruta (RNF-HU-02) | **403** `INSUFFICIENT_SCOPE` | [`authorizer.test.ts`](../api/src/auth/authorizer.test.ts), [`evidence/T11/`](../evidence/T11/README.md) |
| **T03** | `DONANTE` invocando endpoint de `GESTOR` (ocultar botones no es autorización, HU-04) | **403** `FORBIDDEN_ROLE` | [`authz.test.ts`](../api/src/auth/authz.test.ts), [`projects.write.test.ts`](../api/src/handlers/projects.write.test.ts), [`evidence/T03/`](../evidence/T03/README.md) |
| **T09** | `DONANTE B` operando donación de `DONANTE A` o enviando `?donorSub=` ajeno (CA-07.2) | **403** `FORBIDDEN_OWNERSHIP` / ignora `?donorSub=` | [`ownership.test.ts`](../api/src/auth/ownership.test.ts), [`evidence/T09/`](../evidence/T09/README.md) |
| **T12** | `GESTOR` o `AUDITOR` intentando crear donación o leer `/me` (CA-04.2) | **403** `INSUFFICIENT_SCOPE` / `FORBIDDEN_ROLE` | [`ownership.test.ts`](../api/src/auth/ownership.test.ts), [`evidence/T12/`](../evidence/T12/README.md) |
| **T13** | `GESTOR` sin TOTP MFA intentando ejecutar operación privilegiada (HU-11) | **403** `MFA_REQUIRED` | [`mfa.test.ts`](../api/src/auth/mfa.test.ts), [`evidence/T13/`](../evidence/T13/README.md) |
| **T14** | `AUDITOR` sin TOTP MFA o `DONANTE` con MFA intentando auditar (HU-11) | **403** `MFA_REQUIRED` / `FORBIDDEN_ROLE` | [`mfa.test.ts`](../api/src/auth/mfa.test.ts), [`evidence/T14/`](../evidence/T14/README.md) |
| **CA-03.4** | Limitación de revocación de Access Token tras revocar Refresh Token | Token aceptado antes de `exp`; **401** `TOKEN_EXPIRED` tras expirar | [`mfa.test.ts`](../api/src/auth/mfa.test.ts), [`evidence/CA-03.4/`](../evidence/CA-03.4/README.md) |

---

## 4. Limitaciones del Sistema de Identidad y Autorización (§6.3)

1. **Limitación de revocación inmediata de Access Tokens JWT (CA-03.4):**
   - Dado que los JWT son *stateless*, el endpoint `/oauth2/revoke` de Cognito revoca de inmediato el **Refresh Token**, pero el **Access Token** emitido previamente sigue siendo criptográficamente válido para API Gateway y Lambda hasta que alcanza su marca `exp`.
   - **Mitigación:** TTL máximo de 15 minutos en Cognito, tokens almacenados únicamente en memoria de la SPA (`oidc-client-ts`), nunca en `localStorage` ni `sessionStorage`.
2. **PKCE en clientes públicos de Cognito:**
   - En las pruebas de protocolo contra Cognito se verificó que el servidor autoriza solicitudes hacia `/oauth2/authorize` sin `code_challenge` si el cliente las omite; por lo tanto, el cumplimiento de PKCE (`S256`) depende de la SPA (`oidc-client-ts`), que lo envía en todo flujo.
3. **Registro abierto en Managed Login (`AllowAdminCreateUserOnly: false`):**
   - Cualquier usuario puede autoregistrarse en la pantalla de login alojada; sin embargo, al crearse sin membresía en `cognito:groups`, la capa `authz` en Lambda bloquea cualquier operación restringida a `DONANTE`, `GESTOR` o `AUDITOR` (403 Forbidden).
4. **Ausencia de `amr` por defecto en Access Tokens de Cognito:**
   - Cognito incluye `amr` en el ID Token de forma predeterminada, pero requiere un trigger **Pre-Token Generation V2.0** para inyectar la verificación MFA (`mfa_verified`) dentro del Access Token que reciben API Gateway y las Lambdas.

---

## 5. Comparativa: Autorización Embebida vs. Externalizada con Cedar (HU-12)

Como extensión (HU-12), se reescribieron las reglas de **HU-04, HU-07 y HU-08** en lenguaje declarativo Cedar ([`docs/cedar/policies.cedar`](cedar/policies.cedar)) y esquema formal ([`docs/cedar/schema.cedarschema.json`](cedar/schema.cedarschema.json)), integrando `@aws-sdk/client-verifiedpermissions` (`IsAuthorized`) en [`api/src/auth/cedar.ts`](../api/src/auth/cedar.ts) y repitiendo T03, T09 y T12 en [`api/src/auth/cedar.test.ts`](../api/src/auth/cedar.test.ts).

| Criterio | Autorización Embebida (`authz.ts` en Lambda) | Autorización Externalizada (Amazon Verified Permissions + Cedar) |
| :--- | :--- | :--- |
| **Latencia por petición** | $< 1$ ms (evaluación en memoria dentro de Lambda, sin llamadas de red). | $+15$ a $+40$ ms por llamada HTTPS adicional `IsAuthorized` hacia Verified Permissions. |
| **Desacoplamiento código / política** | Medio: las reglas viven en TypeScript (`requireRole`, `assertOwnership`); cambiar una regla requiere redesplegar código Lambda. | **Alto:** las políticas Cedar se actualizan y versionan en el Policy Store sin tocar ni redesplegar funciones Lambda. |
| **Auditabilidad formal** | Depende de leer código TypeScript e inspeccionar pruebas unitarias. | **Alta:** políticas declarativas legibles, validables contra un esquema estricto (`schema.cedarschema.json`) y con `determiningPolicies` trazables en cada respuesta. |
| **Riesgo de privilegios y complejidad** | Cero permisos IAM adicionales para autorización; arquitectura más simple. | Requiere otorgar permiso `verifiedpermissions:IsAuthorized` a cada rol Lambda y mantener sincronizadas las entidades y el Policy Store en SAM. |
| **Costo operativo (Free Plan)** | **$0** adicional (incluido en el cómputo existente de Lambda). | Costo por petición `IsAuthorized` evaluada en Verified Permissions. |
| **Recomendación para el proyecto** | **Óptima para el prototipo actual:** cumple todos los controles Zero Trust con mínima latencia y cero costo extra. | **Recomendada en producción multi-equipo:** ideal cuando seguridad y negocio necesitan gobernar políticas centralizadas e independientes del código. |

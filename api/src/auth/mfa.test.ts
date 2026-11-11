import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { apiEvent } from "../test-utils/events.js";
import { extractAuthContext, validateTokenOrigin } from "./authorizer.js";
import { hasMfa, requireMfa, requireRoleWithMfa } from "./authz.js";
import { type CognitoPreTokenV2Event, preTokenGenerationMfaHandler } from "./cognitoMfaTrigger.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
import type { CognitoJwtPayload } from "./types.js";

function createMockJwt(payload: Partial<CognitoJwtPayload>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.mockSig12345`;
}

function bearerEvent(routeKey: string, jwt: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey,
    rawPath: routeKey.split(" ")[1] ?? "/",
    rawQueryString: "",
    headers: { authorization: `Bearer ${jwt}` },
    requestContext: {
      accountId: "000000000000",
      apiId: "api-test",
      domainName: "api.test.local",
      domainPrefix: "api",
      http: {
        method: routeKey.split(" ")[0] ?? "GET",
        path: routeKey.split(" ")[1] ?? "/",
        protocol: "HTTP/1.1",
        sourceIp: "192.0.2.1",
        userAgent: "vitest",
      },
      requestId: "req-mfa-test",
      routeKey,
      stage: "academic",
      time: "11/Nov/2026:12:00:00 +0000",
      timeEpoch: 1794400000000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

describe("MFA obligatorio, validación de origen y revocación JWT (Día 5)", () => {
  describe("Prueba T13: MFA TOTP obligatorio para rol GESTOR (HU-11)", () => {
    it("rechaza con 403 (MFA_REQUIRED) cuando GESTOR se autentica solo con contraseña", () => {
      const gestorSinMfa = apiEvent({
        routeKey: "POST /v1/projects",
        user: {
          claims: {
            sub: "gestor-no-mfa-1",
            token_use: "access",
            "cognito:groups": "[GESTOR]",
            amr: "[pwd]",
          },
          scopes: ["api/projects.write"],
        },
      });

      const ctx = extractAuthContext(gestorSinMfa);
      expect(hasMfa(ctx)).toBe(false);
      expect(() => requireMfa(ctx)).toThrow(ForbiddenError);
      expect(() => requireRoleWithMfa(ctx, "GESTOR")).toThrow(ForbiddenError);

      try {
        requireRoleWithMfa(ctx, "GESTOR");
      } catch (err) {
        const forbidden = err as ForbiddenError;
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.code).toBe("MFA_REQUIRED");
      }
    });

    it("permite el acceso cuando GESTOR presenta amr con sw_token o mfa_verified", () => {
      const gestorConMfa = apiEvent({
        routeKey: "POST /v1/projects",
        user: {
          claims: {
            sub: "gestor-mfa-1",
            token_use: "access",
            "cognito:groups": "[GESTOR]",
            amr: "[pwd sw_token]",
          },
          scopes: ["api/projects.write"],
        },
      });

      const ctx = extractAuthContext(gestorConMfa);
      expect(hasMfa(ctx)).toBe(true);
      expect(() => requireRoleWithMfa(ctx, "GESTOR")).not.toThrow();
    });

    it("Cognito Pre-Token Trigger bloquea emisión para GESTOR sin TOTP MFA y la propaga si tiene MFA", async () => {
      const baseTriggerEvent: CognitoPreTokenV2Event = {
        triggerSource: "TokenGeneration_Authentication",
        userName: "gestor-test",
        request: {
          userAttributes: { sub: "gestor-1", email: "gestor@ejemplo.com" },
          groupConfiguration: { groupsToOverride: ["GESTOR"] },
          authenticationMethods: ["pwd"],
        },
        response: {},
      };

      await expect(preTokenGenerationMfaHandler(baseTriggerEvent)).rejects.toThrow(/MFA_REQUIRED/);

      const mfaTriggerEvent: CognitoPreTokenV2Event = {
        ...baseTriggerEvent,
        request: {
          ...baseTriggerEvent.request,
          authenticationMethods: ["pwd", "SOFTWARE_TOKEN_MFA"],
        },
      };

      const result = await preTokenGenerationMfaHandler(mfaTriggerEvent);
      expect(
        result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride,
      ).toEqual({ mfa_verified: "true" });
    });
  });

  describe("Prueba T14: MFA TOTP obligatorio para rol AUDITOR (HU-11)", () => {
    it("rechaza con 403 (MFA_REQUIRED) a un AUDITOR sin TOTP MFA al consultar auditoría", () => {
      const auditorSinMfa = apiEvent({
        routeKey: "GET /v1/audit",
        user: {
          claims: {
            sub: "auditor-no-mfa-1",
            token_use: "access",
            "cognito:groups": "[AUDITOR]",
            mfa_verified: "false",
          },
          scopes: ["api/audit.read"],
        },
      });

      const ctx = extractAuthContext(auditorSinMfa);
      expect(() => requireRoleWithMfa(ctx, "AUDITOR")).toThrow(ForbiddenError);

      try {
        requireRoleWithMfa(ctx, "AUDITOR");
      } catch (err) {
        const forbidden = err as ForbiddenError;
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.code).toBe("MFA_REQUIRED");
      }
    });

    it("rechaza con 403 (FORBIDDEN_ROLE) a un DONANTE aunque tenga TOTP MFA activo", () => {
      const donanteConMfa = apiEvent({
        routeKey: "GET /v1/audit",
        user: {
          claims: {
            sub: "donante-mfa-1",
            token_use: "access",
            "cognito:groups": "[DONANTE]",
            amr: "[pwd sw_token]",
          },
          scopes: ["api/donations.*"],
        },
      });

      const ctx = extractAuthContext(donanteConMfa);
      expect(hasMfa(ctx)).toBe(true);
      expect(() => requireRoleWithMfa(ctx, "AUDITOR")).toThrow(ForbiddenError);

      try {
        requireRoleWithMfa(ctx, "AUDITOR");
      } catch (err) {
        const forbidden = err as ForbiddenError;
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.code).toBe("FORBIDDEN_ROLE");
      }
    });

    it("autoriza a un AUDITOR que completó TOTP MFA (mfa_verified: true)", () => {
      const auditorConMfa = apiEvent({
        routeKey: "GET /v1/audit",
        user: {
          claims: {
            sub: "auditor-mfa-1",
            token_use: "access",
            "cognito:groups": "[AUDITOR]",
            mfa_verified: "true",
          },
          scopes: ["api/audit.read"],
        },
      });

      const ctx = extractAuthContext(auditorConMfa);
      expect(hasMfa(ctx)).toBe(true);
      expect(() => requireRoleWithMfa(ctx, "AUDITOR")).not.toThrow();
    });
  });

  describe("Demostración CA-03.4: Limitación de revocación de Access Tokens stateless", () => {
    it("un Access Token vigente (TTL <= 15 min) sigue siendo aceptado tras revocar el Refresh Token hasta su exp", () => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const ttlSeconds = 15 * 60; // 900 segundos (HU-03)

      const accessToken = createMockJwt({
        sub: "donante-revocacion-1",
        token_use: "access",
        scope: "api/donations.*",
        "cognito:groups": ["DONANTE"],
        iat: nowEpoch,
        exp: nowEpoch + ttlSeconds,
      });

      // 1. Verificación del TTL configurado (<= 15 minutos)
      const ctxBeforeLogout = extractAuthContext(bearerEvent("GET /v1/donations/me", accessToken));
      expect((ctxBeforeLogout.exp ?? 0) - (ctxBeforeLogout.iat ?? 0)).toBeLessThanOrEqual(900);

      // 2. Simulación de logout: Cognito /oauth2/revoke invalida el Refresh Token,
      // pero el Access Token ya emitido permanece válido en una arquitectura stateless
      // mientras el reloj siga dentro de su ventana de expiración (limitación CA-03.4).
      const refreshRevokedAt = nowEpoch + 60;
      expect(refreshRevokedAt).toBeLessThan(ctxBeforeLogout.exp ?? 0);
      const ctxAfterRevokeBeforeExp = extractAuthContext(
        bearerEvent("GET /v1/donations/me", accessToken),
      );
      expect(ctxAfterRevokeBeforeExp.sub).toBe("donante-revocacion-1");

      // 3. Una vez vencido su TTL corto de 15 minutos, el token es rechazado con 401 TOKEN_EXPIRED.
      const expiredAccessToken = createMockJwt({
        sub: "donante-revocacion-1",
        token_use: "access",
        scope: "api/donations.*",
        "cognito:groups": ["DONANTE"],
        iat: nowEpoch - 1000,
        exp: nowEpoch - 100,
      });

      expect(() => extractAuthContext(bearerEvent("GET /v1/donations/me", expiredAccessToken))).toThrow(
        UnauthorizedError,
      );
      try {
        extractAuthContext(bearerEvent("GET /v1/donations/me", expiredAccessToken));
      } catch (err) {
        const authErr = err as UnauthorizedError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.code).toBe("TOKEN_EXPIRED");
      }
    });
  });

  describe("Validación explícita de emisor y client_id (RNF-HU-02)", () => {
    it("rechaza tokens cuyo iss o client_id no coinciden con la configuración del pool", () => {
      const ctx = extractAuthContext(
        apiEvent({
          routeKey: "GET /v1/donations/me",
          user: {
            claims: {
              sub: "usr-origin-1",
              token_use: "access",
              iss: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_MALICIOUS",
              client_id: "fake-client-id",
            },
            scopes: ["api/donations.*"],
          },
        }),
      );

      expect(() =>
        validateTokenOrigin(ctx, {
          issuer: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_EXPECTED",
        }),
      ).toThrow(UnauthorizedError);

      expect(() =>
        validateTokenOrigin(ctx, {
          clientId: "expected-client-id",
        }),
      ).toThrow(UnauthorizedError);
    });
  });
});

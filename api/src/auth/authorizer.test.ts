import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { extractAuthContext, validateScope } from "./authorizer.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
import type { CognitoJwtPayload } from "./types.js";

/**
 * Genera un token JWT simulado (sin firma criptografica, solo estructura base64url)
 * para pruebas unitarias del decodificador y authorizer.
 */
function createMockJwt(payload: Partial<CognitoJwtPayload>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = "mockSignature12345";
  return `${header}.${body}.${signature}`;
}

function createMockEvent(overrides: {
  headers?: Record<string, string>;
  authorizerClaims?: Record<string, unknown>;
  authorizerScopes?: string[];
}): APIGatewayProxyEventV2 {
  const baseContext = {
    accountId: "123456789012",
    apiId: "api-test",
    domainName: "api.test.local",
    domainPrefix: "api",
    http: {
      method: "POST",
      path: "/v1/projects",
      protocol: "HTTP/1.1",
      sourceIp: "192.0.2.1",
      userAgent: "vitest/test-agent",
    },
    requestId: "req-test-123",
    routeKey: "POST /v1/projects",
    stage: "$default",
    time: "08/Nov/2026:22:00:00 +0000",
    timeEpoch: 1794182400000,
    authorizer: overrides.authorizerClaims
      ? {
          jwt: {
            claims: overrides.authorizerClaims,
            scopes: overrides.authorizerScopes ?? [],
          },
        }
      : undefined,
  };

  return {
    version: "2.0",
    routeKey: "POST /v1/projects",
    rawPath: "/v1/projects",
    rawQueryString: "",
    headers: overrides.headers ?? {},
    requestContext: baseContext as unknown as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
  };
}

describe("Authorizer & Token Validation (Día 2)", () => {
  describe("Prueba T02: Rechazo estricto de ID Tokens (RNF-HU-02, CA-NF02.1)", () => {
    it("rechaza con 401 (ID_TOKEN_NOT_ALLOWED) cuando se presenta un ID Token via header Authorization", () => {
      const idToken = createMockJwt({
        sub: "usr-1111-aaaa",
        token_use: "id",
        email: "donante@ejemplo.com",
        "cognito:groups": ["DONANTE"],
      });

      const event = createMockEvent({
        headers: {
          authorization: `Bearer ${idToken}`,
        },
      });

      expect(() => extractAuthContext(event)).toThrow(UnauthorizedError);

      try {
        extractAuthContext(event);
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedError);
        const authErr = err as UnauthorizedError;
        expect(authErr.statusCode).toBe(401);
        expect(authErr.code).toBe("ID_TOKEN_NOT_ALLOWED");
        expect(authErr.message).toContain("se presentó un ID Token");
      }
    });

    it("rechaza con 401 (ID_TOKEN_NOT_ALLOWED) cuando API Gateway envia claims de un ID Token", () => {
      const event = createMockEvent({
        authorizerClaims: {
          sub: "usr-2222-bbbb",
          token_use: "id",
          email: "gestor@ejemplo.com",
        },
      });

      expect(() => extractAuthContext(event)).toThrowError(
        /se presentó un ID Token en lugar de un Access Token/,
      );
    });

    it("rechaza cuando token_use no es 'access'", () => {
      const refreshToken = createMockJwt({
        sub: "usr-3333-cccc",
        token_use: "refresh",
      });

      const event = createMockEvent({
        headers: {
          authorization: `Bearer ${refreshToken}`,
        },
      });

      expect(() => extractAuthContext(event)).toThrow(UnauthorizedError);
      try {
        extractAuthContext(event);
      } catch (err) {
        const authErr = err as UnauthorizedError;
        expect(authErr.code).toBe("INVALID_TOKEN_USE");
      }
    });

    it("rechaza cuando la cabecera de autorizacion esta ausente", () => {
      const event = createMockEvent({ headers: {} });

      expect(() => extractAuthContext(event)).toThrow(UnauthorizedError);
      try {
        extractAuthContext(event);
      } catch (err) {
        const authErr = err as UnauthorizedError;
        expect(authErr.code).toBe("MISSING_TOKEN");
      }
    });

    it("rechaza cuando el token esta expirado", () => {
      const expiredToken = createMockJwt({
        sub: "usr-4444-dddd",
        token_use: "access",
        exp: Math.floor(Date.now() / 1000) - 3600, // expirado hace 1 hora
      });

      const event = createMockEvent({
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(() => extractAuthContext(event)).toThrow(UnauthorizedError);
      try {
        extractAuthContext(event);
      } catch (err) {
        const authErr = err as UnauthorizedError;
        expect(authErr.code).toBe("TOKEN_EXPIRED");
      }
    });
  });

  describe("Prueba T11: Validacion de scopes por ruta (RNF-HU-02)", () => {
    it("permite el acceso cuando el token contiene el scope exacto requerido", () => {
      const accessToken = createMockJwt({
        sub: "usr-gestor-1",
        token_use: "access",
        scope: "api/projects.write openid",
        "cognito:groups": ["GESTOR"],
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      const event = createMockEvent({
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const ctx = extractAuthContext(event);
      expect(ctx.sub).toBe("usr-gestor-1");
      expect(ctx.roles).toEqual(["GESTOR"]);
      expect(ctx.scopes).toContain("api/projects.write");

      expect(() => validateScope(ctx, "api/projects.write")).not.toThrow();
    });

    it("rechaza con 403 (INSUFFICIENT_SCOPE) cuando falta el scope requerido", () => {
      const accessToken = createMockJwt({
        sub: "usr-donante-1",
        token_use: "access",
        scope: "api/donations.* openid",
        "cognito:groups": ["DONANTE"],
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      const event = createMockEvent({
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const ctx = extractAuthContext(event);
      expect(() => validateScope(ctx, "api/projects.write")).toThrow(ForbiddenError);

      try {
        validateScope(ctx, "api/projects.write");
      } catch (err) {
        const forbErr = err as ForbiddenError;
        expect(forbErr.statusCode).toBe(403);
        expect(forbErr.code).toBe("INSUFFICIENT_SCOPE");
        expect(forbErr.message).toContain("api/projects.write");
      }
    });

    it("reconoce el comodin api/donations.* para sub-scopes de donacion", () => {
      const accessToken = createMockJwt({
        sub: "usr-donante-2",
        token_use: "access",
        scope: "api/donations.*",
        "cognito:groups": ["DONANTE"],
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      const event = createMockEvent({
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const ctx = extractAuthContext(event);
      expect(() => validateScope(ctx, "api/donations.create")).not.toThrow();
      expect(() => validateScope(ctx, "api/donations.read")).not.toThrow();
    });
  });

  describe("Claims tal como los entrega el JWT authorizer de HTTP API (strings)", () => {
    it("interpreta cognito:groups con formato \"[GESTOR]\" como el rol GESTOR", () => {
      const event = createMockEvent({
        authorizerClaims: {
          sub: "usr-gestor-apigw",
          token_use: "access",
          "cognito:groups": "[GESTOR]",
          exp: String(Math.floor(Date.now() / 1000) + 900),
        },
        authorizerScopes: ["api/projects.write"],
      });

      const ctx = extractAuthContext(event);
      expect(ctx.roles).toEqual(["GESTOR"]);
      expect(ctx.scopes).toEqual(["api/projects.write"]);
    });

    it("interpreta varios grupos separados por espacio y descarta los desconocidos", () => {
      const event = createMockEvent({
        authorizerClaims: {
          sub: "usr-multi-apigw",
          token_use: "access",
          "cognito:groups": "[DONANTE ADMIN GESTOR]",
        },
      });

      expect(extractAuthContext(event).roles).toEqual(["DONANTE", "GESTOR"]);
    });

    it("no concede roles cuando el claim falta o está vacío", () => {
      const event = createMockEvent({
        authorizerClaims: { sub: "usr-sin-grupos", token_use: "access", "cognito:groups": "[]" },
      });

      expect(extractAuthContext(event).roles).toEqual([]);
    });
  });
});

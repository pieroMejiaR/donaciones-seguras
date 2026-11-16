import type { APIGatewayProxyEventV2 } from "aws-lambda";

/** Usuario de prueba: claims del token y scopes concedidos. */
export interface TestUser {
  claims: Record<string, unknown>;
  scopes: string[];
}

/**
 * Usuarios de prueba con claims tal como los entrega el JWT authorizer de HTTP API (strings).
 * mfa_verified lo agrega el trigger Pre-Token Generation a GESTOR y AUDITOR con TOTP (HU-11).
 */
export const GESTOR = {
  claims: {
    sub: "11111111-1111-4111-8111-111111111111",
    token_use: "access",
    "cognito:groups": "[GESTOR]",
    mfa_verified: "true",
  },
  scopes: ["api/projects.write"],
};

/** GESTOR con un token emitido sin el claim de MFA (T13). */
export const GESTOR_SIN_MFA = {
  claims: { ...GESTOR.claims, mfa_verified: "false" },
  scopes: GESTOR.scopes,
};

export const AUDITOR = {
  claims: {
    sub: "44444444-4444-4444-8444-444444444444",
    token_use: "access",
    "cognito:groups": "[AUDITOR]",
    mfa_verified: "true",
  },
  scopes: ["api/audit.read"],
};

/** AUDITOR con un token emitido sin el claim de MFA (T14). */
export const AUDITOR_SIN_MFA = {
  claims: { ...AUDITOR.claims, mfa_verified: "false" },
  scopes: AUDITOR.scopes,
};

export const DONANTE = {
  claims: {
    sub: "22222222-2222-4222-8222-222222222222",
    token_use: "access",
    "cognito:groups": "[DONANTE]",
  },
  scopes: ["api/donations.*"],
};

interface EventOptions {
  routeKey: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
  /** Cuerpo literal, para probar JSON inválido. */
  rawBody?: string;
  headers?: Record<string, string>;
  user?: TestUser;
}

export function apiEvent(options: EventOptions): APIGatewayProxyEventV2 {
  const [method = "GET", path = "/"] = options.routeKey.split(" ");
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

  return {
    version: "2.0",
    routeKey: options.routeKey,
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json", ...options.headers },
    pathParameters: options.pathParameters,
    queryStringParameters: options.queryStringParameters,
    body,
    isBase64Encoded: false,
    requestContext: {
      requestId: "req-test-0001",
      routeKey: options.routeKey,
      stage: "dev",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "192.0.2.10", userAgent: "vitest" },
      ...(options.user
        ? { authorizer: { jwt: { claims: options.user.claims, scopes: options.user.scopes } } }
        : {}),
    },
  } as unknown as APIGatewayProxyEventV2;
}

export function bodyOf(response: { body?: string }): Record<string, unknown> {
  return JSON.parse(response.body ?? "{}") as Record<string, unknown>;
}

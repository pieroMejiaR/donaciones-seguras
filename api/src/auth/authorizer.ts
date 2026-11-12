import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
import type { AppScope, AuthContext, CognitoJwtPayload, UserRole } from "./types.js";

const VALID_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["DONANTE", "GESTOR", "AUDITOR"]);
const MFA_AMR_METHODS: ReadonlySet<string> = new Set([
  "mfa",
  "sw_token",
  "totp",
  "otp",
  "software_token_mfa",
]);

/**
 * Decodifica de forma segura la seccion payload de un JWT (base64url).
 * No realiza verificacion de firma criptografica por si sola; dicha verificacion
 * la realiza API Gateway HTTP API mediante el JWT Authorizer antes de delegar a la Lambda.
 */
export function decodeJwtPayload(token: string): CognitoJwtPayload {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    throw new UnauthorizedError("MALFORMED_TOKEN", "El formato del token JWT es invalido");
  }

  const payloadBase64 = parts[1];
  if (!payloadBase64) {
    throw new UnauthorizedError("MALFORMED_TOKEN", "El payload del token JWT no puede estar vacio");
  }

  try {
    const jsonString = Buffer.from(payloadBase64, "base64url").toString("utf-8");
    return JSON.parse(jsonString) as CognitoJwtPayload;
  } catch {
    throw new UnauthorizedError("MALFORMED_TOKEN", "No fue posible decodificar el payload del token");
  }
}

/**
 * Normaliza los grupos de Cognito en un array de roles validos del sistema.
 */
function extractRolesFromClaims(claims: CognitoJwtPayload): UserRole[] {
  return parseClaimList(claims["cognito:groups"] as unknown).filter((group): group is UserRole =>
    VALID_ROLES.has(group as UserRole),
  );
}

/**
 * El JWT authorizer de API Gateway HTTP API entrega cada claim como string: un claim de tipo
 * arreglo como cognito:groups o amr llega como "[GESTOR DONANTE]" o "[pwd sw_token]".
 * Al decodificar el token directamente llega como arreglo. Se aceptan ambas formas.
 */
function parseClaimList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const inner =
      trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
    return inner.split(/[\s,]+/).filter((item) => item.length > 0);
  }

  return [];
}

function toEpochSeconds(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return undefined;
}

function isMfaVerified(claims: CognitoJwtPayload, amr: string[]): boolean {
  if (claims.mfa_verified === true || claims.mfa_verified === "true") {
    return true;
  }
  return amr.some((method) => MFA_AMR_METHODS.has(method.toLowerCase()));
}

/**
 * Normaliza los scopes desde los claims del token o del contexto del authorizer de API Gateway.
 */
function extractScopes(claims: CognitoJwtPayload, authorizerScopes?: string[]): string[] {
  if (Array.isArray(authorizerScopes) && authorizerScopes.length > 0) {
    return authorizerScopes;
  }

  if (typeof claims.scope === "string" && claims.scope.trim().length > 0) {
    return claims.scope.trim().split(/\s+/);
  }

  return [];
}

/**
 * Extrae y valida el contexto de autenticacion Zero Trust desde un evento HTTP API Gateway v2.
 *
 * Aplica los siguientes controles obligatorios:
 * 1. Existencia de credenciales de autenticacion (Authorizer JWT o Bearer header).
 * 2. Rechazo explicito de ID Tokens (CA-NF02.1 / T02): Si `token_use === 'id'`, se rechaza con 401.
 * 3. Verificacion de que `token_use === 'access'`.
 * 4. Verificacion de expiracion (`exp`).
 * 5. Mapeo estricto de roles (`cognito:groups`) y `sub`.
 */
export function extractAuthContext(event: APIGatewayProxyEventV2): AuthContext {
  // Caso A: Token ya procesado por el API Gateway HTTP API JWT Authorizer
  // Tipo estructurado en event.requestContext.authorizer.jwt
  const authorizerJwt = (event.requestContext as unknown as {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
        scopes?: string[];
      };
    };
  })?.authorizer?.jwt;

  let claims: CognitoJwtPayload | undefined;
  let authorizerScopes: string[] | undefined;

  if (authorizerJwt?.claims) {
    claims = authorizerJwt.claims as unknown as CognitoJwtPayload;
    authorizerScopes = authorizerJwt.scopes;
  } else {
    // Caso B: Extraccion desde el header Authorization Bearer (pruebas o invocacion directa)
    const authHeader =
      event.headers?.authorization ??
      event.headers?.Authorization;

    if (!authHeader) {
      throw new UnauthorizedError(
        "MISSING_TOKEN",
        "Encabezado de autorización ausente o incompleto",
      );
    }

    const [scheme, token] = authHeader.trim().split(/\s+/);
    if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
      throw new UnauthorizedError(
        "INVALID_AUTH_HEADER",
        "El encabezado de autorización debe tener el formato Bearer <token>",
      );
    }

    claims = decodeJwtPayload(token);
  }

  if (!claims) {
    throw new UnauthorizedError("UNAUTHORIZED", "No se encontraron credenciales validas");
  }

  // Control CA-NF02.1 / T02: Rechazo estricto de ID Tokens
  const tokenUse = claims.token_use ?? "unknown";
  if (tokenUse === "id") {
    throw new UnauthorizedError(
      "ID_TOKEN_NOT_ALLOWED",
      "Operación denegada: se presentó un ID Token en lugar de un Access Token.",
    );
  }

  if (tokenUse !== "access") {
    throw new UnauthorizedError(
      "INVALID_TOKEN_USE",
      `Tipo de token no permitido: se requiere un Access Token (recibido: ${tokenUse})`,
    );
  }

  // Verificacion de tiempo de expiracion si esta presente en claims
  const exp = toEpochSeconds(claims.exp);
  const iat = toEpochSeconds(claims.iat);
  if (exp !== undefined) {
    const currentEpoch = Math.floor(Date.now() / 1000);
    if (currentEpoch >= exp) {
      throw new UnauthorizedError("TOKEN_EXPIRED", "El token ha expirado");
    }
  }

  const sub = claims.sub;
  if (!sub || typeof sub !== "string" || sub.trim().length === 0) {
    throw new UnauthorizedError(
      "INVALID_TOKEN_CLAIMS",
      "El token no contiene un identificador 'sub' valido",
    );
  }

  const username =
    (claims["cognito:username"] as string | undefined) ??
    (claims.username as string | undefined) ??
    sub;

  const roles = extractRolesFromClaims(claims);
  const scopes = extractScopes(claims, authorizerScopes);
  const amr = parseClaimList(claims.amr as unknown);
  const mfaVerified = isMfaVerified(claims, amr);

  return {
    sub,
    username,
    roles,
    scopes,
    tokenUse,
    amr,
    mfaVerified,
    iss: typeof claims.iss === "string" ? claims.iss : undefined,
    clientId: typeof claims.client_id === "string" ? claims.client_id : undefined,
    iat,
    exp,
    rawClaims: claims,
  };
}

/**
 * Validacion explicita de emisor (iss) y client_id contra la configuracion esperada (RNF-HU-02).
 */
export function validateTokenOrigin(
  ctx: AuthContext,
  expected: { issuer?: string; clientId?: string },
): void {
  if (expected.issuer && ctx.iss !== expected.issuer) {
    throw new UnauthorizedError(
      "INVALID_ISSUER",
      "El emisor (iss) del token no corresponde al User Pool configurado",
    );
  }

  if (expected.clientId && ctx.clientId !== expected.clientId) {
    throw new UnauthorizedError(
      "INVALID_CLIENT_ID",
      "El client_id del token no corresponde al App Client autorizado",
    );
  }
}

/**
 * Valida que el contexto contenga el scope requerido. Si no lo tiene, lanza ForbiddenError (T11).
 */
export function validateScope(ctx: AuthContext, requiredScope: AppScope): void {
  const hasExact = ctx.scopes.includes(requiredScope);
  if (hasExact) {
    return;
  }

  // Soporte para comodin api/donations.*
  if (requiredScope.startsWith("api/donations.")) {
    if (ctx.scopes.includes("api/donations.*")) {
      return;
    }
  }

  throw new ForbiddenError(
    "INSUFFICIENT_SCOPE",
    `Acceso denegado: el token no cuenta con el scope requerido '${requiredScope}'`,
  );
}

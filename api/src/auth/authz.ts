import { ForbiddenError } from "./errors.js";
import type { AppScope, AuthContext, UserRole } from "./types.js";

/** Roles que exigen autenticacion multifactor TOTP obligatoria (HU-11). */
export const MFA_REQUIRED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["GESTOR", "AUDITOR"]);

/**
 * Comprueba si el usuario autenticado completo un segundo factor (TOTP MFA).
 */
export function hasMfa(ctx: AuthContext): boolean {
  return ctx.mfaVerified;
}

/**
 * Exige verificacion TOTP MFA activa en la sesion (HU-11, T13, T14).
 */
export function requireMfa(ctx: AuthContext): void {
  if (!hasMfa(ctx)) {
    throw new ForbiddenError(
      "MFA_REQUIRED",
      "Acceso denegado: se requiere autenticación multifactor (TOTP MFA)",
    );
  }
}

/**
 * Exige rol RBAC y, para roles privilegiados (GESTOR y AUDITOR), exige TOTP MFA obligatorio (HU-11).
 */
export function requireRoleWithMfa(ctx: AuthContext, role: UserRole): void {
  requireRole(ctx, role);
  if (MFA_REQUIRED_ROLES.has(role)) {
    requireMfa(ctx);
  }
}

/**
 * Comprueba si el usuario autenticado posee un rol especifico.
 */
export function hasRole(ctx: AuthContext, role: UserRole): boolean {
  return ctx.roles.includes(role);
}

/**
 * Comprueba si el usuario autenticado posee al menos uno de los roles dados.
 */
export function hasAnyRole(ctx: AuthContext, roles: readonly UserRole[]): boolean {
  return roles.some((role) => ctx.roles.includes(role));
}

/**
 * Exige que el usuario autenticado posea un rol especifico (HU-04, T03).
 * Si el usuario no tiene el rol, lanza ForbiddenError (403).
 */
export function requireRole(ctx: AuthContext, role: UserRole): void {
  if (!hasRole(ctx, role)) {
    throw new ForbiddenError(
      "FORBIDDEN_ROLE",
      `Acceso denegado: se requiere el rol ${role}`,
    );
  }
}

/**
 * Exige que el usuario autenticado posea al menos uno de los roles indicados.
 */
export function requireAnyRole(ctx: AuthContext, roles: readonly UserRole[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new ForbiddenError(
      "FORBIDDEN_ROLE",
      `Acceso denegado: se requiere uno de los siguientes roles: ${roles.join(", ")}`,
    );
  }
}

/**
 * Comprueba si el contexto posee un scope especifico (o comodin api/donations.*).
 */
export function hasScope(ctx: AuthContext, scope: AppScope | string): boolean {
  if (ctx.scopes.includes(scope)) {
    return true;
  }

  if (scope.startsWith("api/donations.") && ctx.scopes.includes("api/donations.*")) {
    return true;
  }

  return false;
}

/**
 * Exige que el contexto contenga un scope especifico (T11).
 */
export function requireScope(ctx: AuthContext, scope: AppScope): void {
  if (!hasScope(ctx, scope)) {
    throw new ForbiddenError(
      "INSUFFICIENT_SCOPE",
      `Acceso denegado: se requiere el scope '${scope}'`,
    );
  }
}

/**
 * Verificacion estricta de pertenencia (Ownership) por 'sub' contra el recurso persistido (HU-04, CA-07.2, T09, T12).
 *
 * Enfoque Zero Trust: El usuario no puede especificar arbitrariamente un donorSub en el cuerpo
 * o parametros; el backend siempre valida contra el recurso o toma el sub del token.
 */
export function assertOwnership(ctx: AuthContext, resourceOwnerSub: string): void {
  if (!resourceOwnerSub || resourceOwnerSub.trim().length === 0) {
    throw new ForbiddenError(
      "FORBIDDEN_OWNERSHIP",
      "Acceso denegado: identificador de propietario de recurso invalido",
    );
  }

  if (ctx.sub !== resourceOwnerSub) {
    throw new ForbiddenError(
      "FORBIDDEN_OWNERSHIP",
      "Acceso denegado: el recurso pertenece a otro donante",
    );
  }
}

/**
 * Retorna el identificador unico inmutable del donante autenticado (sub),
 * garantizando que las Lambdas no acepten nunca donorSub provisto en el payload cliente.
 */
export function extractDonorSub(ctx: AuthContext): string {
  return ctx.sub;
}

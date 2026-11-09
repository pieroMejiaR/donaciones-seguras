import { describe, expect, it } from "vitest";
import {
  assertOwnership,
  extractDonorSub,
  hasAnyRole,
  hasRole,
  requireAnyRole,
  requireRole,
  requireScope,
} from "./authz.js";
import { formatErrorResponse, ForbiddenError } from "./errors.js";
import type { AuthContext } from "./types.js";

function createMockAuthContext(overrides: Partial<AuthContext>): AuthContext {
  return {
    sub: overrides.sub ?? "sub-default-1234",
    username: overrides.username ?? "usuario-test",
    roles: overrides.roles ?? ["DONANTE"],
    scopes: overrides.scopes ?? ["api/donations.*"],
    tokenUse: overrides.tokenUse ?? "access",
    rawClaims: overrides.rawClaims ?? { sub: "sub-default-1234", token_use: "access" },
  };
}

describe("Módulo authz: RBAC y Ownership (Día 3)", () => {
  describe("Prueba T03: Control de Acceso RBAC Negativo (HU-04)", () => {
    it("demuestra que ocultar botones no es autorizacion: DONANTE llamando a endpoint de GESTOR es rechazado con 403", () => {
      // Simula a un atacante que en el frontend inspecciono el DOM o llamo directamente
      // al endpoint POST /v1/projects usando su Access Token valido de DONANTE
      const donanteCtx = createMockAuthContext({
        sub: "donante-sub-001",
        username: "donante@test.com",
        roles: ["DONANTE"],
        scopes: ["api/donations.*"],
      });

      // El handler ejecuta la comprobacion Zero Trust del backend
      expect(() => requireRole(donanteCtx, "GESTOR")).toThrow(ForbiddenError);

      try {
        requireRole(donanteCtx, "GESTOR");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
        const forbiddenErr = err as ForbiddenError;
        expect(forbiddenErr.statusCode).toBe(403);
        expect(forbiddenErr.code).toBe("FORBIDDEN_ROLE");
        expect(forbiddenErr.message).toBe("Acceso denegado: se requiere el rol GESTOR");

        // Verificamos que la respuesta uniforme formateada para API Gateway cumpla RNF-HU-10
        const formatted = formatErrorResponse(forbiddenErr, "req-t03-audit-trace");
        expect(formatted.statusCode).toBe(403);
        const body = JSON.parse(formatted.body ?? "{}");
        expect(body).toEqual({
          code: "FORBIDDEN_ROLE",
          message: "Acceso denegado: se requiere el rol GESTOR",
          requestId: "req-t03-audit-trace",
        });
      }
    });

    it("permite la ejecucion cuando el usuario pertenece al grupo GESTOR", () => {
      const gestorCtx = createMockAuthContext({
        sub: "gestor-sub-002",
        username: "gestor@test.com",
        roles: ["GESTOR"],
        scopes: ["api/projects.write"],
      });

      expect(() => requireRole(gestorCtx, "GESTOR")).not.toThrow();
      expect(hasRole(gestorCtx, "GESTOR")).toBe(true);
      expect(hasRole(gestorCtx, "DONANTE")).toBe(false);
    });

    it("permite verificar multiples roles con requireAnyRole", () => {
      const auditorCtx = createMockAuthContext({
        sub: "auditor-sub-003",
        roles: ["AUDITOR"],
      });

      expect(() => requireAnyRole(auditorCtx, ["GESTOR", "AUDITOR"])).not.toThrow();
      expect(hasAnyRole(auditorCtx, ["GESTOR", "AUDITOR"])).toBe(true);

      const donanteCtx = createMockAuthContext({
        roles: ["DONANTE"],
      });

      expect(() => requireAnyRole(donanteCtx, ["GESTOR", "AUDITOR"])).toThrow(ForbiddenError);
    });
  });

  describe("Control de Scopes en autorizacion", () => {
    it("requireScope lanza ForbiddenError (403) si no coincide el scope", () => {
      const ctx = createMockAuthContext({
        scopes: ["api/donations.*"],
      });

      expect(() => requireScope(ctx, "api/projects.write")).toThrow(ForbiddenError);
      expect(() => requireScope(ctx, "api/donations.create")).not.toThrow();
    });
  });

  describe("Verificacion de Pertenencia (Ownership) por sub (CA-07.2, T09 / T12)", () => {
    it("permite el acceso cuando el sub autenticado coincide con el propietario del recurso", () => {
      const donorSub = "usr-donante-owner-999";
      const ctx = createMockAuthContext({ sub: donorSub });

      expect(() => assertOwnership(ctx, donorSub)).not.toThrow();
    });

    it("rechaza con 403 (FORBIDDEN_OWNERSHIP) cuando un donante intenta acceder al recurso de otro", () => {
      const atacanteSub = "usr-donante-malicioso-666";
      const victimaSub = "usr-donante-legitimo-777";
      const ctx = createMockAuthContext({ sub: atacanteSub });

      expect(() => assertOwnership(ctx, victimaSub)).toThrow(ForbiddenError);

      try {
        assertOwnership(ctx, victimaSub);
      } catch (err) {
        const forbiddenErr = err as ForbiddenError;
        expect(forbiddenErr.statusCode).toBe(403);
        expect(forbiddenErr.code).toBe("FORBIDDEN_OWNERSHIP");
        expect(forbiddenErr.message).toContain("el recurso pertenece a otro donante");
      }
    });

    it("extractDonorSub garantiza que el donorSub se obtiene directamente del token", () => {
      const ctx = createMockAuthContext({ sub: "sub-seguro-extraido-de-cognito" });
      const donorSub = extractDonorSub(ctx);
      expect(donorSub).toBe("sub-seguro-extraido-de-cognito");
    });
  });
});

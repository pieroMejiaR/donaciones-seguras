import { DynamoDBDocumentClient, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handler as createDonation } from "../handlers/createDonation.js";
import { apiEvent, bodyOf, DONANTE, GESTOR } from "../test-utils/events.js";
import { extractAuthContext } from "./authorizer.js";
import { assertOwnership, extractDonorSub, requireRole } from "./authz.js";
import { ForbiddenError } from "./errors.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const DONANTE_A = {
  claims: {
    sub: "aaaaaaaa-1111-4111-8111-111111111111",
    token_use: "access",
    "cognito:groups": "[DONANTE]",
  },
  scopes: ["api/donations.*"],
};

const DONANTE_B = {
  claims: {
    sub: "bbbbbbbb-2222-4222-8222-222222222222",
    token_use: "access",
    "cognito:groups": "[DONANTE]",
  },
  scopes: ["api/donations.*"],
};

const AUDITOR = {
  claims: {
    sub: "cccccccc-3333-4333-8333-333333333333",
    token_use: "access",
    "cognito:groups": "[AUDITOR]",
  },
  scopes: ["api/audit.read"],
};

beforeEach(() => {
  ddbMock.reset();
  process.env.PROJECTS_TABLE = "projects-test";
  process.env.DONATIONS_TABLE = "donations-test";
  process.env.IDEMPOTENCY_TABLE = "idempotency-test";
  process.env.AUDIT_TABLE = "audit-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("Ownership por sub y aislamiento entre roles (Día 4: T09, T12)", () => {
  describe("Prueba T09: Verificación de Ownership por sub contra recurso persistido (HU-04, CA-07.2)", () => {
    it("rechaza con 403 (FORBIDDEN_OWNERSHIP) cuando un DONANTE intenta operar la donación de otro", () => {
      const donanteACtx = extractAuthContext(
        apiEvent({ routeKey: "POST /v1/donations/d-1/simulate", user: DONANTE_A }),
      );
      const donanteBCtx = extractAuthContext(
        apiEvent({ routeKey: "POST /v1/donations/d-1/simulate", user: DONANTE_B }),
      );

      // Recurso persistido en DynamoDB cuyo propietario es Donante A
      const persistedDonation = {
        donationId: "d-1",
        donorSub: extractDonorSub(donanteACtx),
        amountCents: 5000,
      };

      // Donante A (propietario) pasa la verificación
      expect(() => assertOwnership(donanteACtx, persistedDonation.donorSub)).not.toThrow();

      // Donante B (no propietario) es rechazado con 403 FORBIDDEN_OWNERSHIP
      expect(() => assertOwnership(donanteBCtx, persistedDonation.donorSub)).toThrow(ForbiddenError);
      try {
        assertOwnership(donanteBCtx, persistedDonation.donorSub);
      } catch (err) {
        const forbidden = err as ForbiddenError;
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.code).toBe("FORBIDDEN_OWNERSHIP");
        expect(forbidden.message).toContain("otro donante");
      }
    });

    it("ignora parámetros ?donorSub= o intentos de suplantación y extrae la identidad solo del token (CA-07.2)", () => {
      const event = apiEvent({
        routeKey: "GET /v1/donations/me",
        headers: {},
        user: DONANTE_B,
      });
      // Simula query string malicioso ?donorSub=<sub_de_donante_A>
      event.rawQueryString = `donorSub=${DONANTE_A.claims.sub}`;
      event.queryStringParameters = { donorSub: DONANTE_A.claims.sub };

      const ctx = extractAuthContext(event);
      const resolvedDonorSub = extractDonorSub(ctx);

      expect(resolvedDonorSub).toBe(DONANTE_B.claims.sub);
      expect(resolvedDonorSub).not.toBe(DONANTE_A.claims.sub);
    });
  });

  describe("Prueba T12: Aislamiento entre roles en flujos exclusivos de DONANTE (CA-04.2)", () => {
    it("un GESTOR llamando directamente a POST /v1/donations recibe 403 y no escribe en DynamoDB", async () => {
      ddbMock.on(PutCommand).resolves({});

      const response = await createDonation(
        apiEvent({
          routeKey: "POST /v1/donations",
          headers: { "idempotency-key": "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b" },
          body: { projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", amountCents: 2500 },
          user: GESTOR,
        }),
      );

      expect(response.statusCode).toBe(403);
      expect(bodyOf(response)).toMatchObject({ code: "INSUFFICIENT_SCOPE" });
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("un GESTOR incluso con el scope api/donations.* recibe 403 (FORBIDDEN_ROLE) por no tener rol DONANTE", async () => {
      ddbMock.on(PutCommand).resolves({});

      const gestorConScopeDeDonante = {
        claims: GESTOR.claims,
        scopes: ["api/donations.*"],
      };

      const response = await createDonation(
        apiEvent({
          routeKey: "POST /v1/donations",
          headers: { "idempotency-key": "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b" },
          body: { projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", amountCents: 2500 },
          user: gestorConScopeDeDonante,
        }),
      );

      expect(response.statusCode).toBe(403);
      expect(bodyOf(response)).toMatchObject({
        code: "FORBIDDEN_ROLE",
        message: "Acceso denegado: se requiere el rol DONANTE",
      });
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("un AUDITOR intentando acceder a ruta de DONANTE (GET /v1/donations/me) recibe 403 (FORBIDDEN_ROLE)", () => {
      const auditorCtx = extractAuthContext(
        apiEvent({ routeKey: "GET /v1/donations/me", user: AUDITOR }),
      );

      expect(() => requireRole(auditorCtx, "DONANTE")).toThrow(ForbiddenError);
      try {
        requireRole(auditorCtx, "DONANTE");
      } catch (err) {
        const forbidden = err as ForbiddenError;
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.code).toBe("FORBIDDEN_ROLE");
      }
    });

    it("un DONANTE legítimo sí puede validar ownership cuando coincide el sub", () => {
      const ctx = extractAuthContext(
        apiEvent({ routeKey: "GET /v1/donations/me", user: DONANTE }),
      );
      expect(() => requireRole(ctx, "DONANTE")).not.toThrow();
      expect(() => assertOwnership(ctx, DONANTE.claims.sub)).not.toThrow();
    });
  });
});

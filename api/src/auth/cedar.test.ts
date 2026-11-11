import { IsAuthorizedCommand, VerifiedPermissionsClient } from "@aws-sdk/client-verifiedpermissions";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { apiEvent, DONANTE, GESTOR } from "../test-utils/events.js";
import { extractAuthContext } from "./authorizer.js";
import {
  authorizeWithCedar,
  buildIsAuthorizedInput,
  evaluateCedarPoliciesLocally,
} from "./cedar.js";
import { ForbiddenError } from "./errors.js";

const avpMock = mockClient(VerifiedPermissionsClient);
const POLICY_STORE_ID = "ps-donaciones-test-001";

const DONANTE_A = extractAuthContext(
  apiEvent({
    routeKey: "POST /v1/donations",
    user: {
      claims: {
        sub: "donante-aaa-111",
        token_use: "access",
        "cognito:groups": "[DONANTE]",
      },
      scopes: ["api/donations.*"],
    },
  }),
);

const DONANTE_B = extractAuthContext(
  apiEvent({
    routeKey: "POST /v1/donations",
    user: {
      claims: {
        sub: "donante-bbb-222",
        token_use: "access",
        "cognito:groups": "[DONANTE]",
      },
      scopes: ["api/donations.*"],
    },
  }),
);

const GESTOR_CTX = extractAuthContext(apiEvent({ routeKey: "POST /v1/projects", user: GESTOR }));
const DONANTE_CTX = extractAuthContext(apiEvent({ routeKey: "POST /v1/donations", user: DONANTE }));

beforeEach(() => {
  avpMock.reset();
});

describe("HU-12 (Opcional): Autorización Externalizada con Amazon Verified Permissions + Cedar", () => {
  describe("Repetición T03 con Cedar: RBAC en creación y publicación de proyectos (HU-08)", () => {
    it("deniega con 403 (CEDAR_DENIED) cuando un DONANTE llama a createProject", async () => {
      const request = {
        action: "createProject" as const,
        resource: { type: "Project" as const, id: "proj-new", status: "BORRADOR" },
      };

      // Equivalencia en evaluador Cedar local
      expect(evaluateCedarPoliciesLocally(DONANTE_CTX, request)).toBe("DENY");

      // Invocación IsAuthorized hacia Amazon Verified Permissions
      avpMock.on(IsAuthorizedCommand).resolves({
        decision: "DENY",
        determiningPolicies: [],
        errors: [],
      });

      const client = new VerifiedPermissionsClient({ region: "us-east-2" });
      await expect(authorizeWithCedar(client, POLICY_STORE_ID, DONANTE_CTX, request)).rejects.toThrow(
        ForbiddenError,
      );

      const input = buildIsAuthorizedInput(POLICY_STORE_ID, DONANTE_CTX, request);
      expect(input.principal).toEqual({
        entityType: "DonacionesSeguras::User",
        entityId: DONANTE_CTX.sub,
      });
      expect(input.action).toEqual({
        actionType: "DonacionesSeguras::Action",
        actionId: "createProject",
      });
    });

    it("permite (ALLOW) cuando un GESTOR con scope api/projects.write llama a createProject / publishProject", async () => {
      const request = {
        action: "publishProject" as const,
        resource: { type: "Project" as const, id: "proj-1", status: "BORRADOR" },
      };

      expect(evaluateCedarPoliciesLocally(GESTOR_CTX, request)).toBe("ALLOW");

      avpMock.on(IsAuthorizedCommand).resolves({
        decision: "ALLOW",
        determiningPolicies: [{ policyId: "policy-hu08-gestor-projects" }],
      });

      const client = new VerifiedPermissionsClient({ region: "us-east-2" });
      const res = await authorizeWithCedar(client, POLICY_STORE_ID, GESTOR_CTX, request);
      expect(res).toEqual({
        decision: "ALLOW",
        determiningPolicies: ["policy-hu08-gestor-projects"],
      });
    });
  });

  describe("Repetición T09 con Cedar: Ownership por sub sobre donación ajena (HU-04, CA-07.2)", () => {
    it("deniega (DENY) cuando DONANTE B intenta simular una donación propiedad de DONANTE A", async () => {
      const request = {
        action: "simulateDonation" as const,
        stage: "academic",
        resource: {
          type: "Donation" as const,
          id: "don-de-A",
          ownerSub: DONANTE_A.sub,
          status: "PENDIENTE_SIMULACION",
        },
      };

      // Regla forbid explícita: resource.ownerSub != principal.sub
      expect(evaluateCedarPoliciesLocally(DONANTE_B, request)).toBe("DENY");

      avpMock.on(IsAuthorizedCommand).resolves({
        decision: "DENY",
        determiningPolicies: [{ policyId: "policy-forbid-non-owner" }],
      });

      const client = new VerifiedPermissionsClient({ region: "us-east-2" });
      await expect(authorizeWithCedar(client, POLICY_STORE_ID, DONANTE_B, request)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("permite (ALLOW) cuando DONANTE A simula su propia donación en stage academic", async () => {
      const request = {
        action: "simulateDonation" as const,
        stage: "academic",
        resource: {
          type: "Donation" as const,
          id: "don-de-A",
          ownerSub: DONANTE_A.sub,
          status: "PENDIENTE_SIMULACION",
        },
      };

      expect(evaluateCedarPoliciesLocally(DONANTE_A, request)).toBe("ALLOW");

      avpMock.on(IsAuthorizedCommand).resolves({
        decision: "ALLOW",
        determiningPolicies: [{ policyId: "policy-hu04-simulate-owner" }],
      });

      const client = new VerifiedPermissionsClient({ region: "us-east-2" });
      const res = await authorizeWithCedar(client, POLICY_STORE_ID, DONANTE_A, request);
      expect(res.decision).toBe("ALLOW");
    });

    it("deniega (DENY) cuando DONANTE B intenta consultar historial pasando requestedOwnerSub de DONANTE A (HU-07)", () => {
      const request = {
        action: "listOwnDonations" as const,
        requestedOwnerSub: DONANTE_A.sub,
        resource: {
          type: "Donation" as const,
          id: "don-de-A",
          ownerSub: DONANTE_A.sub,
          status: "CONFIRMADA_SIMULADA",
        },
      };

      expect(evaluateCedarPoliciesLocally(DONANTE_B, request)).toBe("DENY");
    });
  });

  describe("Repetición T12 con Cedar: Aislamiento de roles en flujo de donaciones (HU-04, HU-07)", () => {
    it("deniega (DENY) cuando un GESTOR intenta crear una donación o listar historial de donaciones", async () => {
      const createRequest = {
        action: "createDonation" as const,
        resource: { type: "Project" as const, id: "proj-pub-1", status: "PUBLICADO" },
      };
      const listRequest = {
        action: "listOwnDonations" as const,
        requestedOwnerSub: GESTOR_CTX.sub,
        resource: {
          type: "Donation" as const,
          id: "don-1",
          ownerSub: GESTOR_CTX.sub,
          status: "CONFIRMADA_SIMULADA",
        },
      };

      expect(evaluateCedarPoliciesLocally(GESTOR_CTX, createRequest)).toBe("DENY");
      expect(evaluateCedarPoliciesLocally(GESTOR_CTX, listRequest)).toBe("DENY");

      avpMock.on(IsAuthorizedCommand).resolves({ decision: "DENY", determiningPolicies: [] });
      const client = new VerifiedPermissionsClient({ region: "us-east-2" });
      await expect(
        authorizeWithCedar(client, POLICY_STORE_ID, GESTOR_CTX, createRequest),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});

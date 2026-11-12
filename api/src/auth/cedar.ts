import {
  IsAuthorizedCommand,
  VerifiedPermissionsClient,
  type AttributeValue,
  type EntityItem,
  type IsAuthorizedCommandInput,
} from "@aws-sdk/client-verifiedpermissions";
import { ForbiddenError } from "./errors.js";
import type { AuthContext } from "./types.js";

export const CEDAR_NAMESPACE = "DonacionesSeguras";

export type CedarAction =
  | "createProject"
  | "publishProject"
  | "createDonation"
  | "listOwnDonations"
  | "simulateDonation";

export type CedarResource =
  | {
      type: "Project";
      id: string;
      status: string;
    }
  | {
      type: "Donation";
      id: string;
      ownerSub: string;
      status: string;
    };

export interface CedarAuthorizeRequest {
  action: CedarAction;
  resource: CedarResource;
  stage?: string;
  requestedOwnerSub?: string;
}

/**
 * Crea un cliente AWS SDK v3 para Amazon Verified Permissions.
 */
export function createVerifiedPermissionsClient(region = process.env.AWS_REGION ?? "us-east-2") {
  return new VerifiedPermissionsClient({ region });
}

function toStringSet(values: readonly string[]): AttributeValue {
  return {
    set: values.map((value) => ({ string: value })),
  };
}

/**
 * Construye el payload de solicitud IsAuthorized compatible con Amazon Verified Permissions
 * a partir del contexto JWT verificado (`AuthContext`) y el recurso evaluado.
 */
export function buildIsAuthorizedInput(
  policyStoreId: string,
  ctx: AuthContext,
  request: CedarAuthorizeRequest,
): IsAuthorizedCommandInput {
  const principalEntity = {
    entityType: `${CEDAR_NAMESPACE}::User`,
    entityId: ctx.sub,
  };

  const resourceEntity = {
    entityType: `${CEDAR_NAMESPACE}::${request.resource.type}`,
    entityId: request.resource.id,
  };

  const contextMap: Record<string, AttributeValue> = {
    hasValidAccessToken: { boolean: ctx.tokenUse === "access" },
    scopes: toStringSet(ctx.scopes),
  };

  if (request.action === "simulateDonation") {
    contextMap.stage = { string: request.stage ?? process.env.STAGE ?? "dev" };
  }

  if (request.action === "listOwnDonations") {
    contextMap.requestedOwnerSub = { string: request.requestedOwnerSub ?? ctx.sub };
  }

  const principalItem: EntityItem = {
    identifier: principalEntity,
    attributes: {
      sub: { string: ctx.sub },
      roles: toStringSet(ctx.roles),
      mfaVerified: { boolean: ctx.mfaVerified },
    },
  };

  const resourceAttributes: Record<string, AttributeValue> =
    request.resource.type === "Project"
      ? {
          projectId: { string: request.resource.id },
          status: { string: request.resource.status },
        }
      : {
          donationId: { string: request.resource.id },
          ownerSub: { string: request.resource.ownerSub },
          status: { string: request.resource.status },
        };

  const resourceItem: EntityItem = {
    identifier: resourceEntity,
    attributes: resourceAttributes,
  };

  return {
    policyStoreId,
    principal: principalEntity,
    action: {
      actionType: `${CEDAR_NAMESPACE}::Action`,
      actionId: request.action,
    },
    resource: resourceEntity,
    context: { contextMap },
    entities: {
      entityList: [principalItem, resourceItem],
    },
  };
}

/**
 * Externaliza la decision de autorizacion (PE) llamando a Amazon Verified Permissions `IsAuthorized` (HU-12).
 * Si la decision no es `ALLOW`, lanza ForbiddenError (403).
 */
export async function authorizeWithCedar(
  client: VerifiedPermissionsClient,
  policyStoreId: string,
  ctx: AuthContext,
  request: CedarAuthorizeRequest,
): Promise<{ decision: "ALLOW" | "DENY"; determiningPolicies: string[] }> {
  const input = buildIsAuthorizedInput(policyStoreId, ctx, request);
  const response = await client.send(new IsAuthorizedCommand(input));

  const determiningPolicies =
    response.determiningPolicies?.map((p) => p.policyId ?? "unknown") ?? [];

  if (response.decision !== "ALLOW") {
    throw new ForbiddenError(
      "CEDAR_DENIED",
      `Autorización externalizada denegada por política Cedar para la acción '${request.action}'`,
    );
  }

  return { decision: "ALLOW", determiningPolicies };
}

/**
 * Evaluador determinista equivalente a `docs/cedar/policies.cedar` para comparar localmente
 * las reglas de HU-04, HU-07 y HU-08 sin requerir despliegue de Policy Store en pruebas unitarias.
 */
export function evaluateCedarPoliciesLocally(
  ctx: AuthContext,
  request: CedarAuthorizeRequest,
): "ALLOW" | "DENY" {
  // 1. forbid unless context.hasValidAccessToken
  if (ctx.tokenUse !== "access") {
    return "DENY";
  }

  // 6. forbid when resource has ownerSub && resource.ownerSub != principal.sub
  if (
    request.resource.type === "Donation" &&
    request.resource.ownerSub !== ctx.sub
  ) {
    return "DENY";
  }

  const hasDonationScope =
    ctx.scopes.includes("api/donations.*") || ctx.scopes.includes("api/donations.create");
  const hasDonationReadScope =
    ctx.scopes.includes("api/donations.*") || ctx.scopes.includes("api/donations.read");

  switch (request.action) {
    case "createProject":
    case "publishProject":
      return ctx.roles.includes("GESTOR") && ctx.scopes.includes("api/projects.write")
        ? "ALLOW"
        : "DENY";

    case "createDonation":
      return ctx.roles.includes("DONANTE") && hasDonationScope ? "ALLOW" : "DENY";

    case "listOwnDonations": {
      const requestedOwnerSub = request.requestedOwnerSub ?? ctx.sub;
      return ctx.roles.includes("DONANTE") &&
        hasDonationReadScope &&
        request.resource.type === "Donation" &&
        ctx.sub === requestedOwnerSub &&
        ctx.sub === request.resource.ownerSub
        ? "ALLOW"
        : "DENY";
    }

    case "simulateDonation": {
      const stage = request.stage ?? process.env.STAGE ?? "dev";
      return ctx.roles.includes("DONANTE") &&
        hasDonationScope &&
        request.resource.type === "Donation" &&
        ctx.sub === request.resource.ownerSub &&
        stage === "academic"
        ? "ALLOW"
        : "DENY";
    }
  }
}

import { MFA_REQUIRED_ROLES } from "./authz.js";
import type { UserRole } from "./types.js";

/**
 * Evento simplificado del Trigger Pre-Token Generation V2.0 de AWS Cognito.
 * Permite propagar el estado de verificacion TOTP MFA hacia el Access Token y
 * bloquear la emision para GESTOR/AUDITOR cuando no han completado MFA (HU-11).
 */
export interface CognitoPreTokenV2Event {
  triggerSource: string;
  userName: string;
  request: {
    userAttributes: Record<string, string>;
    groupConfiguration?: {
      groupsToOverride?: string[];
    };
    scopes?: string[];
    /** Metodos de autenticacion reportados por Cognito durante la sesion */
    authenticationMethods?: string[];
  };
  response: {
    claimsAndScopeOverrideDetails?: {
      accessTokenGeneration?: {
        claimsToAddOrOverride?: Record<string, string>;
      };
      idTokenGeneration?: {
        claimsToAddOrOverride?: Record<string, string>;
      };
    };
  };
}

const SOFTWARE_TOKEN_INDICATORS = new Set([
  "SOFTWARE_TOKEN_MFA",
  "sw_token",
  "totp",
  "mfa",
]);

function hasTotpMfaCompleted(event: CognitoPreTokenV2Event): boolean {
  const attrs = event.request.userAttributes ?? {};
  const methods = event.request.authenticationMethods ?? [];

  if (methods.some((method) => SOFTWARE_TOKEN_INDICATORS.has(method))) {
    return true;
  }

  const preferredMfa = attrs["cognito:preferred_mfa_setting"] ?? attrs.preferred_mfa_setting;
  if (preferredMfa === "SOFTWARE_TOKEN_MFA") {
    return true;
  }

  return false;
}

/**
 * Handler del trigger Cognito Pre-Token Generation V2.0 (HU-11).
 * - Exige TOTP MFA activo para usuarios de los grupos GESTOR y AUDITOR.
 * - Propaga `mfa_verified: "true"` al Access Token (ya que Cognito por defecto
 *   solo incluye `amr` en el ID Token).
 */
export async function preTokenGenerationMfaHandler(
  event: CognitoPreTokenV2Event,
): Promise<CognitoPreTokenV2Event> {
  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];
  const requiresMfa = groups.some((group) => MFA_REQUIRED_ROLES.has(group as UserRole));
  const mfaCompleted = hasTotpMfaCompleted(event);

  if (requiresMfa && !mfaCompleted) {
    throw new Error(
      "MFA_REQUIRED: Los roles GESTOR y AUDITOR deben tener TOTP MFA configurado y verificado para iniciar sesión.",
    );
  }

  event.response.claimsAndScopeOverrideDetails = {
    ...event.response.claimsAndScopeOverrideDetails,
    accessTokenGeneration: {
      ...event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration,
      claimsToAddOrOverride: {
        ...event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
          ?.claimsToAddOrOverride,
        mfa_verified: mfaCompleted ? "true" : "false",
      },
    },
  };

  return event;
}

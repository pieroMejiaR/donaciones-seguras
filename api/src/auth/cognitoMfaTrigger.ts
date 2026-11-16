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
  userPoolId?: string;
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
 * Consulta a Cognito si el usuario tiene TOTP activado. El evento del trigger no informa qué
 * factores se usaron, pero con TOTP activado Cognito siempre lo pide al iniciar sesión, así que
 * un usuario con TOTP activado solo obtiene tokens después de completar el segundo factor.
 */
export type TotpEnabledLookup = (userPoolId: string, userName: string) => Promise<boolean>;

/**
 * Handler del trigger Cognito Pre-Token Generation V2.0 (HU-11).
 * - Exige TOTP MFA activo para usuarios de los grupos GESTOR y AUDITOR: si no lo tienen, Cognito
 *   no emite los tokens.
 * - Propaga `mfa_verified` al Access Token (ya que Cognito por defecto solo incluye `amr` en el
 *   ID Token), que es lo que revisa requireRoleWithMfa en Lambda.
 */
export function createPreTokenGenerationMfaHandler(lookupTotpEnabled?: TotpEnabledLookup) {
  return async (event: CognitoPreTokenV2Event): Promise<CognitoPreTokenV2Event> => {
    const groups = event.request.groupConfiguration?.groupsToOverride ?? [];
    const requiresMfa = groups.some((group) => MFA_REQUIRED_ROLES.has(group as UserRole));
    let mfaCompleted = hasTotpMfaCompleted(event);

    // Solo los roles privilegiados consultan a Cognito: un DONANTE no depende de esta llamada.
    if (requiresMfa && !mfaCompleted && lookupTotpEnabled && event.userPoolId) {
      mfaCompleted = await lookupTotpEnabled(event.userPoolId, event.userName);
    }

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
  };
}

/** Versión sin consulta a Cognito: decide solo con los datos del evento. */
export const preTokenGenerationMfaHandler = createPreTokenGenerationMfaHandler();

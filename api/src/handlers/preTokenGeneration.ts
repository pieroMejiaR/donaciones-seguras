import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { createPreTokenGenerationMfaHandler } from "../auth/cognitoMfaTrigger.js";

const cognito = new CognitoIdentityProviderClient({});

/** true si el usuario tiene TOTP activado entre sus factores (HU-11). */
export async function totpEnabled(userPoolId: string, userName: string): Promise<boolean> {
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: userName }),
  );
  return (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
}

/**
 * Trigger Pre-Token Generation V2.0 del User Pool (infra/cognito-authorizer.yaml). No tiene ruta
 * en el API: lo invoca Cognito antes de emitir cada token.
 */
export const handler = createPreTokenGenerationMfaHandler(totpEnabled);

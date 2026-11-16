import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { CognitoPreTokenV2Event } from "../auth/cognitoMfaTrigger.js";
import { handler } from "./preTokenGeneration.js";

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function triggerEvent(groups: string[]): CognitoPreTokenV2Event {
  return {
    triggerSource: "TokenGeneration_HostedAuth",
    userName: "11111111-1111-4111-8111-111111111111",
    userPoolId: "us-east-2_TESTPOOL",
    request: { userAttributes: { sub: "11111111-1111-4111-8111-111111111111" }, groupConfiguration: { groupsToOverride: groups } },
    response: {},
  };
}

function accessTokenClaims(event: CognitoPreTokenV2Event) {
  return event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride;
}

beforeEach(() => {
  cognitoMock.reset();
});

describe("Trigger Pre-Token Generation V2.0 (HU-11)", () => {
  it("T13: un GESTOR con TOTP activado recibe mfa_verified en el access token", async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({ UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] });

    const result = await handler(triggerEvent(["GESTOR"]));

    expect(accessTokenClaims(result)).toEqual({ mfa_verified: "true" });
    expect(cognitoMock.commandCalls(AdminGetUserCommand)[0]?.args[0].input).toEqual({
      UserPoolId: "us-east-2_TESTPOOL",
      Username: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("T13: un GESTOR sin TOTP activado no recibe tokens", async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({ UserMFASettingList: [] });

    await expect(handler(triggerEvent(["GESTOR"]))).rejects.toThrow(/MFA_REQUIRED/);
  });

  it("T14: un AUDITOR sin TOTP activado no recibe tokens", async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({});

    await expect(handler(triggerEvent(["AUDITOR"]))).rejects.toThrow(/MFA_REQUIRED/);
  });

  it("un DONANTE no depende de la consulta a Cognito", async () => {
    const result = await handler(triggerEvent(["DONANTE"]));

    expect(accessTokenClaims(result)).toEqual({ mfa_verified: "false" });
    expect(cognitoMock.commandCalls(AdminGetUserCommand)).toHaveLength(0);
  });
});

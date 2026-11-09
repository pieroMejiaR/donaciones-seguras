import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

const valid = {
  VITE_OIDC_AUTHORITY: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_prueba",
  VITE_OIDC_CLIENT_ID: "cliente",
  VITE_OIDC_DOMAIN: "https://prueba.auth.us-east-2.amazoncognito.com/",
  VITE_OIDC_SCOPE: "openid email",
  VITE_API_BASE_URL: "https://api.prueba.example/",
};

describe("readEnv", () => {
  it("acepta una configuración válida y normaliza la barra final", () => {
    const result = readEnv(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.oidcDomain).toBe("https://prueba.auth.us-east-2.amazoncognito.com");
      expect(result.env.apiBaseUrl).toBe("https://api.prueba.example");
    }
  });

  it("nombra las variables ausentes sin mostrar valores", () => {
    expect(readEnv({ VITE_OIDC_CLIENT_ID: "valor-sensible" })).toEqual({
      ok: false,
      invalid: [
        "VITE_OIDC_AUTHORITY",
        "VITE_OIDC_DOMAIN",
        "VITE_OIDC_SCOPE",
        "VITE_API_BASE_URL",
      ],
    });
  });

  it("CA-NF01.1: rechaza HTTP en Cognito y en un API que no sea localhost", () => {
    expect(readEnv({ ...valid, VITE_OIDC_DOMAIN: "http://prueba.example" })).toEqual({
      ok: false,
      invalid: ["VITE_OIDC_DOMAIN"],
    });
    expect(readEnv({ ...valid, VITE_API_BASE_URL: "http://api.prueba.example" })).toEqual({
      ok: false,
      invalid: ["VITE_API_BASE_URL"],
    });
    expect(readEnv({ ...valid, VITE_API_BASE_URL: "http://localhost:3000" }).ok).toBe(true);
    expect(readEnv({ ...valid, VITE_API_BASE_URL: "http://localhost.evil.example" }).ok).toBe(
      false,
    );
  });

  it("exige el scope openid", () => {
    expect(readEnv({ ...valid, VITE_OIDC_SCOPE: "email" })).toEqual({
      ok: false,
      invalid: ["VITE_OIDC_SCOPE"],
    });
  });
});

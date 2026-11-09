import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  browserStorageDump,
  makeUser,
  ORIGIN,
  stubCognito,
  stubLocation,
  testEnv,
  TOKENS,
} from "../test/fixtures";
import { createUserManager } from "./oidcConfig";
import { completeSignin, getRoles, getValidAccessToken, performLogout } from "./session";

/** Inicia el login real y devuelve la URL con la que la biblioteca redirige a Cognito. */
async function startSignin(returnTo = "/mis-donaciones") {
  const { assign } = stubLocation();
  const userManager = createUserManager(testEnv, ORIGIN);
  void userManager.signinRedirect({ state: { returnTo } });
  await waitFor(() => expect(assign).toHaveBeenCalledOnce());
  return { userManager, authorizeUrl: new URL(assign.mock.calls[0]![0]) };
}

function callbackUrlFor(authorizeUrl: URL) {
  const state = authorizeUrl.searchParams.get("state") ?? "";
  return `${ORIGIN}/callback?code=codigo-de-prueba&state=${state}`;
}

describe("flujo OIDC contra un Cognito simulado", () => {
  it("CA-03.1: usa Authorization Code con PKCE S256 y nunca el flujo implícito", async () => {
    stubCognito();
    const { authorizeUrl } = await startSignin();

    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      `${testEnv.oidcDomain}/oauth2/authorize`,
    );
    const params = authorizeUrl.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(params.get("client_id")).toBe(testEnv.oidcClientId);
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(params.get("scope")).toBe(testEnv.oidcScope);
  });

  it("CA-03.1: canjea el código con el code_verifier, sin secreto de cliente", async () => {
    const cognito = stubCognito();
    const { userManager, authorizeUrl } = await startSignin();

    await completeSignin(userManager, callbackUrlFor(authorizeUrl));

    const [tokenRequest] = cognito.requestsTo("/oauth2/token");
    expect(tokenRequest?.body.get("grant_type")).toBe("authorization_code");
    expect(tokenRequest?.body.get("code")).toBe("codigo-de-prueba");
    expect(tokenRequest?.body.get("code_verifier")).toBeTruthy();
    expect(tokenRequest?.body.has("client_secret")).toBe(false);
  });

  it("CA-NF11.1: tras el callback no quedan tokens ni code_verifier en el navegador", async () => {
    stubCognito({ groups: ["DONANTE"] });
    const { userManager, authorizeUrl } = await startSignin();

    expect(window.sessionStorage.length).toBeGreaterThan(0);
    await completeSignin(userManager, callbackUrlFor(authorizeUrl));

    const stored = browserStorageDump();
    expect(stored).not.toContain(TOKENS.access);
    expect(stored).not.toContain(TOKENS.refresh);
    expect(stored).not.toContain("code_verifier");
    expect(stored).not.toContain("eyJ");
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);

    // La sesión existe, pero solo en memoria.
    expect(await getValidAccessToken(userManager)).toBe(TOKENS.access);
    expect(getRoles(await userManager.getUser())).toEqual(["DONANTE"]);
  });

  it("devuelve la ruta original tras el login", async () => {
    stubCognito();
    const { userManager, authorizeUrl } = await startSignin("/gestor?filtro=activos");
    await expect(completeSignin(userManager, callbackUrlFor(authorizeUrl))).resolves.toBe(
      "/gestor?filtro=activos",
    );
  });

  it("descarta un returnTo externo guardado en el state", async () => {
    stubCognito();
    const { userManager, authorizeUrl } = await startSignin("https://malicioso.example");
    await expect(completeSignin(userManager, callbackUrlFor(authorizeUrl))).resolves.toBe("/");
  });

  it("procesar dos veces el callback canjea el código una sola vez", async () => {
    const cognito = stubCognito();
    const { userManager, authorizeUrl } = await startSignin();
    const url = callbackUrlFor(authorizeUrl);

    await Promise.all([completeSignin(userManager, url), completeSignin(userManager, url)]);

    expect(cognito.requestsTo("/oauth2/token")).toHaveLength(1);
  });

  it("rechaza un state desconocido y no crea sesión", async () => {
    const cognito = stubCognito();
    const { userManager } = await startSignin();

    await expect(
      completeSignin(userManager, `${ORIGIN}/callback?code=robado&state=desconocido`),
    ).rejects.toThrow();

    expect(cognito.requestsTo("/oauth2/token")).toHaveLength(0);
    expect(await userManager.getUser()).toBeNull();
  });
});

describe("cierre de sesión", () => {
  async function signedIn() {
    const { assign } = stubLocation();
    const userManager = createUserManager(testEnv, ORIGIN);
    await userManager.storeUser(makeUser(["DONANTE"]));
    return { assign, userManager };
  }

  function expectCognitoLogout(assign: ReturnType<typeof vi.fn>) {
    expect(assign).toHaveBeenCalledOnce();
    const logoutUrl = new URL(assign.mock.calls[0]![0] as string);
    expect(logoutUrl.origin + logoutUrl.pathname).toBe(`${testEnv.oidcDomain}/logout`);
    expect(logoutUrl.searchParams.get("client_id")).toBe(testEnv.oidcClientId);
    expect(logoutUrl.searchParams.get("logout_uri")).toBe(ORIGIN);
  }

  it("CA-03.3: revoca solo el refresh token, borra la memoria y cierra la sesión de Cognito", async () => {
    const cognito = stubCognito();
    const { assign, userManager } = await signedIn();

    await performLogout(userManager, testEnv);

    const revocations = cognito.requestsTo("/oauth2/revoke");
    expect(revocations).toHaveLength(1);
    expect(revocations[0]?.body.get("token")).toBe(TOKENS.refresh);
    expect(revocations[0]?.body.get("client_id")).toBe(testEnv.oidcClientId);
    expect(await userManager.getUser()).toBeNull();
    expectCognitoLogout(assign);
  });

  it("CA-03.3: borra la memoria y sale aunque la revocación falle, sin registrar el token", async () => {
    stubCognito({ revokeFails: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { assign, userManager } = await signedIn();

    await performLogout(userManager, testEnv);

    expect(await userManager.getUser()).toBeNull();
    expectCognitoLogout(assign);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKENS.refresh);
  });
});

describe("getValidAccessToken", () => {
  it("devuelve null sin sesión o con el token expirado", async () => {
    const userManager = createUserManager(testEnv, ORIGIN);
    expect(await getValidAccessToken(userManager)).toBeNull();

    await userManager.storeUser(makeUser([], -10));
    expect(await getValidAccessToken(userManager)).toBeNull();
  });
});

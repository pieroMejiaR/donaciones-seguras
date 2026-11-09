import { render } from "@testing-library/react";
import axe from "axe-core";
import { User } from "oidc-client-ts";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { AppProviders } from "../app/providers";
import { routes } from "../app/router";
import { createAppServices } from "../app/services";
import type { UserRole } from "../auth/session";
import type { Env } from "../config/env";

export const ORIGIN = "http://localhost:5173";

export const testEnv: Env = {
  oidcAuthority: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_prueba",
  oidcClientId: "cliente-de-prueba",
  oidcDomain: "https://prueba.auth.us-east-2.amazoncognito.com",
  oidcScope: "openid email api/donations.write",
  apiBaseUrl: "https://api.prueba.example",
};

export const TOKENS = {
  access: "access-token-de-prueba",
  refresh: "refresh-token-de-prueba",
};

/** JWT sin firma válida: el cliente OIDC no verifica firmas, eso lo hace API Gateway. */
export function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode(claims)}.firma`;
}

export function idTokenFor(groups: UserRole[] = []): string {
  const now = Math.floor(Date.now() / 1000);
  return fakeJwt({
    sub: "usuario-de-prueba",
    iss: testEnv.oidcAuthority,
    aud: testEnv.oidcClientId,
    iat: now,
    exp: now + 3600,
    "cognito:groups": groups,
  });
}

export function makeUser(groups: UserRole[] = [], expiresInSeconds = 900): User {
  const now = Math.floor(Date.now() / 1000);
  return new User({
    access_token: TOKENS.access,
    refresh_token: TOKENS.refresh,
    id_token: idTokenFor(groups),
    token_type: "Bearer",
    scope: testEnv.oidcScope,
    expires_at: now + expiresInSeconds,
    profile: {
      sub: "usuario-de-prueba",
      iss: testEnv.oidcAuthority,
      aud: testEnv.oidcClientId,
      iat: now,
      exp: now + 3600,
      "cognito:groups": groups,
    },
  });
}

interface FakeCognitoOptions {
  groups?: UserRole[];
  revokeFails?: boolean;
  discoveryFails?: boolean;
}

/** Simula solo la red de Cognito: la biblioteca OIDC se ejecuta real en las pruebas. */
export function stubCognito({
  groups = [],
  revokeFails = false,
  discoveryFails = false,
}: FakeCognitoOptions = {}) {
  const requests: { url: string; body: URLSearchParams }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    requests.push({ url, body: new URLSearchParams(init?.body?.toString() ?? "") });

    if (url.endsWith("/.well-known/openid-configuration")) {
      if (discoveryFails) {
        throw new TypeError("Failed to fetch");
      }
      return Response.json({
        issuer: testEnv.oidcAuthority,
        authorization_endpoint: `${testEnv.oidcDomain}/oauth2/authorize`,
        token_endpoint: `${testEnv.oidcDomain}/oauth2/token`,
        jwks_uri: `${testEnv.oidcAuthority}/.well-known/jwks.json`,
      });
    }
    if (url.endsWith("/oauth2/token")) {
      return Response.json({
        access_token: TOKENS.access,
        refresh_token: TOKENS.refresh,
        id_token: idTokenFor(groups),
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    if (url.endsWith("/oauth2/revoke")) {
      return revokeFails
        ? Response.json({ error: "invalid_request" }, { status: 400 })
        : new Response(null, { status: 200 });
    }
    throw new Error(`Solicitud no esperada: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    requests,
    requestsTo: (path: string) => requests.filter(({ url }) => url.endsWith(path)),
  };
}

/** jsdom no permite navegar; se sustituye `location` para capturar las redirecciones. */
export function stubLocation() {
  const assign = vi.fn<(url: string) => void>();
  const replace = vi.fn<(url: string) => void>();
  vi.stubGlobal("location", {
    origin: ORIGIN,
    href: `${ORIGIN}/`,
    protocol: "http:",
    host: "localhost:5173",
    hostname: "localhost",
    pathname: "/",
    search: "",
    hash: "",
    assign,
    replace,
  });
  return { assign, replace };
}

/** Texto completo de ambos almacenes del navegador, para buscar tokens filtrados. */
export function browserStorageDump(): string {
  const dump = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return `${key}=${storage.getItem(key) ?? ""}`;
    }).join("\n");
  return `${dump(window.localStorage)}\n${dump(window.sessionStorage)}`;
}

export async function renderApp(path: string, { user = null }: { user?: User | null } = {}) {
  const services = createAppServices(testEnv);
  if (user) {
    await services.userManager.storeUser(user);
  }
  const clearCache = vi.spyOn(services.queryClient, "clear");
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders services={services}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { userManager: services.userManager, router, clearCache };
}

/** jsdom no calcula diseño, así que la regla de contraste se revisa en el navegador. */
export async function axeViolations(container: Element = document.body): Promise<string[]> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((violation) => violation.id);
}

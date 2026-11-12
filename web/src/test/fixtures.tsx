import { render } from "@testing-library/react";
import axe from "axe-core";
import { User } from "oidc-client-ts";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { AppProviders } from "../app/providers";
import { routes } from "../app/router";
import { createAppServices } from "../app/services";
import type { UserRole } from "../auth/session";
import { idTokenFor, ORIGIN, testEnv, TOKENS } from "./network";

export {
  fakeJwt,
  idTokenFor,
  makeDonation,
  makeProject,
  ORIGIN,
  stubNetwork,
  testEnv,
  TOKENS,
  type FakeDonation,
  type FakeProject,
} from "./network";

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
  // Sin reintentos en las pruebas: un error debe verse de inmediato, sin esperas.
  services.queryClient.setDefaultOptions({
    queries: { ...services.queryClient.getDefaultOptions().queries, retry: false },
  });
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

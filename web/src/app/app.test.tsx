import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ConfigErrorPage } from "../pages/ConfigErrorPage";
import {
  axeViolations,
  makeUser,
  renderApp,
  stubCognito,
  stubLocation,
  testEnv,
  TOKENS,
} from "../test/fixtures";
import { AppProviders } from "./providers";
import { routes } from "./router";
import { createAppServices } from "./services";

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });

describe("RNF-HU-06: estructura accesible", () => {
  it("CA-NF06.2: la página de inicio no tiene violaciones de axe", async () => {
    await renderApp("/");
    await heading(/Proyectos sociales/);
    expect(await axeViolations()).toEqual([]);
  });

  it.each([
    ["/ruta-inexistente", "Página no encontrada"],
    ["/403", "No tienes acceso a esta sección"],
  ])("CA-NF06.2: %s no tiene violaciones de axe", async (path, title) => {
    await renderApp(path);
    await heading(title);
    expect(await axeViolations()).toEqual([]);
  });

  it("CA-NF06.2: una página protegida con sesión no tiene violaciones de axe", async () => {
    await renderApp("/mis-donaciones", { user: makeUser(["DONANTE"]) });
    await heading("Mis donaciones");
    expect(await axeViolations()).toEqual([]);
  });

  it("CA-NF06.2: la pantalla de configuración incompleta no tiene violaciones de axe", async () => {
    render(<ConfigErrorPage invalid={["VITE_OIDC_AUTHORITY"]} />);
    await heading("Falta configurar la aplicación");
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_OIDC_AUTHORITY");
    expect(await axeViolations()).toEqual([]);
  });

  it("expone los landmarks y el aviso de prototipo académico (CA-NF10.2)", async () => {
    await renderApp("/");
    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/Prototipo académico/);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/Ley N\.º 29733/);
  });

  it("el enlace de salto es lo primero con Tab y lleva el foco al contenido", async () => {
    const user = userEvent.setup();
    await renderApp("/");
    await heading(/Proyectos sociales/);

    await user.tab();
    const skipLink = screen.getByRole("link", { name: "Saltar al contenido principal" });
    expect(skipLink).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("al cambiar de ruta el foco va al h1 y se actualiza el título del documento", async () => {
    const { router } = await renderApp("/");
    await heading(/Proyectos sociales/);

    await act(() => router.navigate("/403"));

    expect(await heading("No tienes acceso a esta sección")).toHaveFocus();
    expect(document.title).toBe("No tienes acceso a esta sección · Donaciones Seguras");
  });

  it("marca el enlace activo con aria-current", async () => {
    await renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Inicio" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("guards de ruta (solo experiencia de uso)", () => {
  it("HU-03: sin sesión, una ruta protegida redirige a Cognito conservando el destino", async () => {
    stubCognito();
    const { assign } = stubLocation();
    await renderApp("/mis-donaciones?pagina=2");

    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    const authorizeUrl = new URL(assign.mock.calls[0]![0]);
    expect(authorizeUrl.pathname).toBe("/oauth2/authorize");
    expect(screen.queryByRole("heading", { name: "Mis donaciones" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Redirigiendo a inicio de sesión");

    const storedState = window.sessionStorage.getItem(
      `oidc.${authorizeUrl.searchParams.get("state")}`,
    );
    expect(storedState).toContain("/mis-donaciones?pagina=2");
  });

  it("en StrictMode redirige una sola vez", async () => {
    stubCognito();
    const { assign } = stubLocation();
    const services = createAppServices(testEnv);
    const signinRedirect = vi.spyOn(services.userManager, "signinRedirect");
    render(
      <StrictMode>
        <AppProviders services={services}>
          <RouterProvider
            router={createMemoryRouter(routes, { initialEntries: ["/mis-donaciones"] })}
          />
        </AppProviders>
      </StrictMode>,
    );

    await waitFor(() => expect(assign).toHaveBeenCalled());
    // Se cuentan las llamadas a la biblioteca: `assign` llega de forma asíncrona.
    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it("CA-04.1: un rol sin permiso ve la página 403", async () => {
    await renderApp("/gestor", { user: makeUser(["DONANTE"]) });
    await heading("No tienes acceso a esta sección");
    expect(screen.queryByRole("heading", { name: "Panel del gestor" })).not.toBeInTheDocument();
  });

  it("CA-04.2: un gestor no ve la pantalla de historial", async () => {
    await renderApp("/mis-donaciones", { user: makeUser(["GESTOR"]) });
    await heading("No tienes acceso a esta sección");
  });

  it("un usuario sin grupo no accede a pantallas con rol", async () => {
    await renderApp("/mis-donaciones", { user: makeUser([]) });
    await heading("No tienes acceso a esta sección");
  });

  it("el rol correcto ve la página y su enlace de navegación", async () => {
    await renderApp("/gestor", { user: makeUser(["GESTOR"]) });
    await heading("Panel del gestor");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Panel del gestor" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Mis donaciones" })).not.toBeInTheDocument();
  });

  it("un visitante navega por las páginas públicas sin ir a Cognito", async () => {
    stubCognito();
    const { assign } = stubLocation();
    await renderApp("/");
    await heading(/Proyectos sociales/);
    expect(await screen.findByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("sesión en la interfaz", () => {
  it("HU-03: el botón de inicio de sesión redirige a Cognito", async () => {
    stubCognito();
    const { assign } = stubLocation();
    const user = userEvent.setup();
    await renderApp("/");

    await user.click(await screen.findByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(new URL(assign.mock.calls[0]![0]).origin).toBe(testEnv.oidcDomain);
  });

  it("muestra un aviso, sin bucle de redirecciones, si Cognito no responde", async () => {
    stubCognito({ discoveryFails: true });
    const { assign } = stubLocation();
    await renderApp("/mis-donaciones");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo contactar con el servicio de identidad",
    );
    await heading("Inicia sesión para continuar");
    expect(assign).not.toHaveBeenCalled();
  });

  it("reintentar tras un fallo inicia un solo flujo aunque el guard se reactive", async () => {
    stubCognito({ discoveryFails: true });
    stubLocation();
    const user = userEvent.setup();
    const { userManager } = await renderApp("/mis-donaciones");
    await heading("Inicia sesión para continuar");
    const signinRedirect = vi.spyOn(userManager, "signinRedirect");

    const retryButtons = screen.getAllByRole("button", { name: "Iniciar sesión" });
    await user.click(retryButtons[retryButtons.length - 1]!);

    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it("CA-03.3: cerrar sesión revoca, limpia la caché y no vuelve a iniciar el login", async () => {
    const cognito = stubCognito();
    const { assign } = stubLocation();
    const user = userEvent.setup();
    const { userManager, clearCache } = await renderApp("/mis-donaciones", {
      user: makeUser(["DONANTE"]),
    });
    await heading("Mis donaciones");

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(cognito.requestsTo("/oauth2/revoke")[0]?.body.get("token")).toBe(TOKENS.refresh);
    expect(await userManager.getUser()).toBeNull();
    expect(clearCache).toHaveBeenCalled();
    // La única redirección es a /logout: el guard no dispara un login durante el cierre.
    expect(assign).toHaveBeenCalledOnce();
    expect(new URL(assign.mock.calls[0]![0] as string).pathname).toBe("/logout");
  });

  it("si la sesión expira avisa, limpia la caché y deja al usuario iniciar sesión", async () => {
    const { assign } = stubLocation();
    stubCognito();
    const { userManager, clearCache } = await renderApp("/mis-donaciones", {
      user: makeUser(["DONANTE"]),
    });
    await heading("Mis donaciones");

    await act(async () => {
      await userManager.events._raiseSilentRenewError(new Error("refresh token revocado"));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Tu sesión expiró");
    await heading("Inicia sesión para continuar");
    expect(await userManager.getUser()).toBeNull();
    expect(clearCache).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("CallbackPage", () => {
  it("un callback sin respuesta válida muestra un error y limpia la URL", async () => {
    const { router } = await renderApp("/callback?code=robado&state=desconocido");

    await heading("No se pudo iniciar sesión");
    expect(screen.getByRole("alert")).toHaveTextContent("no es válida");
    expect(screen.getByRole("alert")).not.toHaveTextContent("robado");
    expect(router.state.location.search).toBe("");
    expect(await axeViolations()).toEqual([]);
  });

  it("un error devuelto por Cognito no refleja su descripción en pantalla", async () => {
    await renderApp("/callback?error=access_denied&error_description=detalle-interno");
    await heading("No se pudo iniciar sesión");
    expect(document.body).not.toHaveTextContent("detalle-interno");
  });

  it("HU-03: un callback válido inicia sesión y vuelve a la ruta original", async () => {
    stubCognito({ groups: ["DONANTE"] });
    const { assign } = stubLocation();
    const services = createAppServices(testEnv);
    void services.userManager.signinRedirect({ state: { returnTo: "/mis-donaciones" } });
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    const state = new URL(assign.mock.calls[0]![0]).searchParams.get("state") ?? "";

    const router = createMemoryRouter(routes, {
      initialEntries: [`/callback?code=codigo&state=${state}`],
    });
    render(
      <StrictMode>
        <AppProviders services={services}>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    );

    expect(await heading("Mis donaciones")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/mis-donaciones");
    expect(router.state.location.search).toBe("");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });
});

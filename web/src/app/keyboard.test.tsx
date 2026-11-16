import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  axeViolations,
  makeDonation,
  makeProject,
  makeUser,
  renderApp,
  stubNetwork,
  testEnv,
} from "../test/fixtures";
import { AppProviders } from "./providers";
import { routes } from "./router";
import { createAppServices } from "./services";

/**
 * WCAG 2.1.1 (teclado) y 2.4.3 (orden del foco): los flujos principales se completan solo con
 * Tab, Mayús+Tab, Enter y Espacio, sin ratón. Cada paso comprueba además a dónde va el foco
 * cuando el contenido cambia, que es lo que percibe quien usa un lector de pantalla.
 */

type User = ReturnType<typeof userEvent.setup>;

const MAX_TABS = 40;

/** Pulsa Tab hasta que el foco llegue al elemento; falla si no es alcanzable con el teclado. */
async function tabTo(user: User, find: () => HTMLElement, { backwards = false } = {}) {
  for (let presses = 0; presses < MAX_TABS; presses++) {
    const target = find();
    if (document.activeElement === target) {
      return target;
    }
    await user.tab({ shift: backwards });
  }
  throw new Error(`No se alcanzó el elemento con ${MAX_TABS} pulsaciones de Tab`);
}

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const focused = () => document.activeElement as HTMLElement;

describe("RNF-HU-06: flujos completos solo con teclado (WCAG 2.1.1, 2.4.3)", () => {
  it("HU-05 y HU-06: un donante va del detalle a la donación y la simula sin ratón", async () => {
    const project = makeProject({ title: "Comedor Puentes", confirmedAmountCents: 0 });
    const network = stubNetwork({ projects: [project] });
    const user = userEvent.setup();
    await renderApp(`/proyectos/${project.projectId}`, { user: makeUser(["DONANTE"]) });
    await heading("Comedor Puentes");

    // Detalle → formulario.
    await tabTo(user, () => screen.getByRole("link", { name: "Donar a este proyecto" }));
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await heading("Donar a Comedor Puentes")).toHaveFocus());

    // El campo del monto es lo siguiente tras el título; Enter envía el formulario.
    await user.tab();
    expect(focused()).toBe(screen.getByRole("textbox", { name: /Monto a donar/ }));
    await user.keyboard("25.50{Enter}");

    const receipt = await screen.findByRole("region", { name: "Intención de donación registrada" });
    await waitFor(() =>
      expect(within(receipt).getByRole("heading", { level: 2 })).toHaveFocus(),
    );
    expect(network.donations()).toHaveLength(1);

    // Simular confirmación: el foco pasa a la pregunta y luego al resultado.
    await tabTo(user, () => within(receipt).getByRole("button", { name: "Simular confirmación" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(focused()).toHaveTextContent(/¿Confirmar la donación simulada/));

    await user.tab();
    expect(focused()).toBe(within(receipt).getByRole("button", { name: "Sí, confirmar" }));
    await user.keyboard(" ");

    await waitFor(() =>
      expect(focused()).toHaveTextContent("Donación confirmada (simulada)"),
    );
    expect(focused()).toHaveAttribute("role", "status");
    expect(network.donations()[0]?.status).toBe("CONFIRMADA_SIMULADA");
  });

  it("HU-06: Cancelar con el teclado devuelve el foco al botón elegido", async () => {
    const project = makeProject({ title: "Comedor Puentes" });
    stubNetwork({
      projects: [project],
      donations: [makeDonation({ projectId: project.projectId, projectTitle: project.title })],
    });
    const user = userEvent.setup();
    await renderApp("/mis-donaciones", { user: makeUser(["DONANTE"]) });
    const list = await screen.findByRole("list", { name: "Historial de donaciones" });

    const reject = await tabTo(user, () =>
      within(list).getByRole("button", { name: "Simular rechazo" }),
    );
    await user.keyboard("{Enter}");
    await waitFor(() => expect(focused()).toHaveTextContent(/¿Rechazar la donación simulada/));

    await tabTo(user, () => within(list).getByRole("button", { name: "Cancelar" }));
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(within(list).getByRole("button", { name: "Simular rechazo" })).toHaveFocus(),
    );
    expect(reject).not.toBeInTheDocument();
  });

  it("HU-08: un gestor crea y publica un proyecto sin ratón", async () => {
    const network = stubNetwork();
    const user = userEvent.setup();
    await renderApp("/gestor", { user: makeUser(["GESTOR"]) });
    await heading("Panel del gestor");

    // Los campos siguen el orden visual: título, descripción y meta.
    await tabTo(user, () => screen.getByLabelText("Título"));
    await user.keyboard("Botiquín rural");
    await user.tab();
    expect(focused()).toBe(screen.getByLabelText("Descripción"));
    await user.keyboard("Medicinas básicas para 3 postas");
    await user.tab();
    expect(focused()).toBe(screen.getByLabelText("Meta en soles (PEN)"));
    await user.keyboard("15000{Enter}");

    await waitFor(() => expect(focused()).toHaveTextContent(/Borrador «Botiquín rural» creado/));

    const list = await screen.findByRole("list", { name: "Proyectos de esta sesión" });
    await tabTo(user, () => within(list).getByRole("button", { name: "Publicar «Botiquín rural»" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(focused()).toHaveTextContent(/¿Publicar «Botiquín rural»\?/));

    await user.tab();
    expect(focused()).toBe(within(list).getByRole("button", { name: "Sí, publicar" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(focused()).toHaveTextContent(/Proyecto publicado/));
    expect(network.requests.filter(({ url }) => url.endsWith("/publish"))).toHaveLength(1);
  });

  it("CA-NF06.2: un error de validación lleva el foco al primer campo inválido", async () => {
    stubNetwork();
    const user = userEvent.setup();
    await renderApp("/gestor", { user: makeUser(["GESTOR"]) });
    await heading("Panel del gestor");

    // Solo se completa la descripción. En un textarea Enter es salto de línea, así que se envía
    // desde el botón.
    await tabTo(user, () => screen.getByLabelText("Descripción"));
    await user.keyboard("Medicinas básicas para 3 postas");
    await tabTo(user, () => screen.getByRole("button", { name: "Crear borrador" }));
    await user.keyboard("{Enter}");

    const title = screen.getByLabelText("Título");
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription(/caracteres/);
  });

  it("no hay trampas de foco: Mayús+Tab recorre la página hacia atrás hasta el inicio", async () => {
    stubNetwork({ projects: [makeProject({ title: "Comedor Puentes" })] });
    const user = userEvent.setup();
    await renderApp("/");
    await screen.findByRole("link", { name: "Comedor Puentes" });

    await tabTo(user, () => screen.getByRole("link", { name: "Comedor Puentes" }));
    await tabTo(user, () => screen.getByRole("link", { name: "Saltar al contenido principal" }), {
      backwards: true,
    });
  });
});

describe("RNF-HU-06: página de error inesperado", () => {
  it("CA-NF06.2: no muestra detalles técnicos y no tiene violaciones de axe", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error("detalle interno que no debe verse");
    }
    // La misma raíz de la app (Layout y errorElement) con una página que falla al renderizar.
    const [root] = routes;
    const router = createMemoryRouter([
      {
        element: root?.element,
        errorElement: root?.errorElement,
        children: [{ index: true, element: <Broken /> }],
      },
    ]);
    render(
      <AppProviders services={createAppServices(testEnv)}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await heading("Algo salió mal");
    expect(document.body).not.toHaveTextContent("detalle interno");
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(await axeViolations()).toEqual([]);
  });
});

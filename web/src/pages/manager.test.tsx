import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  axeViolations,
  makeProject,
  makeUser,
  renderApp,
  stubNetwork,
  testEnv,
  TOKENS,
} from "../test/fixtures";
import type { RecordedRequest } from "../test/network";

const manager = () => makeUser(["GESTOR"]);
const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });

const createRequests = (requests: RecordedRequest[]) =>
  requests.filter(
    ({ url, method }) => method === "POST" && url === `${testEnv.apiBaseUrl}/v1/projects`,
  );
const publishRequests = (requests: RecordedRequest[]) =>
  requests.filter(({ url, method }) => method === "POST" && url.endsWith("/publish"));

const createForm = () => screen.getByRole("form", { name: "Nuevo proyecto" });
const sessionList = () => screen.findByRole("list", { name: "Proyectos de esta sesión" });

/** Expresión que admite el espacio duro (U+00A0) que Intl pone tras «S/». */
const textPattern = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replaceAll(" ", "\\s"));

async function openPanel(options: Parameters<typeof stubNetwork>[0] = {}) {
  const network = stubNetwork(options);
  const user = userEvent.setup();
  const app = await renderApp("/gestor", { user: manager() });
  await heading("Panel del gestor");
  return { network, user, ...app };
}

async function fillProject(
  user: ReturnType<typeof userEvent.setup>,
  { title = "Botiquín rural", description = "Medicinas básicas para 3 postas", goal = "15000" } = {},
) {
  const form = createForm();
  for (const [label, value] of [
    ["Título", title],
    ["Descripción", description],
    ["Meta en soles (PEN)", goal],
  ] as const) {
    const field = within(form).getByLabelText(label);
    await user.clear(field);
    if (value) {
      await user.type(field, value);
    }
  }
  await user.click(within(form).getByRole("button", { name: "Crear borrador" }));
}

describe("HU-08: crear proyectos", () => {
  it("CA-08.1: crea un borrador con título, descripción y meta en céntimos", async () => {
    const { network, user } = await openPanel();

    await fillProject(user, { goal: "15000.50" });

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Borrador «Botiquín rural» creado.");
    await waitFor(() => expect(status).toHaveFocus());

    const [request] = createRequests(network.requests);
    expect(JSON.parse(request?.rawBody ?? "")).toEqual({
      title: "Botiquín rural",
      description: "Medicinas básicas para 3 postas",
      goalAmountCents: 1_500_050,
    });
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${TOKENS.access}`);

    const card = within(await sessionList()).getByRole("article", { name: "Botiquín rural" });
    expect(card).toHaveTextContent("Estado: Borrador");
    expect(card).toHaveTextContent("MetaS/ 15,000.50");
    expect(card).toHaveTextContent(network.projects()[0]?.projectId ?? "sin id");
    // El formulario queda listo para el siguiente proyecto.
    expect(within(createForm()).getByLabelText("Título")).toHaveValue("");
  });

  it("CA-NF02.2: el cuerpo solo lleva los campos del contrato, nunca el estado ni el acumulado", async () => {
    const { network, user } = await openPanel();

    await fillProject(user);
    await screen.findByRole("status");

    expect(Object.keys(JSON.parse(createRequests(network.requests)[0]?.rawBody ?? "{}"))).toEqual([
      "title",
      "description",
      "goalAmountCents",
    ]);
  });

  it.each([
    [{ title: "ab" }, "Título", "El título debe tener al menos 3 caracteres."],
    [{ title: "x".repeat(121) }, "Título", "El título puede tener como máximo 120 caracteres."],
    [{ description: "corta" }, "Descripción", "La descripción debe tener al menos 10 caracteres."],
    [{ goal: "" }, "Meta en soles (PEN)", "Ingresa la meta del proyecto."],
    [{ goal: "0" }, "Meta en soles (PEN)", "La meta debe ser mayor que cero."],
    [{ goal: "1000000.01" }, "Meta en soles (PEN)", "La meta máxima es S/ 1,000,000.00."],
    [{ goal: "-5" }, "Meta en soles (PEN)", "Ingresa una meta válida en soles"],
  ])("CA-08.1 (UX): %o muestra un error en «%s» y no llama al API", async (values, label, message) => {
    const { network, user } = await openPanel();

    await fillProject(user, values);

    const field = within(createForm()).getByLabelText(label);
    await waitFor(() => expect(field).toHaveAccessibleDescription(textPattern(message)));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(createRequests(network.requests)).toHaveLength(0);
  });

  it("dos envíos seguidos crean un solo borrador", async () => {
    const { network, user } = await openPanel();
    const release = network.pause("createProject");
    const form = createForm();
    await user.type(within(form).getByLabelText("Título"), "Huerto escolar");
    await user.type(within(form).getByLabelText("Descripción"), "Biohuertos en 5 colegios");
    await user.type(within(form).getByLabelText("Meta en soles (PEN)"), "8000");

    // Dos envíos antes de que el botón llegue a deshabilitarse, como un Enter repetido.
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await within(form).findByRole("button", { name: "Creando…" })).toBeDisabled();

    release();
    await screen.findByRole("status");
    expect(createRequests(network.requests)).toHaveLength(1);
  });

  it("CA-04.1: si el API responde 403 se informa; la interfaz no autoriza", async () => {
    const { user } = await openPanel({
      failures: {
        createProject: {
          status: 403,
          body: { code: "FORBIDDEN", message: "Sin permiso", requestId: "req-403" },
        },
      },
    });

    await fillProject(user);

    const alert = await within(createForm()).findByRole("alert");
    expect(alert).toHaveTextContent("Tu cuenta no tiene permiso para crear el proyecto.");
    expect(alert).not.toHaveTextContent("FORBIDDEN");
    expect(alert).not.toHaveTextContent("req-403");
    expect(screen.queryByRole("list", { name: "Proyectos de esta sesión" })).not.toBeInTheDocument();
  });

  it("un 400 del API pide revisar los datos", async () => {
    const { user } = await openPanel({
      failures: { createProject: { status: 400, body: { code: "VALIDATION_ERROR", message: "x", requestId: "r" } } },
    });

    await fillProject(user);

    expect(await within(createForm()).findByRole("alert")).toHaveTextContent(
      "Revisa el título, la descripción y la meta.",
    );
  });
});

describe("HU-08: publicar proyectos", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("CA-08.2: publica un borrador de la sesión tras confirmar y aparece en el catálogo", async () => {
    const network = stubNetwork();
    const user = userEvent.setup();
    // El catálogo vacío queda en caché antes de publicar: publicar debe refrescarlo.
    const { router } = await renderApp("/", { user: manager() });
    await screen.findByText(/Todavía no hay proyectos publicados/);
    await act(() => router.navigate("/gestor"));
    await heading("Panel del gestor");
    await fillProject(user, { title: "Agua segura" });
    const card = within(await sessionList()).getByRole("article", { name: "Agua segura" });

    await user.click(within(card).getByRole("button", { name: "Publicar «Agua segura»" }));
    const question = within(card).getByText(/¿Publicar «Agua segura»\?/);
    await waitFor(() => expect(question).toHaveFocus());
    expect(publishRequests(network.requests)).toHaveLength(0);

    await user.click(within(card).getByRole("button", { name: "Sí, publicar" }));

    const status = await within(card).findByRole("status");
    expect(status).toHaveTextContent("ya aparece en el catálogo y acepta donaciones");
    // El aviso de «borrador creado» ya no aplica.
    expect(screen.queryByText(/Puedes publicarlo/)).not.toBeInTheDocument();
    await waitFor(() => expect(status).toHaveFocus());
    expect(card).toHaveTextContent("Estado: Publicado");
    const projectId = network.projects()[0]?.projectId;
    expect(publishRequests(network.requests)[0]?.url).toBe(
      `${testEnv.apiBaseUrl}/v1/projects/${projectId}/publish`,
    );

    await act(() => router.navigate("/"));
    expect(await screen.findByRole("link", { name: "Agua segura" })).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay proyectos publicados/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Agua segura" }));
    expect(await heading("Agua segura")).toBeInTheDocument();
  });

  it("cancelar la publicación no llama al API y devuelve el foco", async () => {
    const { network, user } = await openPanel();
    await fillProject(user, { title: "Agua segura" });
    const card = within(await sessionList()).getByRole("article", { name: "Agua segura" });

    await user.click(within(card).getByRole("button", { name: "Publicar «Agua segura»" }));
    await user.click(within(card).getByRole("button", { name: "Cancelar" }));

    const again = within(card).getByRole("button", { name: "Publicar «Agua segura»" });
    await waitFor(() => expect(again).toHaveFocus());
    expect(publishRequests(network.requests)).toHaveLength(0);
  });

  it("CA-08.2: publicar uno ya publicado explica el 409", async () => {
    const { network, user } = await openPanel();
    await fillProject(user, { title: "Agua segura" });
    const card = within(await sessionList()).getByRole("article", { name: "Agua segura" });
    // Otro gestor lo publicó mientras tanto.
    const stored = network.projects()[0];
    if (stored) {
      stored.status = "PUBLICADO";
    }

    await user.click(within(card).getByRole("button", { name: "Publicar «Agua segura»" }));
    await user.click(within(card).getByRole("button", { name: "Sí, publicar" }));

    const alert = await within(card).findByRole("alert");
    expect(alert).toHaveTextContent("Este proyecto ya estaba publicado.");
    expect(alert).not.toHaveTextContent("PROJECT_ALREADY_PUBLISHED");
  });

  it("los proyectos de la sesión siguen al volver al panel minutos después y se borran al cerrar sesión", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, router, clearCache } = await openPanel();
    await fillProject(user, { title: "Agua segura" });
    await sessionList();

    await act(() => router.navigate("/"));
    // Más que los 5 minutos con los que TanStack Query descarta datos sin pantallas que los usen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000);
    });
    await act(() => router.navigate("/gestor"));
    expect(
      within(await sessionList()).getByRole("article", { name: "Agua segura" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(clearCache).toHaveBeenCalled());
  });

  it("CA-08.2: publica un borrador anterior por su identificador", async () => {
    const draft = makeProject({ title: "Biblioteca rural", status: "BORRADOR" });
    const { network, user } = await openPanel({ projects: [draft] });
    const form = screen.getByRole("form", { name: "Publicar un borrador anterior" });

    await user.type(within(form).getByLabelText("Identificador del proyecto"), ` ${draft.projectId} `);
    await user.click(within(form).getByRole("button", { name: "Publicar borrador" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "«Biblioteca rural» quedó publicado y ya acepta donaciones.",
    );
    expect(publishRequests(network.requests)[0]?.url).toBe(
      `${testEnv.apiBaseUrl}/v1/projects/${draft.projectId}/publish`,
    );
    // Queda en la lista de la sesión, ya publicado.
    const card = within(await sessionList()).getByRole("article", { name: "Biblioteca rural" });
    expect(card).toHaveTextContent("Estado: Publicado");
  });

  it("un identificador mal formado no llama al API", async () => {
    const { network, user } = await openPanel();
    const form = screen.getByRole("form", { name: "Publicar un borrador anterior" });

    await user.type(within(form).getByLabelText("Identificador del proyecto"), "no-es-un-id");
    await user.click(within(form).getByRole("button", { name: "Publicar borrador" }));

    const field = within(form).getByLabelText("Identificador del proyecto");
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(/Ingresa un identificador de proyecto válido\./),
    );
    expect(field).toHaveFocus();
    expect(publishRequests(network.requests)).toHaveLength(0);
  });

  it("un identificador inexistente responde «no existe»", async () => {
    const { user } = await openPanel();
    const form = screen.getByRole("form", { name: "Publicar un borrador anterior" });

    await user.type(
      within(form).getByLabelText("Identificador del proyecto"),
      "6f1c2b8e-3a4d-4e5f-9a0b-999999999999",
    );
    await user.click(within(form).getByRole("button", { name: "Publicar borrador" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "No existe un proyecto con ese identificador.",
    );
  });
});

describe("HU-08: acceso y accesibilidad", () => {
  it.each([
    ["un donante", ["DONANTE"] as const],
    ["un auditor", ["AUDITOR"] as const],
  ])("T03 (UX): %s que entra por URL ve 403 y no llama al API", async (_who, groups) => {
    const network = stubNetwork();
    await renderApp("/gestor", { user: makeUser([...groups]) });

    await heading("No tienes acceso a esta sección");
    expect(network.apiRequests()).toHaveLength(0);
  });

  it("CA-NF06.2: el panel, sus errores y sus resultados no tienen violaciones de axe", async () => {
    const { user } = await openPanel();
    expect(await axeViolations()).toEqual([]);

    await fillProject(user, { title: "ab", goal: "0" });
    await within(createForm()).findByText("La meta debe ser mayor que cero.");
    expect(await axeViolations()).toEqual([]);

    await fillProject(user, { title: "Agua segura" });
    const card = within(await sessionList()).getByRole("article", { name: "Agua segura" });
    expect(await axeViolations()).toEqual([]);

    await user.click(within(card).getByRole("button", { name: "Publicar «Agua segura»" }));
    expect(await axeViolations()).toEqual([]);
    await user.click(within(card).getByRole("button", { name: "Sí, publicar" }));
    await within(card).findByRole("status");
    expect(await axeViolations()).toEqual([]);
  });
});

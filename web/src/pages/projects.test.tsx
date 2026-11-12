import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axeViolations, makeProject, renderApp, stubNetwork, testEnv } from "../test/fixtures";

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const catalog = () => screen.findByRole("region", { name: "Proyectos publicados" });
const indicators = () => screen.findByRole("region", { name: "Indicadores" });

describe("HU-01: catálogo", () => {
  it("CA-01.1: muestra nombre, finalidad, meta y monto confirmado en PEN", async () => {
    stubNetwork({
      projects: [
        makeProject({
          title: "Comedor comunitario Puentes",
          description: "Raciones diarias para 40 familias",
          goalAmountCents: 1_500_000,
          confirmedAmountCents: 12_500,
        }),
      ],
    });
    await renderApp("/");

    const card = await within(await catalog()).findByRole("article", {
      name: "Comedor comunitario Puentes",
    });
    expect(card).toHaveTextContent("Raciones diarias para 40 familias");
    expect(card).toHaveTextContent("MetaS/ 15,000.00");
    expect(card).toHaveTextContent("Recaudado (simulado)S/ 125.00");
    expect(card).toHaveTextContent("0.8 % de la meta");
  });

  it("CA-01.2: un borrador nunca se muestra, aunque el API lo devolviera", async () => {
    stubNetwork({
      leakDrafts: true,
      projects: [
        makeProject({ title: "Proyecto publicado" }),
        makeProject({ title: "Borrador interno", status: "BORRADOR" }),
      ],
    });
    await renderApp("/");

    expect(await screen.findByRole("link", { name: "Proyecto publicado" })).toBeInTheDocument();
    expect(screen.queryByText("Borrador interno")).not.toBeInTheDocument();
  });

  it("CA-01.3: sin proyectos publicados muestra un estado vacío, sin errores", async () => {
    await renderApp("/");

    expect(
      await within(await catalog()).findByText(/Todavía no hay proyectos publicados/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });

  it("si el API falla muestra un error comprensible y permite reintentar", async () => {
    const network = stubNetwork({
      projects: [makeProject({ title: "Huerto escolar" })],
      failures: {
        projects: {
          status: 500,
          body: { code: "INTERNAL_ERROR", message: "Error", requestId: "req-1" },
        },
      },
    });
    const user = userEvent.setup();
    await renderApp("/");

    const alert = await within(await catalog()).findByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar los proyectos.");
    expect(alert).not.toHaveTextContent("INTERNAL_ERROR");
    expect(alert).not.toHaveTextContent("req-1");
    expect(await axeViolations()).toEqual([]);

    network.setFailure("projects", undefined);
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("link", { name: "Huerto escolar" })).toBeInTheDocument();
  });

  it("una respuesta fuera de contrato se trata como error, sin datos parciales", async () => {
    stubNetwork({
      failures: {
        projects: { status: 200, body: { items: [{ title: "Sin id ni montos" }] } },
      },
    });
    await renderApp("/");

    expect(await within(await catalog()).findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Sin id ni montos")).not.toBeInTheDocument();
  });

  it("CA-NF06.2: el catálogo con proyectos no tiene violaciones de axe", async () => {
    stubNetwork({ projects: [makeProject(), makeProject()] });
    await renderApp("/");

    expect(await within(await catalog()).findAllByRole("article")).toHaveLength(2);
    expect(await axeViolations()).toEqual([]);
  });
});

describe("HU-09: indicadores", () => {
  it("CA-09.1: suma solo lo confirmado de los proyectos publicados, en PEN", async () => {
    stubNetwork({
      projects: [
        makeProject({ goalAmountCents: 1_000_000, confirmedAmountCents: 250_000 }),
        makeProject({ goalAmountCents: 500_000, confirmedAmountCents: 50_000 }),
        makeProject({ status: "BORRADOR", goalAmountCents: 9_900_000 }),
      ],
    });
    await renderApp("/");

    const section = await indicators();
    expect(await within(section).findByText("2")).toBeInTheDocument();
    expect(section).toHaveTextContent("Recaudado (simulado)S/ 3,000.00");
    expect(section).toHaveTextContent("Meta totalS/ 15,000.00");
  });

  it("si fallan los indicadores, el catálogo se sigue mostrando", async () => {
    stubNetwork({ projects: [makeProject({ title: "Botiquín rural" })], failures: { stats: "network" } });
    await renderApp("/");

    expect(await within(await indicators()).findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los indicadores.",
    );
    expect(await screen.findByRole("link", { name: "Botiquín rural" })).toBeInTheDocument();
  });
});

describe("HU-02: detalle", () => {
  it("CA-02.1: muestra identificador, descripción, meta, estado y monto acumulado", async () => {
    const project = makeProject({
      title: "Biblioteca itinerante",
      description: "Libros para 12 escuelas rurales",
      goalAmountCents: 800_000,
      confirmedAmountCents: 400_000,
    });
    stubNetwork({ projects: [project] });
    await renderApp(`/proyectos/${project.projectId}`);

    await heading("Biblioteca itinerante");
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("Libros para 12 escuelas rurales");
    expect(main).toHaveTextContent("EstadoPublicado");
    expect(main).toHaveTextContent(`Identificador${project.projectId}`);
    expect(main).toHaveTextContent("MetaS/ 8,000.00");
    expect(main).toHaveTextContent("Recaudado (simulado)S/ 4,000.00");
    expect(main).toHaveTextContent("50 % de la meta");
    expect(main).toHaveTextContent("Publicado el8 de noviembre de 2026");
    expect(await axeViolations()).toEqual([]);
  });

  it("CA-02.1 y CA-09.2: no muestra datos de donantes aunque el API los enviara", async () => {
    const project = makeProject({
      title: "Ollas comunes",
      donors: [{ donorSub: "sub-de-un-donante", email: "donante@correo.example" }],
      donorSub: "sub-de-un-donante",
    });
    stubNetwork({ projects: [project] });
    await renderApp(`/proyectos/${project.projectId}`);

    await heading("Ollas comunes");
    expect(document.body).not.toHaveTextContent("sub-de-un-donante");
    expect(document.body).not.toHaveTextContent("donante@correo.example");
  });

  it("CA-02.2: un id inexistente muestra «no encontrado» sin detalles técnicos", async () => {
    await renderApp("/proyectos/6f1c2b8e-3a4d-4e5f-9a0b-999999999999");

    await heading("Proyecto no encontrado");
    expect(screen.getByRole("main")).toHaveTextContent("no existe o no está disponible");
    expect(document.body).not.toHaveTextContent("PROJECT_NOT_FOUND");
    expect(document.body).not.toHaveTextContent("req-prueba-404");
    expect(await axeViolations()).toEqual([]);
  });

  it("CA-02.2: un borrador se presenta igual que uno inexistente", async () => {
    const draft = makeProject({ title: "Borrador interno", status: "BORRADOR" });
    stubNetwork({ leakDrafts: true, projects: [draft] });
    await renderApp(`/proyectos/${draft.projectId}`);

    await heading("Proyecto no encontrado");
    expect(document.body).not.toHaveTextContent("Borrador interno");
  });

  it("un id mal formado no consulta el API", async () => {
    const network = stubNetwork();
    await renderApp("/proyectos/no-es-un-uuid");

    await heading("Proyecto no encontrado");
    expect(network.requestsTo("/v1/projects/no-es-un-uuid")).toHaveLength(0);
  });

  it("si el API falla permite reintentar sin confundirlo con «no encontrado»", async () => {
    const project = makeProject({ title: "Agua segura" });
    const network = stubNetwork({ projects: [project], failures: { detail: "network" } });
    const user = userEvent.setup();
    await renderApp(`/proyectos/${project.projectId}`);

    await heading("No se pudo cargar el proyecto");
    network.setFailure("detail", undefined);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await heading("Agua segura")).toBeInTheDocument();
  });

  it("CA-NF06.2: desde el catálogo, el foco queda en el título del proyecto cargado", async () => {
    const project = makeProject({ title: "Talleres de lectura" });
    stubNetwork({ projects: [project] });
    const user = userEvent.setup();
    await renderApp("/");

    await user.click(await screen.findByRole("link", { name: "Talleres de lectura" }));

    const title = await heading("Talleres de lectura");
    await waitFor(() => expect(title).toHaveFocus());
    expect(document.title).toBe("Talleres de lectura · Donaciones Seguras");
  });

  it("vuelve al catálogo desde el detalle", async () => {
    const project = makeProject({ title: "Huerto familiar" });
    stubNetwork({ projects: [project] });
    const user = userEvent.setup();
    const { router } = await renderApp(`/proyectos/${project.projectId}`);

    await heading("Huerto familiar");
    await user.click(screen.getByRole("link", { name: "Volver al catálogo" }));

    expect(router.state.location.pathname).toBe("/");
  });

  it("codifica el id en la URL del API", async () => {
    const network = stubNetwork();
    const { router } = await renderApp("/");
    await act(() => router.navigate("/proyectos/6f1c2b8e-3a4d-4e5f-9a0b-000000000123"));

    await heading("Proyecto no encontrado");
    expect(network.apiRequests().map(({ url }) => url)).toContain(
      `${testEnv.apiBaseUrl}/v1/projects/6f1c2b8e-3a4d-4e5f-9a0b-000000000123`,
    );
  });
});

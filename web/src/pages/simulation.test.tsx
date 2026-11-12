import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SIMULATION_NOTICE } from "../donations/SimulationNotice";
import {
  axeViolations,
  makeDonation,
  makeProject,
  makeUser,
  renderApp,
  stubNetwork,
  testEnv,
  TOKENS,
} from "../test/fixtures";
import type { RecordedRequest } from "../test/network";

const donor = () => makeUser(["DONANTE"]);

const simulateRequests = (requests: RecordedRequest[]) =>
  requests.filter(({ url, method }) => method === "POST" && url.endsWith("/simulate"));

async function historyCard(name: string) {
  const list = await screen.findByRole("list", { name: "Historial de donaciones" });
  return within(list).getByRole("article", { name });
}

async function openHistory(options: Parameters<typeof stubNetwork>[0] = {}) {
  const project = makeProject({ title: "Comedor Puentes", confirmedAmountCents: 0 });
  const donation = makeDonation({
    projectId: project.projectId,
    projectTitle: project.title,
    amountCents: 2_550,
  });
  const network = stubNetwork({ projects: [project], donations: [donation], ...options });
  const user = userEvent.setup();
  const app = await renderApp("/mis-donaciones", { user: donor() });
  const card = await historyCard("Comedor Puentes");
  return { network, user, project, donation, card, ...app };
}

describe("HU-06: simular el resultado desde el historial", () => {
  it("CA-06.1: confirma una donación propia pendiente tras pedir confirmación", async () => {
    const { network, user, donation, card } = await openHistory();

    await user.click(within(card).getByRole("button", { name: "Simular confirmación" }));

    const question = within(card).getByText(/¿Confirmar la donación simulada de S\/\s25\.50\?/);
    await waitFor(() => expect(question).toHaveFocus());
    expect(simulateRequests(network.requests)).toHaveLength(0);

    await user.click(within(card).getByRole("button", { name: "Sí, confirmar" }));

    const status = await within(card).findByRole("status");
    expect(status).toHaveTextContent("Donación confirmada (simulada).");
    await waitFor(() => expect(status).toHaveFocus());
    expect(card).toHaveTextContent("Estado: Confirmada (simulada)");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();

    const [request] = simulateRequests(network.requests);
    expect(request?.url).toBe(
      `${testEnv.apiBaseUrl}/v1/donations/${donation.donationId}/simulate`,
    );
    expect(JSON.parse(request?.rawBody ?? "")).toEqual({ outcome: "CONFIRMADA_SIMULADA" });
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${TOKENS.access}`);
    // CA-06.2: el total confirmado del historial se actualiza con la respuesta.
    expect(screen.getByRole("main")).toHaveTextContent("Total confirmado (simulado)S/ 25.50");
    // El proyecto partía de 0: el API simulado sumó una sola vez.
    expect(network.projects()[0]?.confirmedAmountCents).toBe(2_550);
  });

  it("CA-06.3: un rechazo no suma al total confirmado", async () => {
    const { user, card } = await openHistory();

    await user.click(within(card).getByRole("button", { name: "Simular rechazo" }));
    expect(within(card).getByText(/No sumará al avance del proyecto/)).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Sí, rechazar" }));

    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Donación rechazada (simulada). No suma al avance del proyecto.",
    );
    expect(card).toHaveTextContent("Estado: Rechazada (simulada)");
    expect(screen.getByRole("main")).toHaveTextContent("Total confirmado (simulado)S/ 0.00");
  });

  it("cancelar no llama al API y devuelve el foco al botón elegido", async () => {
    const { network, user, card } = await openHistory();
    const reject = within(card).getByRole("button", { name: "Simular rechazo" });

    await user.click(reject);
    await user.click(within(card).getByRole("button", { name: "Cancelar" }));

    const again = within(card).getByRole("button", { name: "Simular rechazo" });
    await waitFor(() => expect(again).toHaveFocus());
    expect(simulateRequests(network.requests)).toHaveLength(0);
  });

  it("CA-06.2: durante el envío el botón se deshabilita y un segundo clic no envía otra", async () => {
    const { network, user, card } = await openHistory();
    // La red queda en pausa para observar el estado mientras la solicitud está en curso.
    const release = network.pause("simulate");

    await user.click(within(card).getByRole("button", { name: "Simular confirmación" }));
    await user.click(within(card).getByRole("button", { name: "Sí, confirmar" }));
    const sending = within(card).getByRole("button", { name: "Simulando…" });
    expect(sending).toBeDisabled();
    await user.click(sending);

    release();
    await within(card).findByRole("status");
    expect(simulateRequests(network.requests)).toHaveLength(1);
  });

  it("solo las pendientes ofrecen simular", async () => {
    stubNetwork({
      donations: [
        makeDonation({ projectTitle: "Pendiente", status: "PENDIENTE_SIMULACION" }),
        makeDonation({ projectTitle: "Confirmada", status: "CONFIRMADA_SIMULADA" }),
        makeDonation({ projectTitle: "Rechazada", status: "RECHAZADA_SIMULADA" }),
      ],
    });
    await renderApp("/mis-donaciones", { user: donor() });

    const pending = await historyCard("Pendiente");
    expect(within(pending).getAllByRole("button")).toHaveLength(2);
    expect(within(await historyCard("Confirmada")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(await historyCard("Rechazada")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("CA-06.2: si ya tenía resultado lo explica y muestra el estado real", async () => {
    const { network, user, card, donation } = await openHistory();
    // Otra pestaña la confirmó antes: el API responde 409 y el historial se actualiza.
    const stored = network.donations().find((d) => d.donationId === donation.donationId);
    if (stored) {
      stored.status = "CONFIRMADA_SIMULADA";
    }

    await user.click(within(card).getByRole("button", { name: "Simular rechazo" }));
    await user.click(within(card).getByRole("button", { name: "Sí, rechazar" }));

    const alert = await within(card).findByRole("alert");
    expect(alert).toHaveTextContent("ya tenía un resultado de simulación");
    expect(alert).not.toHaveTextContent("DONATION_ALREADY_FINALIZED");
    await waitFor(() => expect(card).toHaveTextContent("Estado: Confirmada (simulada)"));
    expect(alert).toBeInTheDocument();
  });

  it.each([
    [
      { status: 404, body: { code: "NOT_FOUND", message: "x", requestId: "r" } },
      "La simulación solo está disponible en el entorno académico.",
    ],
    [
      { status: 404, body: { code: "DONATION_NOT_FOUND", message: "x", requestId: "r" } },
      "No encontramos esta donación en tu cuenta.",
    ],
    [
      { status: 409, body: { code: "DONATION_SIMULATION_IN_PROGRESS", message: "x", requestId: "r" } },
      "Espera unos segundos y vuelve a intentarlo.",
    ],
    [
      { status: 403, body: { code: "FORBIDDEN", message: "x", requestId: "r" } },
      "Tu cuenta no tiene permiso para simular la donación.",
    ],
    ["network" as const, "una donación solo se cuenta una vez"],
  ])("explica el error %# sin detalles internos", async (failure, message) => {
    const { network, user, card } = await openHistory();
    network.setFailure("simulate", failure);

    await user.click(within(card).getByRole("button", { name: "Simular confirmación" }));
    await user.click(within(card).getByRole("button", { name: "Sí, confirmar" }));

    const alert = await within(card).findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(/NOT_FOUND|FORBIDDEN|IN_PROGRESS/);
    // La donación sigue pendiente y se puede reintentar.
    expect(within(card).getByRole("button", { name: "Sí, confirmar" })).toBeEnabled();
  });

  it("CA-NF06.2: opciones, confirmación y resultado no tienen violaciones de axe", async () => {
    const { user, card } = await openHistory();
    expect(await axeViolations()).toEqual([]);

    await user.click(within(card).getByRole("button", { name: "Simular confirmación" }));
    expect(await axeViolations()).toEqual([]);

    await user.click(within(card).getByRole("button", { name: "Sí, confirmar" }));
    await within(card).findByRole("status");
    expect(await axeViolations()).toEqual([]);
  });
});

describe("HU-06: simular desde el resultado de la donación", () => {
  it("CA-06.4: confirma recién registrada, con el rótulo de simulación y el avance actualizado", async () => {
    const project = makeProject({
      title: "Huerto familiar",
      goalAmountCents: 100_000,
      confirmedAmountCents: 0,
    });
    stubNetwork({ projects: [project] });
    const user = userEvent.setup();
    const { router } = await renderApp(`/proyectos/${project.projectId}/donar`, { user: donor() });

    await user.type(await screen.findByRole("textbox", { name: /Monto a donar/ }), "40");
    await user.click(screen.getByRole("button", { name: "Registrar intención de donación" }));
    const receipt = await screen.findByRole("region", { name: "Intención de donación registrada" });
    expect(receipt).toHaveTextContent(SIMULATION_NOTICE);
    expect(receipt).toHaveTextContent("EstadoPendiente de simulación");

    await user.click(within(receipt).getByRole("button", { name: "Simular confirmación" }));
    await user.click(within(receipt).getByRole("button", { name: "Sí, confirmar" }));

    expect(await within(receipt).findByRole("status")).toHaveTextContent(
      "Donación confirmada (simulada).",
    );
    expect(receipt).toHaveTextContent("EstadoConfirmada (simulada)");
    expect(receipt).toHaveTextContent(SIMULATION_NOTICE);

    // El detalle se vuelve a consultar y muestra el nuevo acumulado (CA-09.1).
    await user.click(screen.getByRole("link", { name: "Volver al proyecto" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/proyectos/${project.projectId}`));
    // S/ 40.00 de una meta de S/ 1,000.00.
    expect(await screen.findByText("4 % de la meta")).toBeInTheDocument();
  });
});

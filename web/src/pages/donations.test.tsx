import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SIMULATION_NOTICE } from "../donations/SimulationNotice";
import {
  axeViolations,
  browserStorageDump,
  idTokenFor,
  makeDonation,
  makeProject,
  makeUser,
  renderApp,
  stubNetwork,
  testEnv,
  TOKENS,
} from "../test/fixtures";
import type { RecordedRequest } from "../test/network";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Expresión literal que admite el espacio duro (U+00A0) que Intl pone tras «S/». */
const textPattern = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replaceAll(" ", "\\s"));

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const amountField = () => screen.findByRole("textbox", { name: /Monto a donar/ });
const submitButton = () => screen.getByRole("button", { name: "Registrar intención de donación" });
const donor = () => makeUser(["DONANTE"]);

const postsTo = (requests: RecordedRequest[]) =>
  requests.filter(
    ({ url, method }) => url === `${testEnv.apiBaseUrl}/v1/donations` && method === "POST",
  );
const keysOf = (requests: RecordedRequest[]) =>
  postsTo(requests).map(({ headers }) => headers.get("Idempotency-Key"));

async function openDonationForm(project = makeProject({ title: "Comedor Puentes" })) {
  const network = stubNetwork({ projects: [project] });
  const user = userEvent.setup();
  const app = await renderApp(`/proyectos/${project.projectId}/donar`, { user: donor() });
  await heading(`Donar a ${project.title}`);
  return { network, user, project, ...app };
}

async function donate(user: ReturnType<typeof userEvent.setup>, amount: string) {
  const field = await amountField();
  await user.clear(field);
  await user.type(field, amount);
  await user.click(submitButton());
}

describe("HU-05: formulario de donación", () => {
  it("CA-05.1: registra una intención válida en céntimos y muestra el estado pendiente", async () => {
    const { network, user, project } = await openDonationForm();

    await donate(user, "25.50");

    const receipt = await screen.findByRole("region", { name: "Intención de donación registrada" });
    expect(receipt).toHaveTextContent("ProyectoComedor Puentes");
    expect(receipt).toHaveTextContent("MontoS/ 25.50");
    expect(receipt).toHaveTextContent("EstadoPendiente de simulación");
    expect(receipt).toHaveTextContent(SIMULATION_NOTICE);
    await waitFor(() =>
      expect(within(receipt).getByRole("heading", { level: 2 })).toHaveFocus(),
    );

    const [request] = postsTo(network.requests);
    expect(JSON.parse(request?.rawBody ?? "")).toEqual({
      projectId: project.projectId,
      amountCents: 2550,
    });
    expect(request?.headers.get("Idempotency-Key")).toMatch(UUID);
    expect(network.donations()).toHaveLength(1);
  });

  it("CA-05.3 y T11: el cuerpo no lleva identidad y se envía el access token, no el ID token", async () => {
    const { network, user } = await openDonationForm();

    await donate(user, "10");
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    const [request] = postsTo(network.requests);
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${TOKENS.access}`);
    expect(request?.headers.get("Authorization")).not.toContain(idTokenFor(["DONANTE"]));
    expect(Object.keys(JSON.parse(request?.rawBody ?? "{}"))).toEqual(["projectId", "amountCents"]);
  });

  it("CA-NF11.1: la clave de idempotencia y los tokens no quedan en el navegador", async () => {
    const { network, user } = await openDonationForm();

    await donate(user, "10");
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    const [key] = keysOf(network.requests);
    const storage = browserStorageDump();
    expect(storage).not.toContain(key);
    expect(storage).not.toContain(TOKENS.access);
  });

  it("CA-05.5: solo pide el monto, nunca datos de tarjeta, cuenta bancaria ni DNI", async () => {
    await openDonationForm();

    const form = screen.getByRole("form", { name: "Datos de la donación" });
    expect(within(form).getAllByRole("textbox")).toHaveLength(1);
    expect(within(form).queryByLabelText(/tarjeta|cvv|cuenta|dni/i)).not.toBeInTheDocument();
  });

  it.each([
    ["1,5", 150],
    ["S/ 1000", 100_000],
    [" 7.05 ", 705],
  ])("acepta «%s» y envía %i céntimos", async (typed, cents) => {
    const { network, user } = await openDonationForm();

    await donate(user, typed);
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    expect(JSON.parse(postsTo(network.requests)[0]?.rawBody ?? "")).toMatchObject({
      amountCents: cents,
    });
  });

  it.each([
    ["0", "El monto mínimo es S/ 1.00."],
    ["0.99", "El monto mínimo es S/ 1.00."],
    ["1000.01", "El monto máximo es S/ 1,000.00."],
    ["10.505", "Ingresa un monto válido"],
    ["-5", "Ingresa un monto válido"],
    ["1,000.00", "Ingresa un monto válido"],
    ["diez", "Ingresa un monto válido"],
  ])("T04 (UX): «%s» muestra un error accesible y no llama al API", async (typed, message) => {
    const { network, user } = await openDonationForm();

    await donate(user, typed);

    const field = await amountField();
    await waitFor(() => expect(field).toHaveAccessibleDescription(textPattern(message)));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(postsTo(network.requests)).toHaveLength(0);
  });

  it("un monto vacío pide completarlo", async () => {
    const { network, user } = await openDonationForm();

    await user.click(submitButton());

    expect(await amountField()).toHaveAccessibleDescription(
      /Ingresa el monto que deseas donar\./,
    );
    expect(postsTo(network.requests)).toHaveLength(0);
  });

  it("CA-05.4: reintentar tras un fallo de red reutiliza la clave y no duplica", async () => {
    const { network, user } = await openDonationForm();
    network.setFailure("createDonation", "network");

    await donate(user, "50");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Puedes reintentar: tu donación no se duplicará.",
    );

    network.setFailure("createDonation", undefined);
    await user.click(submitButton());
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    const [first, second] = keysOf(network.requests);
    expect(first).toMatch(UUID);
    expect(second).toBe(first);
    expect(network.donations()).toHaveLength(1);
  });

  it("CA-05.4: tras un 5xx, cambiar el monto es otro intento y usa otra clave", async () => {
    const { network, user } = await openDonationForm();
    network.setFailure("createDonation", { status: 503 });

    await donate(user, "50");
    await screen.findByRole("alert");
    network.setFailure("createDonation", undefined);
    await donate(user, "60");
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    const [first, second] = keysOf(network.requests);
    expect(second).not.toBe(first);
  });

  it("CA-05.4: cada donación registrada usa una clave nueva", async () => {
    const { network, user } = await openDonationForm();

    await donate(user, "20");
    await user.click(await screen.findByRole("button", { name: "Registrar otra donación" }));
    await waitFor(async () => expect(await amountField()).toHaveFocus());
    expect(await amountField()).toHaveValue("");
    await donate(user, "20");
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    const [first, second] = keysOf(network.requests);
    expect(second).not.toBe(first);
    expect(network.donations()).toHaveLength(2);
  });

  it("CA-05.4: un doble clic no registra dos donaciones", async () => {
    const { network, user } = await openDonationForm();

    await user.type(await amountField(), "15");
    await user.dblClick(submitButton());
    await screen.findByRole("region", { name: "Intención de donación registrada" });

    expect(new Set(keysOf(network.requests)).size).toBe(1);
    expect(network.donations()).toHaveLength(1);
  });

  it("CA-05.2: si el API responde 409 lo explica sin códigos internos", async () => {
    const { network, user } = await openDonationForm();
    network.setFailure("createDonation", {
      status: 409,
      body: { code: "PROJECT_NOT_ELIGIBLE", message: "No elegible", requestId: "req-409" },
    });

    await donate(user, "30");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este proyecto ya no acepta donaciones.");
    expect(alert).not.toHaveTextContent("PROJECT_NOT_ELIGIBLE");
    expect(alert).not.toHaveTextContent("req-409");
  });

  it("CA-04.3: la interfaz no autoriza; si el API responde 403 se informa", async () => {
    const { network, user } = await openDonationForm();
    network.setFailure("createDonation", {
      status: 403,
      body: { code: "FORBIDDEN", message: "Sin permiso", requestId: "req-403" },
    });

    await donate(user, "30");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tu cuenta no tiene permiso para registrar donaciones.",
    );
    expect(screen.queryByRole("region", { name: /registrada/ })).not.toBeInTheDocument();
  });

  it("con la sesión expirada ofrece volver a iniciar sesión", async () => {
    const { network, user } = await openDonationForm();
    network.setFailure("createDonation", {
      status: 401,
      body: { code: "UNAUTHORIZED", message: "No autorizado", requestId: "req-401" },
    });

    await donate(user, "30");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Tu sesión expiró.");
    expect(within(alert).getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
  });

  it("CA-08.2: un borrador no muestra el formulario", async () => {
    const draft = makeProject({ title: "Borrador interno", status: "BORRADOR" });
    stubNetwork({ leakDrafts: true, projects: [draft] });
    await renderApp(`/proyectos/${draft.projectId}/donar`, { user: donor() });

    await heading("Proyecto no disponible");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Borrador interno");
  });

  it("un GESTOR que entra por URL ve la página 403 (el API también lo rechazaría)", async () => {
    const project = makeProject();
    const network = stubNetwork({ projects: [project] });
    await renderApp(`/proyectos/${project.projectId}/donar`, { user: makeUser(["GESTOR"]) });

    await heading("No tienes acceso a esta sección");
    expect(postsTo(network.requests)).toHaveLength(0);
  });

  it("CA-NF06.2: formulario, errores y resultado no tienen violaciones de axe", async () => {
    const { user } = await openDonationForm();
    expect(await axeViolations()).toEqual([]);

    await donate(user, "0");
    await screen.findByText("El monto mínimo es S/ 1.00.");
    expect(await axeViolations()).toEqual([]);

    await donate(user, "12");
    await screen.findByRole("region", { name: "Intención de donación registrada" });
    expect(await axeViolations()).toEqual([]);
  });
});

describe("HU-05: acceso al formulario desde el detalle", () => {
  it.each([
    { who: "un visitante", groups: null, visible: true },
    { who: "un donante", groups: ["DONANTE"] as const, visible: true },
    { who: "un gestor", groups: ["GESTOR"] as const, visible: false },
  ])("$who: botón «Donar» visible = $visible", async ({ groups, visible }) => {
    const project = makeProject({ title: "Agua segura" });
    stubNetwork({ projects: [project] });
    await renderApp(`/proyectos/${project.projectId}`, {
      user: groups ? makeUser([...groups]) : null,
    });

    await heading("Agua segura");
    const link = screen.queryByRole("link", { name: "Donar a este proyecto" });
    if (visible) {
      expect(link).toHaveAttribute("href", `/proyectos/${project.projectId}/donar`);
    } else {
      expect(link).not.toBeInTheDocument();
    }
  });
});

describe("HU-07: historial propio", () => {
  it("CA-07.1: muestra fecha, importe, proyecto y estado, de lo más reciente a lo más antiguo", async () => {
    stubNetwork({
      donations: [
        makeDonation({
          projectTitle: "Biblioteca itinerante",
          amountCents: 2_500,
          status: "RECHAZADA_SIMULADA",
          createdAt: "2026-11-07T15:00:00.000Z",
        }),
        makeDonation({
          projectTitle: "Comedor Puentes",
          amountCents: 10_000,
          status: "CONFIRMADA_SIMULADA",
          createdAt: "2026-11-10T15:00:00.000Z",
        }),
        makeDonation({
          projectTitle: "Huerto escolar",
          amountCents: 4_050,
          status: "PENDIENTE_SIMULACION",
          createdAt: "2026-11-09T15:00:00.000Z",
        }),
      ],
    });
    await renderApp("/mis-donaciones", { user: donor() });

    const list = await screen.findByRole("list", { name: "Historial de donaciones" });
    const cards = within(list).getAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual([
      "Comedor Puentes",
      "Huerto escolar",
      "Biblioteca itinerante",
    ]);
    expect(cards[0]).toHaveTextContent("Estado: Confirmada (simulada)");
    expect(cards[0]).toHaveTextContent("ImporteS/ 100.00");
    expect(cards[0]).toHaveTextContent("Fecha10 nov. 2026, 10:00 a. m.");
    expect(cards[1]).toHaveTextContent("Estado: Pendiente de simulación");
    expect(cards[2]).toHaveTextContent("Estado: Rechazada (simulada)");

    expect(screen.getByRole("main")).toHaveTextContent("Donaciones registradas3");
    // CA-09.1: solo suma lo confirmado.
    expect(screen.getByRole("main")).toHaveTextContent("Total confirmado (simulado)S/ 100.00");
    expect(screen.getByRole("main")).toHaveTextContent(SIMULATION_NOTICE);
    expect(await axeViolations()).toEqual([]);
  });

  it("CA-07.1: la consulta no envía identificadores de usuario, solo el access token", async () => {
    const network = stubNetwork();
    await renderApp("/mis-donaciones", { user: donor() });
    await screen.findByText("Todavía no has registrado donaciones.");

    const requests = network.apiRequests();
    expect(requests.map(({ url }) => url)).toEqual([`${testEnv.apiBaseUrl}/v1/donations/me`]);
    expect(requests[0]?.headers.get("Authorization")).toBe(`Bearer ${TOKENS.access}`);
  });

  it("CA-07.2 y RNF-HU-10: no muestra datos de identidad aunque el API los enviara", async () => {
    stubNetwork({
      donations: [
        makeDonation({
          projectTitle: "Ollas comunes",
          donorSub: "sub-de-otra-persona",
          email: "otra@correo.example",
        }),
      ],
    });
    await renderApp("/mis-donaciones", { user: donor() });

    await screen.findByRole("heading", { level: 2, name: "Ollas comunes" });
    expect(document.body).not.toHaveTextContent("sub-de-otra-persona");
    expect(document.body).not.toHaveTextContent("otra@correo.example");
  });

  it("sin donaciones muestra un estado vacío con enlace al catálogo", async () => {
    await renderApp("/mis-donaciones", { user: donor() });

    expect(await screen.findByText("Todavía no has registrado donaciones.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explorar proyectos" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });

  it("si el API falla muestra un error comprensible y permite reintentar", async () => {
    const network = stubNetwork({
      donations: [makeDonation({ projectTitle: "Agua segura" })],
      failures: {
        myDonations: {
          status: 500,
          body: { code: "INTERNAL_ERROR", message: "Error", requestId: "req-500" },
        },
      },
    });
    const user = userEvent.setup();
    await renderApp("/mis-donaciones", { user: donor() });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo cargar tu historial de donaciones.");
    expect(alert).not.toHaveTextContent("req-500");

    network.setFailure("myDonations", undefined);
    await user.click(within(alert).getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Agua segura" })).toBeInTheDocument();
  });

  it("una respuesta fuera de contrato se trata como error, sin datos parciales", async () => {
    stubNetwork({
      failures: {
        myDonations: { status: 200, body: { items: [{ projectTitle: "Sin id ni monto" }] } },
      },
    });
    await renderApp("/mis-donaciones", { user: donor() });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Sin id ni monto")).not.toBeInTheDocument();
  });

  it("T12 (UX): un GESTOR no ve el historial y no se consulta el API", async () => {
    const network = stubNetwork();
    await renderApp("/mis-donaciones", { user: makeUser(["GESTOR"]) });

    await heading("No tienes acceso a esta sección");
    expect(network.requestsTo("/v1/donations/me")).toHaveLength(0);
  });

  it("una donación recién registrada aparece aunque el historial ya estuviera en caché", async () => {
    const project = makeProject({ title: "Huerto familiar" });
    stubNetwork({ projects: [project] });
    const user = userEvent.setup();
    const { router } = await renderApp("/mis-donaciones", { user: donor() });
    // El historial vacío queda en caché (staleTime de 30 s) antes de donar.
    await screen.findByText("Todavía no has registrado donaciones.");

    await act(() => router.navigate(`/proyectos/${project.projectId}/donar`));
    await heading("Donar a Huerto familiar");
    await donate(user, "42");
    await user.click(await screen.findByRole("link", { name: "Ver mis donaciones" }));

    const list = await screen.findByRole("list", { name: "Historial de donaciones" });
    const [card] = within(list).getAllByRole("article");
    expect(card).toHaveTextContent("Huerto familiar");
    expect(card).toHaveTextContent("ImporteS/ 42.00");
    expect(card).toHaveTextContent("Estado: Pendiente de simulación");
  });
});

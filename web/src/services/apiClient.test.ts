import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { shouldRetry } from "../app/services";
import { createUserManager } from "../auth/oidcConfig";
import { getValidAccessToken } from "../auth/session";
import { makeUser, ORIGIN, testEnv, TOKENS } from "../test/fixtures";
import { ApiError, createApiClient, INVALID_RESPONSE } from "./apiClient";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const client = (token: string | null = null) =>
  createApiClient({ baseUrl: testEnv.apiBaseUrl, getAccessToken: async () => token });

const sentHeaders = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls[0]![1]!.headers as Headers;

describe("apiClient", () => {
  it("T11: con una sesión real envía el access token, nunca el ID token", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    const userManager = createUserManager(testEnv, ORIGIN);
    const user = makeUser(["DONANTE"]);
    await userManager.storeUser(user);

    await createApiClient({
      baseUrl: testEnv.apiBaseUrl,
      getAccessToken: () => getValidAccessToken(userManager),
    }).request("/v1/donations/me");

    const authorization = sentHeaders(fetchMock).get("Authorization");
    expect(authorization).toBe(`Bearer ${TOKENS.access}`);
    expect(authorization).not.toContain(user.id_token);
  });

  it("no envía Authorization sin sesión", async () => {
    const fetchMock = stubFetch(Response.json([]));
    await expect(client().request("/v1/projects")).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${testEnv.apiBaseUrl}/v1/projects`);
    expect(sentHeaders(fetchMock).has("Authorization")).toBe(false);
  });

  it("serializa el cuerpo como JSON y conserva cabeceras propias", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await client("token").request("/v1/donations", {
      method: "POST",
      json: { projectId: "p1", amountCents: 100 },
      headers: { "Idempotency-Key": "clave" },
    });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBe(JSON.stringify({ projectId: "p1", amountCents: 100 }));
    expect(sentHeaders(fetchMock).get("Content-Type")).toBe("application/json");
    expect(sentHeaders(fetchMock).get("Idempotency-Key")).toBe("clave");
  });

  it("convierte el error uniforme del API en ApiError", async () => {
    stubFetch(
      Response.json(
        { code: "FORBIDDEN", message: "Acceso denegado", requestId: "req-1" },
        { status: 403 },
      ),
    );
    const error = await client("token").request("/v1/projects").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Acceso denegado",
      requestId: "req-1",
    });
  });

  it("no expone cuerpos de error inesperados", async () => {
    stubFetch(new Response("<html>stack trace interno</html>", { status: 502 }));
    await expect(client().request("/v1/projects")).rejects.toMatchObject({
      status: 502,
      code: "UNEXPECTED_ERROR",
      message: "Ocurrió un error inesperado al procesar la solicitud.",
    });
  });

  it("convierte un fallo de red en un ApiError comprensible", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(client().request("/v1/projects")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("explica el throttling de API Gateway, que responde 429 sin cuerpo uniforme", async () => {
    stubFetch(new Response(null, { status: 429 }));
    await expect(client().request("/v1/projects")).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("demasiadas solicitudes"),
    });
  });
});

describe("apiClient con esquema", () => {
  const schema = z.object({ id: z.string(), amountCents: z.int() });

  it("devuelve solo los campos del contrato y descarta los extra", async () => {
    stubFetch(Response.json({ id: "a", amountCents: 100, donorSub: "sub-ajeno" }));
    await expect(client().request("/v1/recurso", { schema })).resolves.toEqual({
      id: "a",
      amountCents: 100,
    });
  });

  it.each([
    ["un campo con tipo incorrecto", Response.json({ id: "a", amountCents: 1.5 })],
    ["un campo ausente", Response.json({ id: "a" })],
    ["un cuerpo que no es JSON", new Response("<html>", { status: 200 })],
  ])("rechaza %s con INVALID_RESPONSE", async (_, response) => {
    stubFetch(response);
    await expect(client().request("/v1/recurso", { schema })).rejects.toMatchObject({
      code: INVALID_RESPONSE,
      message: "La respuesta del servidor no tiene el formato esperado.",
    });
  });
});

describe("política de reintentos", () => {
  it("no reintenta errores del cliente ni respuestas fuera de contrato", () => {
    expect(shouldRetry(0, new ApiError(404, "PROJECT_NOT_FOUND", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, "UNEXPECTED_ERROR", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(200, INVALID_RESPONSE, "x"))).toBe(false);
  });

  it("reintenta errores de red y 5xx hasta dos veces", () => {
    const network = new ApiError(0, "NETWORK_ERROR", "x");
    expect(shouldRetry(0, network)).toBe(true);
    expect(shouldRetry(1, new ApiError(503, "UNEXPECTED_ERROR", "x"))).toBe(true);
    expect(shouldRetry(2, network)).toBe(false);
  });
});

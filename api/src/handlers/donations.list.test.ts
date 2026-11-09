import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent, bodyOf, DONANTE, GESTOR } from "../test-utils/events.js";
import { handler as listMyDonations } from "./listMyDonations.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const OTHER_SUB = "33333333-3333-4333-8333-333333333333";

function donationItem(id: string, donorSub = DONANTE.claims.sub) {
  return {
    pk: `DONATION#${id}`,
    gsi1pk: `DONOR#${donorSub}`,
    gsi1sk: `2026-11-09T10:00:00.000Z#${id}`,
    donationId: id,
    projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectTitle: "Comedor comunitario Puentes",
    amountCents: 2_550,
    currency: "PEN",
    status: "PENDIENTE_SIMULACION",
    donorSub,
    idempotencyKey: "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b",
    payloadHash: "a".repeat(64),
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
  };
}

const meEvent = (options: { user?: typeof DONANTE; query?: Record<string, string> } = {}) =>
  apiEvent({
    routeKey: "GET /v1/donations/me",
    user: options.user ?? DONANTE,
    queryStringParameters: options.query,
  });

beforeEach(() => {
  ddbMock.reset();
  process.env.DONATIONS_TABLE = "donations-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("GET /v1/donations/me (HU-07)", () => {
  it("CA-07.1: devuelve las donaciones del sub del token con fecha, importe, proyecto y estado", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [donationItem("d1"), donationItem("d2")] });

    const response = await listMyDonations(meEvent());

    expect(response.statusCode).toBe(200);
    const items = bodyOf(response).items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      donationId: "d1",
      projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectTitle: "Comedor comunitario Puentes",
      amountCents: 2_550,
      currency: "PEN",
      status: "PENDIENTE_SIMULACION",
      createdAt: "2026-11-09T10:00:00.000Z",
      updatedAt: "2026-11-09T10:00:00.000Z",
    });
    expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      IndexName: "gsi1",
      ExpressionAttributeValues: { ":donor": `DONOR#${DONANTE.claims.sub}` },
      ScanIndexForward: false,
    });
  });

  it("CA-07.2 / T09: un ?donorSub= ajeno se ignora y solo se consulta el sub del token", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await listMyDonations(meEvent({ query: { donorSub: OTHER_SUB } }));

    const input = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(input?.ExpressionAttributeValues).toEqual({ ":donor": `DONOR#${DONANTE.claims.sub}` });
    expect(JSON.stringify(input)).not.toContain(OTHER_SUB);
  });

  it("descarta cualquier ítem ajeno que apareciera en la partición y no expone campos internos", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [donationItem("mia"), donationItem("ajena", OTHER_SUB)] });

    const response = await listMyDonations(meEvent());

    const items = bodyOf(response).items as Record<string, unknown>[];
    expect(items.map((item) => item.donationId)).toEqual(["mia"]);
    expect(response.body).not.toContain("donorSub");
    expect(response.body).not.toContain("idempotencyKey");
    expect(response.body).not.toContain("payloadHash");
  });

  it("sin donaciones responde 200 con items vacío", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const response = await listMyDonations(meEvent());

    expect(bodyOf(response)).toEqual({ items: [] });
  });

  it("CA-04.2: un GESTOR con el scope de donaciones no puede ver historiales: 403", async () => {
    const response = await listMyDonations(meEvent({ user: { ...GESTOR, scopes: ["api/donations.*"] } }));

    expect(response.statusCode).toBe(403);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it("sin token responde 401", async () => {
    const response = await listMyDonations(apiEvent({ routeKey: "GET /v1/donations/me" }));

    expect(response.statusCode).toBe(401);
  });
});

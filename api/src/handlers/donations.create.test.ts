import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent, bodyOf, DONANTE, GESTOR } from "../test-utils/events.js";
import { handler as createDonation } from "./createDonation.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b";
const VALID_BODY = { projectId: PROJECT_ID, amountCents: 2_550 };

function projectItem(status: "BORRADOR" | "PUBLICADO") {
  return {
    pk: `PROJECT#${PROJECT_ID}`,
    projectId: PROJECT_ID,
    title: "Comedor comunitario Puentes",
    description: "Raciones diarias para 40 familias del escenario de prueba",
    goalAmountCents: 1_500_000,
    confirmedAmountCents: 12_500,
    currency: "PEN",
    status,
    createdAt: "2026-11-08T09:00:00.000Z",
    updatedAt: "2026-11-08T10:00:00.000Z",
  };
}

function donateEvent(
  body: unknown,
  options: { key?: string | null; user?: typeof DONANTE } = {},
) {
  const key = options.key === undefined ? KEY : options.key;
  return apiEvent({
    routeKey: "POST /v1/donations",
    body,
    headers: key === null ? {} : { "idempotency-key": key },
    user: options.user ?? DONANTE,
  });
}

function mockPublishedProject() {
  ddbMock.on(GetCommand, { TableName: "projects-test" }).resolves({ Item: projectItem("PUBLICADO") });
}

function mockNoIdempotencyRecord() {
  ddbMock.on(GetCommand, { TableName: "idempotency-test" }).resolves({});
}

/** Ítems de la transacción de la primera llamada a TransactWrite. */
function transactItems() {
  return ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
}

/** El registro de idempotencia que escribió la transacción, para simular una segunda solicitud. */
function writtenIdempotencyItem() {
  return transactItems()[1]?.Put?.Item;
}

function cancelled(codes: string[]) {
  return Object.assign(new Error("Transaction cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

beforeEach(() => {
  ddbMock.reset();
  process.env.PROJECTS_TABLE = "projects-test";
  process.env.DONATIONS_TABLE = "donations-test";
  process.env.IDEMPOTENCY_TABLE = "idempotency-test";
  process.env.AUDIT_TABLE = "audit-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("POST /v1/donations (HU-05)", () => {
  describe("T05: intención válida", () => {
    beforeEach(() => {
      mockNoIdempotencyRecord();
      mockPublishedProject();
      ddbMock.on(TransactWriteCommand).resolves({});
    });

    it("responde 201 con la donación en PENDIENTE_SIMULACION (CA-05.1)", async () => {
      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(201);
      expect(bodyOf(response)).toEqual({
        donationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        projectId: PROJECT_ID,
        projectTitle: "Comedor comunitario Puentes",
        amountCents: 2_550,
        currency: "PEN",
        status: "PENDIENTE_SIMULACION",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("CA-05.3: guarda el donorSub del token y no lo devuelve en la respuesta", async () => {
      const response = await createDonation(donateEvent(VALID_BODY));

      expect(transactItems()[0]?.Put?.Item).toMatchObject({
        donorSub: DONANTE.claims.sub,
        gsi1pk: `DONOR#${DONANTE.claims.sub}`,
        status: "PENDIENTE_SIMULACION",
      });
      expect(response.body).not.toContain(DONANTE.claims.sub);
      expect(bodyOf(response)).not.toHaveProperty("idempotencyKey");
      expect(bodyOf(response)).not.toHaveProperty("payloadHash");
    });

    it("sin cargo ni cambio del acumulado: el proyecto solo se verifica, no se modifica (CA-05.2)", async () => {
      await createDonation(donateEvent(VALID_BODY));

      const items = transactItems();
      expect(items[2]?.ConditionCheck).toMatchObject({
        TableName: "projects-test",
        Key: { pk: `PROJECT#${PROJECT_ID}` },
        ExpressionAttributeValues: { ":published": "PUBLICADO" },
      });
      expect(items.some((item) => item.Update)).toBe(false);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("escribe donación, clave de idempotencia (24 h) y auditoría en una sola transacción", async () => {
      const before = Math.floor(Date.now() / 1000);
      await createDonation(donateEvent(VALID_BODY));

      const [donation, idempotency, , audit] = transactItems();
      expect(donation?.Put?.ConditionExpression).toBe("attribute_not_exists(pk)");
      expect(idempotency?.Put).toMatchObject({
        TableName: "idempotency-test",
        Item: { pk: `IDEMP#${DONANTE.claims.sub}#${KEY}`, payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
        ConditionExpression: "attribute_not_exists(pk) OR expiresAt <= :now",
      });
      const expiresAt = idempotency?.Put?.Item?.expiresAt as number;
      expect(expiresAt - before).toBeGreaterThanOrEqual(24 * 60 * 60);
      expect(expiresAt - before).toBeLessThanOrEqual(24 * 60 * 60 + 5);
      expect(audit?.Put?.Item).toMatchObject({ action: "DONATION_CREATE", outcome: "SUCCESS" });
    });

    it.each([100, 100_000])("acepta los límites: %i céntimos", async (amountCents) => {
      const response = await createDonation(donateEvent({ projectId: PROJECT_ID, amountCents }));

      expect(response.statusCode).toBe(201);
    });
  });

  describe("T04: montos fuera de rango (CA-05.2)", () => {
    it.each([
      ["S/ 0", 0],
      ["S/ 1000.01", 100_001],
      ["un monto negativo", -100],
      ["más de dos decimales", 250.5],
    ])("%s responde 400 sin leer ni escribir en la base", async (_caso, amountCents) => {
      const response = await createDonation(donateEvent({ projectId: PROJECT_ID, amountCents }));

      expect(response.statusCode).toBe(400);
      expect(bodyOf(response).code).toBe("VALIDATION_ERROR");
      expect(bodyOf(response).message).toContain("amountCents");
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });
  });

  describe("T06 y T07: idempotencia (CA-05.4)", () => {
    it("T06: misma clave y mismo cuerpo devuelven la misma respuesta y una sola donación", async () => {
      mockNoIdempotencyRecord();
      mockPublishedProject();
      ddbMock.on(TransactWriteCommand).resolves({});
      const first = await createDonation(donateEvent(VALID_BODY));

      // La segunda solicitud encuentra el registro que escribió la primera.
      const stored = writtenIdempotencyItem();
      ddbMock.on(GetCommand, { TableName: "idempotency-test" }).resolves({ Item: stored });
      const second = await createDonation(donateEvent(VALID_BODY));

      expect(second.statusCode).toBe(201);
      expect(second.body).toBe(first.body);
      expect(second.headers?.["idempotent-replayed"]).toBe("true");
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    });

    it("T06: el orden de los campos del cuerpo no cambia el resultado", async () => {
      mockNoIdempotencyRecord();
      mockPublishedProject();
      ddbMock.on(TransactWriteCommand).resolves({});
      const first = await createDonation(donateEvent(VALID_BODY));

      ddbMock
        .on(GetCommand, { TableName: "idempotency-test" })
        .resolves({ Item: writtenIdempotencyItem() });
      const reordered = await createDonation(
        donateEvent({ amountCents: VALID_BODY.amountCents, projectId: VALID_BODY.projectId }),
      );

      expect(reordered.statusCode).toBe(201);
      expect(bodyOf(reordered).donationId).toBe(bodyOf(first).donationId);
    });

    it("T07: misma clave con otro monto responde 409 y no crea otra donación", async () => {
      mockNoIdempotencyRecord();
      mockPublishedProject();
      ddbMock.on(TransactWriteCommand).resolves({});
      await createDonation(donateEvent(VALID_BODY));

      ddbMock
        .on(GetCommand, { TableName: "idempotency-test" })
        .resolves({ Item: writtenIdempotencyItem() });
      const altered = await createDonation(donateEvent({ ...VALID_BODY, amountCents: 99_900 }));

      expect(altered.statusCode).toBe(409);
      expect(bodyOf(altered)).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
      expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
        action: "DONATION_CREATE",
        outcome: "REJECTED",
        reason: "IDEMPOTENCY_KEY_REUSED",
      });
    });

    it("la clave es por usuario: otro donante con la misma clave consulta otro registro", async () => {
      mockNoIdempotencyRecord();
      mockPublishedProject();
      ddbMock.on(TransactWriteCommand).resolves({});
      const otherDonor = {
        ...DONANTE,
        claims: { ...DONANTE.claims, sub: "33333333-3333-4333-8333-333333333333" },
      };

      await createDonation(donateEvent(VALID_BODY, { user: otherDonor }));

      expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input.Key).toEqual({
        pk: `IDEMP#${otherDonor.claims.sub}#${KEY}`,
      });
    });

    it("un registro vencido que el TTL aún no borró se trata como clave nueva", async () => {
      const expired = {
        pk: `IDEMP#${DONANTE.claims.sub}#${KEY}`,
        donationId: "old",
        payloadHash: "otro-hash",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        response: {},
      };
      ddbMock.on(GetCommand, { TableName: "idempotency-test" }).resolves({ Item: expired });
      mockPublishedProject();
      ddbMock.on(TransactWriteCommand).resolves({});

      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(201);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    });

    it("dos solicitudes simultáneas con la misma clave: la que pierde responde como repetición", async () => {
      mockPublishedProject();
      const winner = {
        pk: `IDEMP#${DONANTE.claims.sub}#${KEY}`,
        donationId: "ganadora",
        payloadHash: "",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        response: { donationId: "ganadora", projectId: PROJECT_ID, amountCents: 2_550 },
      };
      // Primera lectura: aún no existe. Tras perder la transacción, ya existe.
      ddbMock
        .on(GetCommand, { TableName: "idempotency-test" })
        .resolvesOnce({})
        .callsFake(() => ({ Item: { ...winner, payloadHash: writtenIdempotencyItem()?.payloadHash } }));
      ddbMock
        .on(TransactWriteCommand)
        .rejects(cancelled(["None", "ConditionalCheckFailed", "None", "None"]));

      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(201);
      expect(bodyOf(response).donationId).toBe("ganadora");
      expect(response.headers?.["idempotent-replayed"]).toBe("true");
    });

    it("si la transacción ganadora aún no se confirma, responde 409 IDEMPOTENCY_KEY_IN_PROGRESS", async () => {
      mockNoIdempotencyRecord();
      mockPublishedProject();
      ddbMock
        .on(TransactWriteCommand)
        .rejects(cancelled(["None", "TransactionConflict", "None", "None"]));

      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("IDEMPOTENCY_KEY_IN_PROGRESS");
    });
  });

  describe("proyecto no elegible (CA-05.2, CA-08.2)", () => {
    beforeEach(() => mockNoIdempotencyRecord());

    it("un proyecto en BORRADOR responde 409 PROJECT_NOT_ELIGIBLE", async () => {
      ddbMock.on(GetCommand, { TableName: "projects-test" }).resolves({ Item: projectItem("BORRADOR") });

      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("PROJECT_NOT_ELIGIBLE");
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("un proyecto inexistente responde el mismo 409", async () => {
      ddbMock.on(GetCommand, { TableName: "projects-test" }).resolves({});

      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("PROJECT_NOT_ELIGIBLE");
    });

    it("si el proyecto deja de estar publicado durante la transacción, responde 409", async () => {
      mockPublishedProject();
      ddbMock
        .on(TransactWriteCommand)
        .rejects(cancelled(["None", "None", "ConditionalCheckFailed", "None"]));

      const response = await createDonation(donateEvent(VALID_BODY));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("PROJECT_NOT_ELIGIBLE");
    });
  });

  describe("entradas y permisos", () => {
    it("sin Idempotency-Key responde 400 INVALID_IDEMPOTENCY_KEY", async () => {
      const response = await createDonation(donateEvent(VALID_BODY, { key: null }));

      expect(response.statusCode).toBe(400);
      expect(bodyOf(response).code).toBe("INVALID_IDEMPOTENCY_KEY");
    });

    it("CA-05.3: un donorSub en el cuerpo responde 400", async () => {
      const response = await createDonation(
        donateEvent({ ...VALID_BODY, donorSub: "33333333-3333-4333-8333-333333333333" }),
      );

      expect(response.statusCode).toBe(400);
      expect(bodyOf(response).message).toContain("donorSub");
    });

    it("CA-05.5: datos de tarjeta en el cuerpo responden 400", async () => {
      const response = await createDonation(
        donateEvent({ ...VALID_BODY, cardNumber: "4111111111111111", cvv: "123" }),
      );

      expect(response.statusCode).toBe(400);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("un GESTOR con el scope de donaciones recibe 403 por rol", async () => {
      const gestorWithScope = { ...GESTOR, scopes: ["api/donations.*"] };

      const response = await createDonation(donateEvent(VALID_BODY, { user: gestorWithScope }));

      expect(response.statusCode).toBe(403);
      expect(bodyOf(response).code).toBe("FORBIDDEN_ROLE");
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("sin token responde 401", async () => {
      const response = await createDonation(
        apiEvent({ routeKey: "POST /v1/donations", body: VALID_BODY, headers: { "idempotency-key": KEY } }),
      );

      expect(response.statusCode).toBe(401);
    });
  });
});

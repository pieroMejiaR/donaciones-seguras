import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent, bodyOf, DONANTE, GESTOR } from "../test-utils/events.js";
import { handler as simulateDonation } from "./simulateDonation.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const DONATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function donationItem(status = "PENDIENTE_SIMULACION", donorSub = DONANTE.claims.sub) {
  return {
    pk: `DONATION#${DONATION_ID}`,
    gsi1pk: `DONOR#${donorSub}`,
    donationId: DONATION_ID,
    projectId: PROJECT_ID,
    projectTitle: "Comedor comunitario Puentes",
    amountCents: 2_550,
    currency: "PEN",
    status,
    donorSub,
    idempotencyKey: "6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b",
    payloadHash: "a".repeat(64),
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
  };
}

function simulateEvent(outcome: unknown, options: { id?: string; user?: typeof DONANTE } = {}) {
  return apiEvent({
    routeKey: "POST /v1/donations/{id}/simulate",
    pathParameters: { id: options.id ?? DONATION_ID },
    body: { outcome },
    user: options.user ?? DONANTE,
  });
}

function cancelled(codes: string[]) {
  return Object.assign(new Error("Transaction cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

function transactItems(call = 0) {
  return ddbMock.commandCalls(TransactWriteCommand)[call]?.args[0].input.TransactItems ?? [];
}

beforeEach(() => {
  ddbMock.reset();
  process.env.STAGE = "academic";
  process.env.PROJECTS_TABLE = "projects-test";
  process.env.DONATIONS_TABLE = "donations-test";
  process.env.AUDIT_TABLE = "audit-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.STAGE;
});

describe("POST /v1/donations/{id}/simulate (HU-06)", () => {
  describe("transición válida", () => {
    beforeEach(() => {
      ddbMock.on(GetCommand).resolves({ Item: donationItem() });
      ddbMock.on(TransactWriteCommand).resolves({});
    });

    it("confirmar responde 200 CONFIRMADA_SIMULADA y suma el monto al acumulado una vez", async () => {
      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(response.statusCode).toBe(200);
      expect(bodyOf(response)).toMatchObject({ donationId: DONATION_ID, status: "CONFIRMADA_SIMULADA" });
      expect(bodyOf(response)).not.toHaveProperty("donorSub");

      const [donation, project, audit] = transactItems();
      expect(donation?.Update).toMatchObject({
        Key: { pk: `DONATION#${DONATION_ID}` },
        ConditionExpression: "#status = :pending AND donorSub = :donorSub",
        ExpressionAttributeValues: expect.objectContaining({
          ":outcome": "CONFIRMADA_SIMULADA",
          ":pending": "PENDIENTE_SIMULACION",
          ":donorSub": DONANTE.claims.sub,
        }),
      });
      expect(project?.Update).toMatchObject({
        Key: { pk: `PROJECT#${PROJECT_ID}` },
        UpdateExpression: "SET updatedAt = :now ADD confirmedAmountCents :amount",
        ExpressionAttributeValues: expect.objectContaining({ ":amount": 2_550 }),
      });
      expect(audit?.Put?.Item).toMatchObject({ action: "DONATION_SIMULATE", outcome: "SUCCESS" });
    });

    it("CA-06.3: rechazar no toca el acumulado del proyecto", async () => {
      const response = await simulateDonation(simulateEvent("RECHAZADA_SIMULADA"));

      expect(response.statusCode).toBe(200);
      expect(bodyOf(response).status).toBe("RECHAZADA_SIMULADA");
      const items = transactItems();
      expect(items).toHaveLength(2);
      expect(items.some((item) => item.Update?.TableName === "projects-test")).toBe(false);
    });
  });

  describe("T08: confirmar dos veces la misma donación (CA-06.2, CA-NF04.1)", () => {
    it("una donación ya confirmada responde 409 y no vuelve a escribir", async () => {
      ddbMock.on(GetCommand).resolves({ Item: donationItem("CONFIRMADA_SIMULADA") });

      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("DONATION_ALREADY_FINALIZED");
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("10 confirmaciones en paralelo: un 200, nueve 409 y un solo incremento del acumulado", async () => {
      // DynamoDB simulado en memoria: aplica la condición de estado como lo haría la tabla.
      const state = { status: "PENDIENTE_SIMULACION", confirmedAmountCents: 12_500 };
      ddbMock.on(GetCommand).callsFake(async () => ({ Item: donationItem(state.status) }));
      ddbMock.on(TransactWriteCommand).callsFake(async (input) => {
        // Las 10 solicitudes ya leyeron "pendiente" antes de que llegue la primera escritura.
        await new Promise((resolve) => setTimeout(resolve, 10));
        const [donation, project] = input.TransactItems;
        const guarded = donation.Update.ConditionExpression?.includes("#status = :pending");
        if (guarded && state.status !== donation.Update.ExpressionAttributeValues[":pending"]) {
          throw cancelled(["ConditionalCheckFailed", "None", "None"]);
        }
        state.status = donation.Update.ExpressionAttributeValues[":outcome"];
        if (project?.Update) {
          state.confirmedAmountCents += project.Update.ExpressionAttributeValues[":amount"];
        }
        return {};
      });

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"))),
      );

      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      expect(state.confirmedAmountCents).toBe(12_500 + 2_550);
      // Las 10 llegaron a escribir: lo que impide el doble conteo es la condición, no la lectura previa.
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(10);
      for (const response of responses.filter((r) => r.statusCode === 409)) {
        expect(bodyOf(response).code).toBe("DONATION_ALREADY_FINALIZED");
      }
    });

    it("si otra solicitud la finaliza entre la lectura y la escritura, responde 409", async () => {
      ddbMock.on(GetCommand).resolves({ Item: donationItem() });
      ddbMock.on(TransactWriteCommand).rejects(cancelled(["ConditionalCheckFailed", "None", "None"]));

      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("DONATION_ALREADY_FINALIZED");
      expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
        action: "DONATION_SIMULATE",
        outcome: "REJECTED",
        reason: "DONATION_ALREADY_FINALIZED",
      });
    });
  });

  describe("contención con otras confirmaciones del mismo proyecto", () => {
    it("reintenta tras un TransactionConflict y aplica la transición", async () => {
      ddbMock.on(GetCommand).resolves({ Item: donationItem() });
      ddbMock
        .on(TransactWriteCommand)
        .rejectsOnce(cancelled(["None", "TransactionConflict", "None"]))
        .resolves({});

      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(response.statusCode).toBe(200);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(2);
    });

    it("si la contención persiste, responde 409 DONATION_SIMULATION_IN_PROGRESS tras 3 intentos", async () => {
      ddbMock.on(GetCommand).resolves({ Item: donationItem() });
      ddbMock.on(TransactWriteCommand).rejects(cancelled(["None", "TransactionConflict", "None"]));

      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(response.statusCode).toBe(409);
      expect(bodyOf(response).code).toBe("DONATION_SIMULATION_IN_PROGRESS");
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(3);
    });
  });

  describe("ownership, entradas y permisos", () => {
    it("CA-07.2: una donación de otro donante responde el mismo 404 que una inexistente", async () => {
      const otherSub = "33333333-3333-4333-8333-333333333333";
      ddbMock.on(GetCommand).resolvesOnce({ Item: donationItem("PENDIENTE_SIMULACION", otherSub) }).resolves({});

      const foreign = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));
      const missing = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).toBe(missing.body);
      expect(foreign.body).not.toContain(otherSub);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("CA-06.1: solo admite estados terminales; PENDIENTE_SIMULACION responde 400", async () => {
      const response = await simulateDonation(simulateEvent("PENDIENTE_SIMULACION"));

      expect(response.statusCode).toBe(400);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });

    it("un id mal formado responde 404 sin leer la tabla", async () => {
      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA", { id: "x' OR 1=1" }));

      expect(response.statusCode).toBe(404);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    });

    it("un GESTOR con el scope de donaciones recibe 403", async () => {
      const response = await simulateDonation(
        simulateEvent("CONFIRMADA_SIMULADA", { user: { ...GESTOR, scopes: ["api/donations.*"] } }),
      );

      expect(response.statusCode).toBe(403);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it("CA-06.1: fuera del stage academic responde 404 sin tocar la base", async () => {
      process.env.STAGE = "dev";

      const response = await simulateDonation(simulateEvent("CONFIRMADA_SIMULADA"));

      expect(response.statusCode).toBe(404);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });
  });
});

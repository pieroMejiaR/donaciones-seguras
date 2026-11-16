import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiEvent,
  AUDITOR,
  AUDITOR_SIN_MFA,
  bodyOf,
  DONANTE,
  GESTOR,
  type TestUser,
} from "../test-utils/events.js";
import { handler as listAuditEvents } from "./listAuditEvents.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

function auditItem(eventId: string, action: string, timestamp: string, outcome = "SUCCESS") {
  return {
    pk: `EVENT#${eventId}`,
    gsi1pk: `ACTION#${action}`,
    gsi1sk: `${timestamp}#${eventId}`,
    eventId,
    timestamp,
    requestId: `req-${eventId}`,
    actorRef: "usr_0123456789abcdef",
    action,
    resourceRef: "project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    outcome,
    ...(outcome === "SUCCESS" ? {} : { reason: "FORBIDDEN_ROLE" }),
  };
}

const auditEvent = (options: { user?: TestUser; query?: Record<string, string> } = {}) =>
  apiEvent({
    routeKey: "GET /v1/audit",
    user: options.user ?? AUDITOR,
    queryStringParameters: options.query,
  });

function queries() {
  return ddbMock.commandCalls(QueryCommand).map((call) => call.args[0].input);
}

beforeEach(() => {
  ddbMock.reset();
  process.env.AUDIT_TABLE = "audit-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("GET /v1/audit (HU-10)", () => {
  it("CA-10.1: un AUDITOR con MFA recibe los eventos de todas las acciones, más recientes primero", async () => {
    const byAction: Record<string, Record<string, unknown>[]> = {
      "ACTION#PROJECT_CREATE": [auditItem("e1", "PROJECT_CREATE", "2026-11-10T10:00:00.000Z")],
      "ACTION#DONATION_SIMULATE": [auditItem("e2", "DONATION_SIMULATE", "2026-11-12T10:00:00.000Z")],
    };
    ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues: Record<string, string> }) => ({
      Items: byAction[input.ExpressionAttributeValues[":action"] ?? ""] ?? [],
    }));

    const response = await listAuditEvents(auditEvent());

    expect(response.statusCode).toBe(200);
    const items = bodyOf(response).items as Record<string, unknown>[];
    expect(items.map((item) => item.eventId)).toEqual(["e2", "e1"]);
    // Una consulta por acción sobre el índice, nunca un Scan (RNF-HU-05).
    expect(queries()).toHaveLength(4);
    expect(queries().every((input) => input.IndexName === "gsi1")).toBe(true);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  it("CA-10.1: filtra por tipo y por rango de fechas en la condición de clave", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const response = await listAuditEvents(
      auditEvent({
        query: { type: "DONATION_CREATE", from: "2026-11-01T00:00:00Z", to: "2026-11-15T23:59:59Z" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(queries()).toEqual([
      expect.objectContaining({
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :action AND gsi1sk BETWEEN :from AND :to",
        ExpressionAttributeValues: {
          ":action": "ACTION#DONATION_CREATE",
          ":from": "2026-11-01T00:00:00.000Z",
          ":to": "2026-11-15T23:59:59.000Z#￿",
        },
        ScanIndexForward: false,
      }),
    ]);
  });

  it("CA-10.2: cada evento trae solo timestamp, requestId, actor seudonimizado, recurso, acción y resultado", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ ...auditItem("e3", "PROJECT_CREATE", "2026-11-10T10:00:00.000Z", "DENIED"), token: "eyJ..." }],
    });

    const response = await listAuditEvents(auditEvent({ query: { type: "PROJECT_CREATE" } }));

    const [item] = bodyOf(response).items as Record<string, unknown>[];
    expect(item).toEqual({
      eventId: "e3",
      timestamp: "2026-11-10T10:00:00.000Z",
      requestId: "req-e3",
      actorRef: "usr_0123456789abcdef",
      action: "PROJECT_CREATE",
      resourceRef: "project/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      outcome: "DENIED",
      reason: "FORBIDDEN_ROLE",
    });
  });

  it("respeta el límite pedido aunque varias acciones devuelvan eventos", async () => {
    ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues: Record<string, string> }) => ({
      Items: [auditItem(input.ExpressionAttributeValues[":action"] ?? "x", "PROJECT_CREATE", "2026-11-10T10:00:00.000Z")],
    }));

    const response = await listAuditEvents(auditEvent({ query: { limit: "2" } }));

    expect(bodyOf(response).items).toHaveLength(2);
    expect(queries().every((input) => input.Limit === 2)).toBe(true);
  });

  it("T14: un AUDITOR sin TOTP MFA recibe 403 MFA_REQUIRED y no se consulta la tabla", async () => {
    const response = await listAuditEvents(auditEvent({ user: AUDITOR_SIN_MFA }));

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ code: "MFA_REQUIRED" });
    expect(queries()).toHaveLength(0);
  });

  it("CA-10.1: un DONANTE o un GESTOR no obtienen eventos de auditoría", async () => {
    const donante = await listAuditEvents(auditEvent({ user: DONANTE }));
    const gestor = await listAuditEvents(auditEvent({ user: GESTOR }));

    expect(donante.statusCode).toBe(403);
    expect(gestor.statusCode).toBe(403);
    expect(queries()).toHaveLength(0);
  });

  it("CA-10.1: un DONANTE con el scope api/audit.read recibe 403 por rol", async () => {
    const response = await listAuditEvents(
      auditEvent({ user: { ...DONANTE, scopes: ["api/audit.read"] } }),
    );

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it.each([
    ["un tipo desconocido", { type: "LOGIN" }],
    ["una fecha que no es ISO 8601", { from: "ayer" }],
    ["un límite fuera de rango", { limit: "500" }],
    ["un parámetro que no existe", { actorRef: "usr_0123456789abcdef" }],
  ])("responde 400 con %s", async (_caso, query) => {
    const response = await listAuditEvents(auditEvent({ query }));

    expect(response.statusCode).toBe(400);
    expect(queries()).toHaveLength(0);
  });

  it("responde 400 si la fecha inicial es posterior a la final", async () => {
    const response = await listAuditEvents(
      auditEvent({ query: { from: "2026-11-15T00:00:00Z", to: "2026-11-01T00:00:00Z" } }),
    );

    expect(response.statusCode).toBe(400);
    expect(bodyOf(response)).toMatchObject({ code: "INVALID_DATE_RANGE" });
  });

  it("sin claims del authorizer responde 401", async () => {
    const response = await listAuditEvents(apiEvent({ routeKey: "GET /v1/audit" }));

    expect(response.statusCode).toBe(401);
  });
});

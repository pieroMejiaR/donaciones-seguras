import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pseudonymize } from "../audit/audit.js";
import { apiEvent, bodyOf, DONANTE, GESTOR } from "../test-utils/events.js";
import { handler as createProject } from "./createProject.js";
import { handler as publishProject } from "./publishProject.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const VALID_BODY = {
  title: "Comedor comunitario Puentes",
  description: "Raciones diarias para 40 familias del escenario de prueba",
  goalAmountCents: 1_500_000,
};

const DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function storedProject(status: "BORRADOR" | "PUBLICADO") {
  return {
    pk: `PROJECT#${DRAFT_ID}`,
    gsi1pk: `STATUS#${status}`,
    gsi1sk: `2026-11-08T09:00:00.000Z#${DRAFT_ID}`,
    projectId: DRAFT_ID,
    ...VALID_BODY,
    confirmedAmountCents: 0,
    currency: "PEN",
    status,
    createdAt: "2026-11-08T09:00:00.000Z",
    updatedAt: "2026-11-08T09:00:00.000Z",
  };
}

/** Eventos de auditoría escritos fuera de una transacción (intentos fallidos). */
function failedAuditEvents() {
  return ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item);
}

beforeEach(() => {
  ddbMock.reset();
  process.env.PROJECTS_TABLE = "projects-test";
  process.env.AUDIT_TABLE = "audit-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("POST /v1/projects (HU-08)", () => {
  const createEvent = (body: unknown, user = GESTOR) =>
    apiEvent({ routeKey: "POST /v1/projects", body, user });

  it("CA-08.1: un GESTOR crea un proyecto en BORRADOR con acumulado 0 y responde 201", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const response = await createProject(createEvent(VALID_BODY));

    expect(response.statusCode).toBe(201);
    const project = bodyOf(response);
    expect(project).toMatchObject({
      ...VALID_BODY,
      projectId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      confirmedAmountCents: 0,
      currency: "PEN",
      status: "BORRADOR",
    });
    expect(project).not.toHaveProperty("pk");
  });

  it("CA-08.3: escribe el proyecto y su evento de auditoría en la misma transacción", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const response = await createProject(createEvent(VALID_BODY));
    const projectId = bodyOf(response).projectId as string;

    const [projectPut, auditPut] =
      ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
    expect(projectPut?.Put).toMatchObject({
      TableName: "projects-test",
      Item: { pk: `PROJECT#${projectId}`, gsi1pk: "STATUS#BORRADOR", status: "BORRADOR" },
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(auditPut?.Put).toMatchObject({
      TableName: "audit-test",
      Item: {
        action: "PROJECT_CREATE",
        outcome: "SUCCESS",
        actorRef: pseudonymize(GESTOR.claims.sub),
        resourceRef: `project/${projectId}`,
        requestId: "req-test-0001",
      },
    });
    // El evento usa un seudónimo: el sub real no se guarda en auditoría.
    expect(JSON.stringify(auditPut)).not.toContain(GESTOR.claims.sub);
  });

  it("recorta los espacios de los extremos del título", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const response = await createProject(
      createEvent({ ...VALID_BODY, title: "   Biblioteca rural   " }),
    );

    expect(bodyOf(response).title).toBe("Biblioteca rural");
  });

  it("T03: un DONANTE con token válido recibe 403 y no se escribe ningún proyecto", async () => {
    const response = await createProject(createEvent(VALID_BODY, DONANTE));

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  // Cognito concede cualquier scope del app client a quien lo pida: un DONANTE puede obtener
  // api/projects.write y pasar el JWT authorizer. El rol en Lambda es el control que lo detiene.
  it("T03: un DONANTE con el scope api/projects.write recibe 403 por rol y queda auditado DENIED", async () => {
    const response = await createProject(
      createEvent(VALID_BODY, { ...DONANTE, scopes: ["api/projects.write"] }),
    );

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ code: "FORBIDDEN_ROLE" });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(failedAuditEvents()).toEqual([
      expect.objectContaining({
        action: "PROJECT_CREATE",
        outcome: "DENIED",
        reason: "FORBIDDEN_ROLE",
        actorRef: pseudonymize(DONANTE.claims.sub),
      }),
    ]);
  });

  it("CA-NF02.2: rechaza con 400 campos que decide el servidor (status, acumulado, rol)", async () => {
    const response = await createProject(
      createEvent({
        ...VALID_BODY,
        status: "PUBLICADO",
        confirmedAmountCents: 9_999_999,
        role: "GESTOR",
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(bodyOf(response)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(bodyOf(response).message).toContain("status");
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(failedAuditEvents()[0]).toMatchObject({ outcome: "REJECTED", reason: "VALIDATION_ERROR" });
  });

  it.each([
    ["la meta es cero", { goalAmountCents: 0 }],
    ["la meta es negativa", { goalAmountCents: -100 }],
    ["la meta tiene fracción de céntimo", { goalAmountCents: 1500.5 }],
    ["la meta llega como texto", { goalAmountCents: "1500000" }],
    ["el título solo tiene espacios", { title: "   " }],
    ["falta la descripción", { description: undefined }],
  ])("CA-08.1: responde 400 si %s", async (_caso, override) => {
    const response = await createProject(createEvent({ ...VALID_BODY, ...override }));

    expect(response.statusCode).toBe(400);
    expect(bodyOf(response).code).toBe("VALIDATION_ERROR");
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("responde 400 INVALID_JSON con un cuerpo que no es JSON", async () => {
    const response = await createProject(
      apiEvent({ routeKey: "POST /v1/projects", rawBody: "{title:", user: GESTOR }),
    );

    expect(response.statusCode).toBe(400);
    expect(bodyOf(response).code).toBe("INVALID_JSON");
  });

  it("sin claims del authorizer responde 401", async () => {
    const response = await createProject(
      apiEvent({ routeKey: "POST /v1/projects", body: VALID_BODY }),
    );

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/projects/{id}/publish (HU-08)", () => {
  const publishEvent = (id: string, user = GESTOR) =>
    apiEvent({ routeKey: "POST /v1/projects/{id}/publish", pathParameters: { id }, user });

  it("CA-08.2: un GESTOR publica un BORRADOR y responde 200 con el proyecto PUBLICADO", async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedProject("BORRADOR") });
    ddbMock.on(TransactWriteCommand).resolves({});

    const response = await publishProject(publishEvent(DRAFT_ID));

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      projectId: DRAFT_ID,
      status: "PUBLICADO",
      publishedAt: expect.any(String),
    });
    expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input.ConsistentRead).toBe(true);
  });

  it("condiciona la transición al estado BORRADOR y la audita en la misma transacción", async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedProject("BORRADOR") });
    ddbMock.on(TransactWriteCommand).resolves({});

    await publishProject(publishEvent(DRAFT_ID));

    const [update, audit] =
      ddbMock.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
    expect(update?.Update).toMatchObject({
      Key: { pk: `PROJECT#${DRAFT_ID}` },
      ConditionExpression: "attribute_exists(pk) AND #status = :draft",
      ExpressionAttributeValues: expect.objectContaining({
        ":draft": "BORRADOR",
        ":published": "PUBLICADO",
        ":gsi1pk": "STATUS#PUBLICADO",
      }),
    });
    expect(audit?.Put?.Item).toMatchObject({
      action: "PROJECT_PUBLISH",
      outcome: "SUCCESS",
      resourceRef: `project/${DRAFT_ID}`,
    });
  });

  it("un proyecto ya PUBLICADO responde 409 y no se vuelve a escribir", async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedProject("PUBLICADO") });

    const response = await publishProject(publishEvent(DRAFT_ID));

    expect(response.statusCode).toBe(409);
    expect(bodyOf(response)).toMatchObject({ code: "PROJECT_ALREADY_PUBLISHED" });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(failedAuditEvents()[0]).toMatchObject({
      action: "PROJECT_PUBLISH",
      outcome: "REJECTED",
      reason: "PROJECT_ALREADY_PUBLISHED",
    });
  });

  it("si otro gestor lo publica a la vez, la condición falla y responde 409", async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedProject("BORRADOR") });
    const cancelled = Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
    });
    ddbMock.on(TransactWriteCommand).rejects(cancelled);

    const response = await publishProject(publishEvent(DRAFT_ID));

    expect(response.statusCode).toBe(409);
    expect(bodyOf(response).code).toBe("PROJECT_ALREADY_PUBLISHED");
  });

  it("un id inexistente responde 404", async () => {
    ddbMock.on(GetCommand).resolves({});

    const response = await publishProject(publishEvent(DRAFT_ID));

    expect(response.statusCode).toBe(404);
    expect(bodyOf(response).code).toBe("PROJECT_NOT_FOUND");
  });

  it("un id mal formado responde 404 y queda como 'invalid' en auditoría", async () => {
    const response = await publishProject(publishEvent("<script>"));

    expect(response.statusCode).toBe(404);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(failedAuditEvents()[0]).toMatchObject({ resourceRef: "project/invalid" });
  });

  it("T03: un DONANTE no puede publicar: 403 sin leer ni escribir el proyecto", async () => {
    const response = await publishProject(publishEvent(DRAFT_ID, DONANTE));

    expect(response.statusCode).toBe(403);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("si falla la escritura del evento de un intento fallido, responde el error original", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ddbMock.on(GetCommand).resolves({ Item: storedProject("PUBLICADO") });
    ddbMock.on(PutCommand).rejects(new Error("audit table unavailable"));

    const response = await publishProject(publishEvent(DRAFT_ID));

    expect(response.statusCode).toBe(409);
  });
});

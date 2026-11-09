import { GetCommand, QueryCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiEvent, bodyOf } from "../test-utils/events.js";
import { handler as getProject } from "./getProject.js";
import { handler as getStats } from "./getStats.js";
import { handler as listProjects } from "./listProjects.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

const PUBLISHED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function projectItem(id: string, status: "BORRADOR" | "PUBLICADO", amounts = { goal: 500_000, confirmed: 12_500 }) {
  return {
    pk: `PROJECT#${id}`,
    gsi1pk: `STATUS#${status}`,
    gsi1sk: `2026-11-08T10:00:00.000Z#${id}`,
    projectId: id,
    title: `Proyecto ${id.slice(0, 4)}`,
    description: "Útiles escolares para la comunidad de prueba",
    goalAmountCents: amounts.goal,
    confirmedAmountCents: amounts.confirmed,
    currency: "PEN",
    status,
    createdAt: "2026-11-08T09:00:00.000Z",
    updatedAt: "2026-11-08T10:00:00.000Z",
    ...(status === "PUBLICADO" ? { publishedAt: "2026-11-08T10:00:00.000Z" } : {}),
  };
}

beforeEach(() => {
  ddbMock.reset();
  process.env.PROJECTS_TABLE = "projects-test";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("GET /v1/projects (HU-01)", () => {
  it("T01: un visitante sin token recibe 200 solo con proyectos PUBLICADO (CA-01.1, CA-01.2)", async () => {
    // El índice ya separa por estado; se incluye un BORRADOR para probar la defensa en profundidad.
    ddbMock.on(QueryCommand).resolves({
      Items: [projectItem(PUBLISHED_ID, "PUBLICADO"), projectItem(DRAFT_ID, "BORRADOR")],
    });

    const response = await listProjects(apiEvent({ routeKey: "GET /v1/projects" }));

    expect(response.statusCode).toBe(200);
    const items = bodyOf(response).items as Record<string, unknown>[];
    expect(items.map((p) => p.projectId)).toEqual([PUBLISHED_ID]);
    expect(items[0]).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      goalAmountCents: 500_000,
      confirmedAmountCents: 12_500,
      currency: "PEN",
      status: "PUBLICADO",
    });

    const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(query).toMatchObject({
      TableName: "projects-test",
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :status",
      ExpressionAttributeValues: { ":status": "STATUS#PUBLICADO" },
    });
  });

  it("no expone las claves internas de DynamoDB", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [projectItem(PUBLISHED_ID, "PUBLICADO")] });

    const response = await listProjects(apiEvent({ routeKey: "GET /v1/projects" }));
    const [project] = bodyOf(response).items as Record<string, unknown>[];

    expect(project).not.toHaveProperty("pk");
    expect(project).not.toHaveProperty("gsi1pk");
    expect(project).not.toHaveProperty("gsi1sk");
  });

  it("CA-01.3: sin proyectos publicados responde 200 con una lista vacía", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const response = await listProjects(apiEvent({ routeKey: "GET /v1/projects" }));

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({ items: [] });
  });

  it("recorre todas las páginas del índice", async () => {
    const secondId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [projectItem(PUBLISHED_ID, "PUBLICADO")], LastEvaluatedKey: { pk: "x" } })
      .resolvesOnce({ Items: [projectItem(secondId, "PUBLICADO")] });

    const response = await listProjects(apiEvent({ routeKey: "GET /v1/projects" }));

    expect((bodyOf(response).items as unknown[]).length).toBe(2);
    expect(ddbMock.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({ pk: "x" });
  });

  it("un fallo de DynamoDB responde 500 uniforme sin detalles internos (RNF-HU-10)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ddbMock.on(QueryCommand).rejects(new Error("arn:aws:dynamodb:us-east-2:000000000000:table/x"));

    const response = await listProjects(apiEvent({ routeKey: "GET /v1/projects" }));

    expect(response.statusCode).toBe(500);
    expect(bodyOf(response)).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.any(String),
      requestId: "req-test-0001",
    });
    expect(response.body).not.toContain("arn:aws");
  });
});

describe("GET /v1/projects/{id} (HU-02)", () => {
  it("CA-02.1: devuelve el detalle de un proyecto PUBLICADO", async () => {
    ddbMock.on(GetCommand).resolves({ Item: projectItem(PUBLISHED_ID, "PUBLICADO") });

    const response = await getProject(
      apiEvent({ routeKey: "GET /v1/projects/{id}", pathParameters: { id: PUBLISHED_ID } }),
    );

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      projectId: PUBLISHED_ID,
      status: "PUBLICADO",
      confirmedAmountCents: 12_500,
    });
    expect(bodyOf(response)).not.toHaveProperty("pk");
  });

  it("CA-02.2: un BORRADOR responde el mismo 404 que un id inexistente", async () => {
    ddbMock
      .on(GetCommand, { Key: { pk: `PROJECT#${DRAFT_ID}` } })
      .resolves({ Item: projectItem(DRAFT_ID, "BORRADOR") });
    const missingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    ddbMock.on(GetCommand, { Key: { pk: `PROJECT#${missingId}` } }).resolves({});

    const draft = await getProject(
      apiEvent({ routeKey: "GET /v1/projects/{id}", pathParameters: { id: DRAFT_ID } }),
    );
    const missing = await getProject(
      apiEvent({ routeKey: "GET /v1/projects/{id}", pathParameters: { id: missingId } }),
    );

    expect(draft.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(draft.body).toBe(missing.body);
    expect(draft.body).not.toContain("Útiles");
  });

  it("un id mal formado responde 404 sin consultar la tabla", async () => {
    const response = await getProject(
      apiEvent({ routeKey: "GET /v1/projects/{id}", pathParameters: { id: "../../etc" } }),
    );

    expect(response.statusCode).toBe(404);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });
});

describe("GET /v1/stats (HU-09)", () => {
  it("suma metas y acumulados confirmados solo de proyectos PUBLICADO, sin datos individuales", async () => {
    const secondId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    ddbMock.on(QueryCommand).resolves({
      Items: [
        projectItem(PUBLISHED_ID, "PUBLICADO", { goal: 500_000, confirmed: 12_500 }),
        projectItem(secondId, "PUBLICADO", { goal: 200_000, confirmed: 7_500 }),
        projectItem(DRAFT_ID, "BORRADOR", { goal: 999_999, confirmed: 999_999 }),
      ],
    });

    const response = await getStats(apiEvent({ routeKey: "GET /v1/stats" }));

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({
      currency: "PEN",
      publishedProjects: 2,
      goalAmountCents: 700_000,
      confirmedAmountCents: 20_000,
    });
  });

  it("sin proyectos publicados devuelve ceros", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const response = await getStats(apiEvent({ routeKey: "GET /v1/stats" }));

    expect(bodyOf(response)).toEqual({
      currency: "PEN",
      publishedProjects: 0,
      goalAmountCents: 0,
      confirmedAmountCents: 0,
    });
  });
});

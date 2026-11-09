import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { auditPut, type AuditEvent } from "../audit/audit.js";
import { isConditionFailure } from "../shared/dynamo.js";
import { ConflictError } from "../shared/http.js";
import type { Project, ProjectStatus } from "./schemas.js";

/**
 * Acceso a la tabla Projects (diseño de claves en docs/data-model.md):
 *   pk     = PROJECT#<projectId>
 *   gsi1pk = STATUS#<status>
 *   gsi1sk = <publishedAt | createdAt>#<projectId>
 * El catálogo consulta la partición STATUS#PUBLICADO de gsi1, sin Scan (RNF-HU-05).
 */

export const projectPk = (projectId: string) => `PROJECT#${projectId}`;
const statusPk = (status: ProjectStatus) => `STATUS#${status}`;

export interface Tables {
  projects: string;
  audit: string;
}

/**
 * Copia solo los atributos públicos del ítem. Las claves internas (pk, gsi1pk, gsi1sk) y
 * cualquier atributo que se agregue a futuro no salen al cliente sin cambiar esta función.
 */
function toProject(item: Record<string, unknown>): Project {
  const project: Project = {
    projectId: item.projectId as string,
    title: item.title as string,
    description: item.description as string,
    goalAmountCents: item.goalAmountCents as number,
    confirmedAmountCents: item.confirmedAmountCents as number,
    currency: "PEN",
    status: item.status as ProjectStatus,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
  if (typeof item.publishedAt === "string") {
    project.publishedAt = item.publishedAt;
  }
  return project;
}

/** Proyectos PUBLICADO, los más recientes primero (HU-01, HU-09). */
export async function listPublishedProjects(
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<Project[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :status",
        ExpressionAttributeValues: { ":status": statusPk("PUBLICADO") },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  // Defensa en profundidad (CA-01.2): aunque el índice ya separa por estado, un BORRADOR
  // nunca se devuelve en una lectura pública.
  return items.map(toProject).filter((project) => project.status === "PUBLICADO");
}

export async function getProject(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  projectId: string,
  options: { consistent?: boolean } = {},
): Promise<Project | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: projectPk(projectId) },
      ConsistentRead: options.consistent ?? false,
    }),
  );
  return result.Item ? toProject(result.Item) : undefined;
}

/**
 * Crea el proyecto en BORRADOR y su evento de auditoría en una sola transacción:
 * no queda un proyecto sin registro de quién lo creó, ni un registro sin proyecto (CA-08.3).
 */
export async function createProject(
  ddb: DynamoDBDocumentClient,
  tables: Tables,
  project: Project,
  audit: AuditEvent,
): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tables.projects,
            Item: {
              pk: projectPk(project.projectId),
              gsi1pk: statusPk(project.status),
              gsi1sk: `${project.createdAt}#${project.projectId}`,
              ...project,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        { Put: auditPut(tables.audit, audit) },
      ],
    }),
  );
}

/**
 * Pasa un proyecto de BORRADOR a PUBLICADO junto con su evento de auditoría. La condición sobre
 * el estado hace que, si dos gestores publican a la vez, solo uno lo consiga; el otro recibe 409.
 */
export async function publishProject(
  ddb: DynamoDBDocumentClient,
  tables: Tables,
  projectId: string,
  publishedAt: string,
  audit: AuditEvent,
): Promise<void> {
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tables.projects,
              Key: { pk: projectPk(projectId) },
              UpdateExpression:
                "SET #status = :published, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk, publishedAt = :now, updatedAt = :now",
              ConditionExpression: "attribute_exists(pk) AND #status = :draft",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":published": "PUBLICADO",
                ":draft": "BORRADOR",
                ":gsi1pk": statusPk("PUBLICADO"),
                ":gsi1sk": `${publishedAt}#${projectId}`,
                ":now": publishedAt,
              },
            },
          },
          { Put: auditPut(tables.audit, audit) },
        ],
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) {
      throw new ConflictError("PROJECT_ALREADY_PUBLISHED", "El proyecto ya está publicado");
    }
    throw error;
  }
}

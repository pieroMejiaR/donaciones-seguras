import { listPublishedProjects } from "../projects/repository.js";
import { ddb, tableName } from "../shared/dynamo.js";
import { jsonResponse, withHttp } from "../shared/http.js";

/**
 * GET /v1/projects (HU-01, T01): catálogo público. Solo proyectos PUBLICADO (CA-01.2); si no hay
 * ninguno responde 200 con items vacío para que la SPA muestre su estado vacío (CA-01.3).
 */
export const handler = withHttp("projects.list", async () => {
  const items = await listPublishedProjects(ddb, tableName("PROJECTS_TABLE"));
  return jsonResponse(200, { items });
});

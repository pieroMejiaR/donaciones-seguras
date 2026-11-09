import { getProject } from "../projects/repository.js";
import { ProjectId } from "../projects/schemas.js";
import { ddb, tableName } from "../shared/dynamo.js";
import { jsonResponse, NotFoundError, withHttp } from "../shared/http.js";

/**
 * GET /v1/projects/{id} (HU-02). Un id inexistente, mal formado o de un BORRADOR responde el
 * mismo 404, así el visitante no puede distinguir un borrador de un id inventado (CA-02.2).
 */
export const handler = withHttp("projects.get", async (event) => {
  const projectId = event.pathParameters?.id ?? "";
  if (!ProjectId.safeParse(projectId).success) {
    throw notFound();
  }

  const project = await getProject(ddb, tableName("PROJECTS_TABLE"), projectId);
  if (!project || project.status !== "PUBLICADO") {
    throw notFound();
  }

  return jsonResponse(200, project);
});

function notFound(): NotFoundError {
  return new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado");
}

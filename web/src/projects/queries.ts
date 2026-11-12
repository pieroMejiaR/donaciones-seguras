import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../services/apiClient";
import { useApiClient } from "../services/apiClientContext";
import { isProjectId, projectListSchema, projectSchema, statsSchema } from "./schemas";

export const projectKeys = {
  /** Prefijo de todas las consultas públicas de proyectos. */
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
  stats: ["projects", "stats"] as const,
};

const notFound = () => new ApiError(404, "PROJECT_NOT_FOUND", "Proyecto no encontrado");

/** HU-01: catálogo público. */
export function useProjects() {
  const api = useApiClient();
  return useQuery({
    queryKey: projectKeys.list,
    queryFn: async () => {
      const { items } = await api.request("/v1/projects", { schema: projectListSchema });
      // Defensa en profundidad (CA-01.2): el API ya excluye los borradores.
      return items.filter((project) => project.status === "PUBLICADO");
    },
  });
}

/** HU-02: detalle público. Un id mal formado no consulta el API. */
export function useProject(projectId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    enabled: isProjectId(projectId),
    queryFn: async () => {
      const project = await api.request(`/v1/projects/${encodeURIComponent(projectId)}`, {
        schema: projectSchema,
      });
      // Defensa en profundidad (CA-02.2): un borrador se trata igual que uno inexistente.
      if (project.status !== "PUBLICADO") {
        throw notFound();
      }
      return project;
    },
  });
}

/** HU-09: indicadores agregados. */
export function useStats() {
  const api = useApiClient();
  return useQuery({
    queryKey: projectKeys.stats,
    queryFn: () => api.request("/v1/stats", { schema: statsSchema }),
  });
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

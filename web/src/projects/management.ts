import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { formatPEN, parseSolesToCents } from "../lib/money";
import { useApiClient } from "../services/apiClientContext";
import { apiErrorMessage } from "../services/errorMessages";
import { projectKeys } from "./queries";
import { projectSchema, type Project } from "./schemas";

/** S/ 1,000,000.00, el tope del API (api/src/projects/schemas.ts). */
export const MAX_GOAL_CENTS = 100_000_000;

export const TITLE_LIMITS = { min: 3, max: 120 };
export const DESCRIPTION_LIMITS = { min: 10, max: 2000 };

/**
 * Formulario de HU-08 (CA-08.1). Replica los límites del API para avisar antes de enviar; el API
 * los vuelve a validar y rechaza cualquier campo extra, como `status` o `confirmedAmountCents`.
 */
export const projectFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(TITLE_LIMITS.min, `El título debe tener al menos ${TITLE_LIMITS.min} caracteres.`)
    .max(TITLE_LIMITS.max, `El título puede tener como máximo ${TITLE_LIMITS.max} caracteres.`),
  description: z
    .string()
    .trim()
    .min(
      DESCRIPTION_LIMITS.min,
      `La descripción debe tener al menos ${DESCRIPTION_LIMITS.min} caracteres.`,
    )
    .max(
      DESCRIPTION_LIMITS.max,
      `La descripción puede tener como máximo ${DESCRIPTION_LIMITS.max} caracteres.`,
    ),
  goal: z
    .string()
    .trim()
    .min(1, "Ingresa la meta del proyecto.")
    .transform((text, ctx) => {
      const cents = parseSolesToCents(text);
      if (cents === null) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresa una meta válida en soles, con hasta dos decimales. Ejemplo: 15000",
        });
        return z.NEVER;
      }
      if (cents <= 0) {
        ctx.addIssue({ code: "custom", message: "La meta debe ser mayor que cero." });
        return z.NEVER;
      }
      if (cents > MAX_GOAL_CENTS) {
        ctx.addIssue({
          code: "custom",
          message: `La meta máxima es ${formatPEN(MAX_GOAL_CENTS)}.`,
        });
        return z.NEVER;
      }
      return cents;
    }),
});

export type ProjectFormInput = z.input<typeof projectFormSchema>;
export type ProjectFormOutput = z.output<typeof projectFormSchema>;

export const publishByIdSchema = z.object({
  projectId: z.string().trim().pipe(z.uuid("Ingresa un identificador de proyecto válido.")),
});

/**
 * El API no permite listar borradores (docs/informe-backend.md), así que el panel recuerda los
 * creados o publicados en esta sesión. Viven en la caché de TanStack Query, solo en memoria:
 * sobreviven al cambio de página y se borran al cerrar sesión, como el resto de datos de la cuenta.
 */
export const managerKeys = {
  sessionProjects: ["gestor", "proyectos-de-la-sesion"] as const,
};

export function useSessionProjects() {
  return useQuery({
    queryKey: managerKeys.sessionProjects,
    queryFn: (): Project[] => [],
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function rememberProject(queryClient: QueryClient, project: Project) {
  queryClient.setQueryData<Project[]>(managerKeys.sessionProjects, (projects = []) => [
    project,
    ...projects.filter((p) => p.projectId !== project.projectId),
  ]);
}

/** HU-08, CA-08.1: crea un proyecto en BORRADOR. El estado y el acumulado los fija el API. */
export function useCreateProject() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ title, description, goal }: ProjectFormOutput) =>
      api.request("/v1/projects", {
        method: "POST",
        json: { title, description, goalAmountCents: goal },
        schema: projectSchema,
      }),
    onSuccess: (project) => rememberProject(queryClient, project),
  });
}

/** HU-08, CA-08.2: publica un BORRADOR; desde ese momento aparece en el catálogo y acepta donaciones. */
export function usePublishProject() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      api.request(`/v1/projects/${encodeURIComponent(projectId)}/publish`, {
        method: "POST",
        schema: projectSchema,
      }),
    onSuccess: (project) => {
      rememberProject(queryClient, project);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function createProjectErrorMessage(error: unknown): string {
  return apiErrorMessage(error, "crear el proyecto", ({ status }) =>
    status === 400
      ? "El servidor rechazó los datos. Revisa el título, la descripción y la meta."
      : undefined,
  );
}

export function publishErrorMessage(error: unknown): string {
  return apiErrorMessage(error, "publicar el proyecto", ({ status, code }) => {
    if (code === "PROJECT_ALREADY_PUBLISHED") {
      return "Este proyecto ya estaba publicado.";
    }
    if (status === 404) {
      return "No existe un proyecto con ese identificador.";
    }
    return undefined;
  });
}

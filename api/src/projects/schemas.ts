import { z } from "../shared/zod.js";

/** Estados de un proyecto (requerimientos §4). Solo existe la transición BORRADOR → PUBLICADO. */
export const ProjectStatus = z.enum(["BORRADOR", "PUBLICADO"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const ProjectId = z.uuid();

/** Tope de la meta: S/ 1 000 000,00. Evita montos absurdos sin limitar el caso académico. */
export const MAX_GOAL_AMOUNT_CENTS = 100_000_000;

/**
 * POST /v1/projects (HU-08, CA-08.1). El objeto es estricto: un cliente no puede fijar
 * status, confirmedAmountCents, projectId ni ningún otro campo que decide el servidor (CA-NF02.2).
 */
export const CreateProjectInput = z.strictObject({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  goalAmountCents: z.int().positive().max(MAX_GOAL_AMOUNT_CENTS),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

/** Proyecto tal como lo devuelve el API. Montos en céntimos enteros de PEN. */
export interface Project {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: "PEN";
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

/** GET /v1/stats (HU-09): agregados públicos, sin donantes ni registros individuales (CA-09.2). */
export interface ProjectStats {
  currency: "PEN";
  publishedProjects: number;
  goalAmountCents: number;
  confirmedAmountCents: number;
}

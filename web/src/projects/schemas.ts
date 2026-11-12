import { z } from "zod";

/**
 * Esquemas de las respuestas públicas de proyectos (docs/api.yaml). El navegador no confía en
 * el API: lo que no cumple el contrato se trata como error, y `z.object` descarta cualquier
 * campo extra, así que un dato de donantes nunca llegaría a la interfaz (CA-02.1, CA-09.2).
 */

const cents = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const projectIdSchema = z.uuid();

export const projectSchema = z.object({
  projectId: projectIdSchema,
  title: z.string().min(1),
  description: z.string(),
  goalAmountCents: cents.positive(),
  confirmedAmountCents: cents,
  currency: z.literal("PEN"),
  status: z.enum(["BORRADOR", "PUBLICADO"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().optional(),
});

export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.object({ items: z.array(projectSchema) });

export const statsSchema = z.object({
  currency: z.literal("PEN"),
  publishedProjects: z.int().nonnegative(),
  goalAmountCents: cents,
  confirmedAmountCents: cents,
});

export type ProjectStats = z.infer<typeof statsSchema>;

export function isProjectId(value: string): boolean {
  return projectIdSchema.safeParse(value).success;
}

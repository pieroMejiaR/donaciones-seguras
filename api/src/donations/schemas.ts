import { z } from "../shared/zod.js";

/**
 * Esquemas del módulo donations (HU-05, HU-06). Se fijan desde el día 1 porque forman parte del
 * contrato docs/api.yaml que usa el frontend; los handlers se implementan el día 4.
 */

/** S/ 1,00 */
export const MIN_DONATION_CENTS = 100;
/** S/ 1 000,00 */
export const MAX_DONATION_CENTS = 100_000;

export const DonationStatus = z.enum([
  "PENDIENTE_SIMULACION",
  "CONFIRMADA_SIMULADA",
  "RECHAZADA_SIMULADA",
]);
export type DonationStatus = z.infer<typeof DonationStatus>;

export const DonationId = z.uuid();

/**
 * POST /v1/donations (CA-05.1, CA-05.2). amountCents entero: «más de dos decimales» en soles
 * equivale a céntimos no enteros y se rechaza. Objeto estricto: no se acepta donorSub, donorId ni
 * status desde el cliente (CA-05.3, CA-NF02.2), y tampoco datos de pago (CA-05.5).
 */
export const CreateDonationInput = z.strictObject({
  projectId: z.uuid(),
  amountCents: z.int().min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
});
export type CreateDonationInput = z.infer<typeof CreateDonationInput>;

/** Cabecera Idempotency-Key: la SPA envía un UUID v4 por intento de donación (HU-05, CA-05.4). */
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, {
  error: "La cabecera Idempotency-Key debe tener entre 16 y 128 caracteres [A-Za-z0-9_-]",
});

/** POST /v1/donations/{id}/simulate (CA-06.1): solo estados terminales. */
export const SimulateDonationInput = z.strictObject({
  outcome: z.enum(["CONFIRMADA_SIMULADA", "RECHAZADA_SIMULADA"]),
});
export type SimulateDonationInput = z.infer<typeof SimulateDonationInput>;

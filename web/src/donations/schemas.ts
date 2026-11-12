import { z } from "zod";
import { formatPEN, parseSolesToCents } from "../lib/money";

/**
 * Esquemas de donaciones según docs/api.yaml. Los límites replican los del API solo para dar
 * una mejor experiencia: el backend vuelve a validarlos siempre (CA-05.2, CA-NF02.2).
 */

/** S/ 1.00 */
export const MIN_DONATION_CENTS = 100;
/** S/ 1,000.00 */
export const MAX_DONATION_CENTS = 100_000;

export const donationStatusSchema = z.enum([
  "PENDIENTE_SIMULACION",
  "CONFIRMADA_SIMULADA",
  "RECHAZADA_SIMULADA",
]);

export type DonationStatus = z.infer<typeof donationStatusSchema>;

/**
 * `z.object` descarta los campos que no están en el contrato: si el API devolviera `donorSub`
 * u otro dato de identidad, nunca llegaría a la interfaz (CA-07.2, RNF-HU-10).
 */
export const donationSchema = z.object({
  donationId: z.uuid(),
  projectId: z.uuid(),
  projectTitle: z.string().min(1),
  amountCents: z.int().min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
  currency: z.literal("PEN"),
  status: donationStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Donation = z.infer<typeof donationSchema>;

export const donationListSchema = z.object({ items: z.array(donationSchema) });

export const DONATION_STATUS_LABELS: Record<DonationStatus, string> = {
  PENDIENTE_SIMULACION: "Pendiente de simulación",
  CONFIRMADA_SIMULADA: "Confirmada (simulada)",
  RECHAZADA_SIMULADA: "Rechazada (simulada)",
};

export const AMOUNT_HINT = `Entre ${formatPEN(MIN_DONATION_CENTS)} y ${formatPEN(MAX_DONATION_CENTS)}, con hasta dos decimales. Ejemplo: 25.50`;

/**
 * Formulario de HU-05: el usuario escribe soles y se envían céntimos enteros (CA-05.1). Solo se
 * pide el monto: nunca tarjeta, CVV, cuenta bancaria ni DNI (CA-05.5).
 */
export const donationFormSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Ingresa el monto que deseas donar.")
    .transform((text, ctx) => {
      const cents = parseSolesToCents(text);
      if (cents === null) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresa un monto válido en soles, con hasta dos decimales. Ejemplo: 25.50",
        });
        return z.NEVER;
      }
      if (cents < MIN_DONATION_CENTS) {
        ctx.addIssue({
          code: "custom",
          message: `El monto mínimo es ${formatPEN(MIN_DONATION_CENTS)}.`,
        });
        return z.NEVER;
      }
      if (cents > MAX_DONATION_CENTS) {
        ctx.addIssue({
          code: "custom",
          message: `El monto máximo es ${formatPEN(MAX_DONATION_CENTS)}.`,
        });
        return z.NEVER;
      }
      return cents;
    }),
});

export type DonationFormInput = z.input<typeof donationFormSchema>;
export type DonationFormOutput = z.output<typeof donationFormSchema>;

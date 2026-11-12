export interface DonationPayload {
  projectId: string;
  amountCents: number;
}

/**
 * Elige la `Idempotency-Key` de cada envío (HU-05, CA-05.4):
 *
 * - Reintentar el mismo pago tras un error de red o un 5xx reutiliza la clave. Si la primera
 *   solicitud sí llegó a guardarse, el API devuelve la donación original en lugar de duplicarla.
 * - Cambiar el monto o el proyecto es otro intento y usa una clave nueva: reutilizarla con otra
 *   carga haría que el API respondiera 409.
 * - Tras un registro exitoso se olvida la clave, así la siguiente donación es independiente.
 *
 * La clave vive solo en memoria, igual que los tokens (CA-NF11.1).
 */
export function createIdempotencyTracker(generate: () => string = () => crypto.randomUUID()) {
  let attempt: (DonationPayload & { key: string }) | null = null;

  return {
    keyFor(payload: DonationPayload): string {
      if (
        attempt?.projectId !== payload.projectId ||
        attempt.amountCents !== payload.amountCents
      ) {
        attempt = { ...payload, key: generate() };
      }
      return attempt.key;
    },
    /** El intento terminó (registrado o descartado): el siguiente envío lleva otra clave. */
    reset(): void {
      attempt = null;
    },
  };
}

export type IdempotencyTracker = ReturnType<typeof createIdempotencyTracker>;

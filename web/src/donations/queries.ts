import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPEN } from "../lib/money";
import { ApiError } from "../services/apiClient";
import { useApiClient } from "../services/apiClientContext";
import type { DonationPayload } from "./idempotency";
import {
  donationListSchema,
  donationSchema,
  MAX_DONATION_CENTS,
  MIN_DONATION_CENTS,
} from "./schemas";

export const donationKeys = {
  mine: ["donations", "me"] as const,
};

/**
 * HU-07: historial propio. No se envía ningún identificador de usuario: el API toma el `sub`
 * del access token, así que la SPA no puede pedir el historial de otra persona (CA-07.1).
 */
export function useMyDonations() {
  const api = useApiClient();
  return useQuery({
    queryKey: donationKeys.mine,
    queryFn: async () => {
      const { items } = await api.request("/v1/donations/me", { schema: donationListSchema });
      // Más recientes primero, aunque el API ya las ordena así.
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  });
}

export interface CreateDonationVariables extends DonationPayload {
  idempotencyKey: string;
}

/**
 * HU-05: registra una intención de donación. El cuerpo lleva solo `projectId` y `amountCents`;
 * el donante sale del token (CA-05.3). No se reintenta automáticamente: el usuario decide
 * reintentar y la clave de idempotencia evita el duplicado (CA-05.4).
 */
export function useCreateDonation() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, amountCents, idempotencyKey }: CreateDonationVariables) =>
      api.request("/v1/donations", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        json: { projectId, amountCents },
        schema: donationSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: donationKeys.mine }),
  });
}

/** Mensaje para el usuario, sin códigos internos ni `requestId`. */
export function createDonationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  }
  switch (error.status) {
    case 0:
      return "No se pudo conectar con el servidor. Puedes reintentar: tu donación no se duplicará.";
    case 400:
      return `El servidor rechazó el monto. Debe estar entre ${formatPEN(MIN_DONATION_CENTS)} y ${formatPEN(MAX_DONATION_CENTS)}, con hasta dos decimales.`;
    case 401:
      return "Tu sesión expiró. Inicia sesión de nuevo para registrar la donación.";
    case 403:
      return "Tu cuenta no tiene permiso para registrar donaciones.";
    case 404:
      return "Este proyecto no está disponible para recibir donaciones.";
    case 409:
      if (error.code === "IDEMPOTENCY_KEY_IN_PROGRESS") {
        return "Tu solicitud anterior todavía se está procesando. Espera unos segundos y vuelve a intentarlo.";
      }
      if (error.code === "IDEMPOTENCY_KEY_REUSED") {
        return "No se pudo registrar la donación. Revisa el monto y vuelve a enviarla.";
      }
      return "Este proyecto ya no acepta donaciones.";
    case 429:
      return error.message;
    default:
      return "El servidor no pudo registrar la donación. Puedes reintentar: tu donación no se duplicará.";
  }
}

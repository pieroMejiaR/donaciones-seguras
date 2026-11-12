import { ApiError } from "./apiClient";

/**
 * Mensaje para el usuario a partir de un error del API, sin códigos internos ni `requestId`
 * (RNF-HU-10). `specific` resuelve los casos propios de cada operación; el resto recibe un
 * mensaje común redactado con `action`, por ejemplo «publicar el proyecto».
 */
export function apiErrorMessage(
  error: unknown,
  action: string,
  specific: (error: ApiError) => string | undefined = () => undefined,
): string {
  if (!(error instanceof ApiError)) {
    return `Ocurrió un error inesperado al ${action}. Inténtalo de nuevo.`;
  }
  const message = specific(error);
  if (message) {
    return message;
  }
  switch (error.status) {
    case 0:
      return `No se pudo conectar con el servidor para ${action}. Inténtalo de nuevo.`;
    case 401:
      return `Tu sesión expiró. Inicia sesión de nuevo para ${action}.`;
    case 403:
      return `Tu cuenta no tiene permiso para ${action}.`;
    case 429:
      return error.message;
    default:
      return `Ocurrió un problema al ${action}. Inténtalo de nuevo.`;
  }
}

/** Error uniforme del API: `{ code, message, requestId }` (design.md §4). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Debe devolver el access token, nunca el ID token: el API rechaza este último (T11). */
  getAccessToken: () => Promise<string | null>;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** Se serializa como JSON. */
  json?: unknown;
}

export interface ApiClient {
  request: <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
}

const NETWORK_ERROR_MESSAGE = "No se pudo conectar con el servidor. Inténtalo de nuevo.";
const UNEXPECTED_ERROR_MESSAGE = "Ocurrió un error inesperado al procesar la solicitud.";

async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  return new ApiError(
    response.status,
    typeof fields.code === "string" ? fields.code : "UNEXPECTED_ERROR",
    typeof fields.message === "string" ? fields.message : UNEXPECTED_ERROR_MESSAGE,
    typeof fields.requestId === "string" ? fields.requestId : null,
  );
}

export function createApiClient({ baseUrl, getAccessToken }: ApiClientOptions): ApiClient {
  return {
    async request<T>(path: string, { json, headers, ...init }: ApiRequestOptions = {}) {
      const requestHeaders = new Headers(headers);
      requestHeaders.set("Accept", "application/json");
      if (json !== undefined) {
        requestHeaders.set("Content-Type", "application/json");
      }
      const token = await getAccessToken();
      if (token) {
        requestHeaders.set("Authorization", `Bearer ${token}`);
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: requestHeaders,
          ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
        });
      } catch {
        throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
      }

      if (!response.ok) {
        throw await toApiError(response);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    },
  };
}

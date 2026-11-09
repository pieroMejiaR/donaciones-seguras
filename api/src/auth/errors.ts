import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { ApiErrorResponse } from "./types.js";

/**
 * Error base para excepciones HTTP del API.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * 401 Unauthorized: falta autenticacion, token invalido, expirado o ID token rechazado.
 */
export class UnauthorizedError extends HttpError {
  constructor(code = "UNAUTHORIZED", message = "No autenticado") {
    super(401, code, message);
    this.name = "UnauthorizedError";
  }
}

/**
 * 403 Forbidden: autenticado pero sin rol, scope o pertenencia suficiente.
 */
export class ForbiddenError extends HttpError {
  constructor(code = "FORBIDDEN", message = "Acceso denegado") {
    super(403, code, message);
    this.name = "ForbiddenError";
  }
}

/**
 * Formatea cualquier error hacia el estandar uniforme del proyecto:
 * { code, message, requestId } con headers de seguridad y JSON.
 */
export function formatErrorResponse(
  error: unknown,
  requestId = "req-unknown",
): APIGatewayProxyStructuredResultV2 {
  if (error instanceof HttpError) {
    const errorBody: ApiErrorResponse = {
      code: error.code,
      message: error.message,
      requestId,
    };

    return {
      statusCode: error.statusCode,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify(errorBody),
    };
  }

  // Error inesperado (500) seudonimizado sin exponer detalles internos (RNF-HU-10)
  const fallbackBody: ApiErrorResponse = {
    code: "INTERNAL_SERVER_ERROR",
    message: "Ocurrió un error inesperado al procesar la solicitud",
    requestId,
  };

  return {
    statusCode: 500,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(fallbackBody),
  };
}

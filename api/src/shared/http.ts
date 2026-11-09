import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { z } from "zod";
import { formatErrorResponse, HttpError } from "../auth/errors.js";

export type ApiHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

/** 400: cuerpo, parámetros o cabeceras que no cumplen el contrato. */
export class BadRequestError extends HttpError {
  constructor(code = "VALIDATION_ERROR", message = "La solicitud no es válida") {
    super(400, code, message);
    this.name = "BadRequestError";
  }
}

/** 404: el recurso no existe o el solicitante no puede saber que existe. */
export class NotFoundError extends HttpError {
  constructor(code = "NOT_FOUND", message = "Recurso no encontrado") {
    super(404, code, message);
    this.name = "NotFoundError";
  }
}

/** 409: la operación choca con el estado actual del recurso. */
export class ConflictError extends HttpError {
  constructor(code = "CONFLICT", message = "La operación entra en conflicto con el estado actual") {
    super(409, code, message);
    this.name = "ConflictError";
  }
}

export function requestIdOf(event: APIGatewayProxyEventV2): string {
  return event.requestContext?.requestId ?? "req-unknown";
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

/** Lee el cuerpo JSON del evento, decodificando base64 si API Gateway lo envió así. */
export function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) {
    throw new BadRequestError("INVALID_JSON", "El cuerpo de la solicitud debe ser un objeto JSON");
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body;

  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("INVALID_JSON", "El cuerpo de la solicitud no es JSON válido");
  }
}

/**
 * Valida la entrada con un esquema Zod. Si falla, responde 400 con un mensaje que nombra
 * cada campo inválido, sin repetir los valores recibidos.
 */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  const message = result.error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join(".") : "cuerpo";
      return `${field}: ${issue.message}`;
    })
    .join("; ");

  throw new BadRequestError("VALIDATION_ERROR", message);
}

/**
 * Envuelve un handler: convierte cualquier error al formato uniforme { code, message, requestId }
 * (RNF-HU-10) y escribe una línea de log JSON por solicitud con requestId, acción, resultado y
 * duración (CA-NF07.1). No registra cuerpos, cabeceras ni tokens.
 */
export function withHttp(action: string, fn: ApiHandler): ApiHandler {
  return async (event) => {
    const startedAt = Date.now();
    const requestId = requestIdOf(event);
    let response: APIGatewayProxyStructuredResultV2;
    let errorCode: string | undefined;

    try {
      response = await fn(event);
    } catch (error) {
      response = formatErrorResponse(error, requestId);
      if (error instanceof HttpError) {
        errorCode = error.code;
      } else {
        errorCode = "INTERNAL_SERVER_ERROR";
        console.error(
          JSON.stringify({
            level: "ERROR",
            requestId,
            action,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : undefined,
          }),
        );
      }
    }

    const statusCode = response.statusCode ?? 200;
    console.log(
      JSON.stringify({
        level: "INFO",
        requestId,
        action,
        outcome: statusCode < 400 ? "SUCCESS" : "FAILURE",
        statusCode,
        errorCode,
        durationMs: Date.now() - startedAt,
      }),
    );

    return response;
  };
}

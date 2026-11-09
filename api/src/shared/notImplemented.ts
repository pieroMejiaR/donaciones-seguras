import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { formatErrorResponse, HttpError } from "../auth/errors.js";

/**
 * Respuesta provisional de las rutas que ya existen en la plantilla SAM pero cuyo módulo
 * todavía no se implementa. Responde 501 con el formato uniforme { code, message, requestId }.
 */
export const notImplemented = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  formatErrorResponse(
    new HttpError(501, "NOT_IMPLEMENTED", "La ruta existe, pero todavía no está implementada"),
    event.requestContext.requestId,
  );

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

/**
 * GET /v1/health: prueba de vida para verificar el despliegue del stack.
 * No lee ni escribe datos y no expone información del entorno.
 */
export const handler = async (): Promise<APIGatewayProxyStructuredResultV2> => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "ok" }),
});

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Cliente compartido entre invocaciones de la misma instancia de Lambda.
 * Las credenciales salen del rol de ejecución de cada función; nunca del código (CA-NF03.2).
 */
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export type TableEnvVar = "PROJECTS_TABLE" | "DONATIONS_TABLE" | "IDEMPOTENCY_TABLE" | "AUDIT_TABLE";

/** Nombre de una tabla según las variables de entorno que define infra/template.yaml. */
export function tableName(envVar: TableEnvVar): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${envVar}`);
  }
  return value;
}

/** Error de DynamoDB por condición o transacción cancelada (sin depender de instanceof entre paquetes). */
export function isConditionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "ConditionalCheckFailedException") {
    return true;
  }
  if (error.name === "TransactionCanceledException") {
    const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
    return reasons?.some((reason) => reason.Code === "ConditionalCheckFailed") ?? false;
  }
  return false;
}

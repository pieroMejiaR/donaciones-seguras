import { z } from "zod";
import { extractAuthContext, requireRoleWithMfa, requireScope } from "../auth/index.js";
import { AUDIT_ACTIONS, listAuditEvents } from "../audit/query.js";
import { ddb, tableName } from "../shared/dynamo.js";
import { BadRequestError, jsonResponse, parseWith, withHttp } from "../shared/http.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const EPOCH = "1970-01-01T00:00:00.000Z";

const AuditQueryParams = z
  .object({
    type: z.enum(AUDIT_ACTIONS).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  })
  .strict();

/**
 * GET /v1/audit (HU-10): eventos de auditoría para el AUDITOR, con filtros por tipo y rango de
 * fechas (CA-10.1). Exige el scope api/audit.read, el rol AUDITOR y TOTP MFA (HU-11, T14).
 * Cada evento trae timestamp, requestId, actor seudonimizado, recurso, acción y resultado, y nunca
 * tokens ni datos de pago (CA-10.2).
 */
export const handler = withHttp("audit.list", async (event) => {
  const ctx = extractAuthContext(event);
  requireScope(ctx, "api/audit.read");
  requireRoleWithMfa(ctx, "AUDITOR");

  const params = parseWith(AuditQueryParams, event.queryStringParameters ?? {});
  const from = params.from ? new Date(params.from).toISOString() : EPOCH;
  const to = params.to ? new Date(params.to).toISOString() : new Date().toISOString();
  if (from > to) {
    throw new BadRequestError("INVALID_DATE_RANGE", "La fecha inicial es posterior a la final");
  }

  const items = await listAuditEvents(ddb, tableName("AUDIT_TABLE"), {
    actions: params.type ? [params.type] : AUDIT_ACTIONS,
    from,
    to,
    limit: params.limit ?? DEFAULT_LIMIT,
  });

  return jsonResponse(200, { items });
});

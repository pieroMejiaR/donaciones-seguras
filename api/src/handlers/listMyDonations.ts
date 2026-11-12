import { extractAuthContext, extractDonorSub, requireRole, requireScope } from "../auth/index.js";
import { listDonationsByDonor } from "../donations/repository.js";
import { ddb, tableName } from "../shared/dynamo.js";
import { jsonResponse, withHttp } from "../shared/http.js";

/**
 * GET /v1/donations/me (HU-07): historial del DONANTE autenticado, con fecha, importe, proyecto y
 * estado (CA-07.1). La identidad sale solo del token: cualquier parámetro como ?donorSub= se
 * ignora (CA-07.2). Un GESTOR o AUDITOR recibe 403 (CA-04.2).
 */
export const handler = withHttp("donations.listMine", async (event) => {
  const ctx = extractAuthContext(event);
  requireScope(ctx, "api/donations.read");
  requireRole(ctx, "DONANTE");

  const items = await listDonationsByDonor(ddb, tableName("DONATIONS_TABLE"), extractDonorSub(ctx));
  return jsonResponse(200, { items });
});

// Prueba T08 contra el stack desplegado (stage academic): crea una donación de S/ 1,00, envía N
// confirmaciones simultáneas y comprueba que el acumulado del proyecto subió una sola vez.
//
// Uso (PowerShell):
//   $env:API_URL = "https://<api-id>.execute-api.us-east-2.amazonaws.com/academic"
//   $env:ACCESS_TOKEN = "<access token del usuario DONANTE>"   # nunca el ID token
//   $env:PROJECT_ID = "<id de un proyecto PUBLICADO>"
//   node api/scripts/t08-concurrency.mjs
//
// El script no imprime el token. Copiar su salida a evidence/T08/ tal cual.

const apiUrl = process.env.API_URL?.replace(/\/$/, "");
const token = process.env.ACCESS_TOKEN;
const projectId = process.env.PROJECT_ID;
const parallel = Number(process.env.N ?? 10);
const amountCents = 100;

if (!apiUrl || !token || !projectId) {
  console.error("Faltan variables: API_URL, ACCESS_TOKEN y PROJECT_ID son obligatorias.");
  process.exit(2);
}

const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function call(method, path, { body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...auth, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function confirmedAmount() {
  const { status, body } = await call("GET", `/v1/projects/${projectId}`);
  if (status !== 200) {
    throw new Error(`GET /v1/projects/${projectId} respondió ${status}: ${JSON.stringify(body)}`);
  }
  return body.confirmedAmountCents;
}

const created = await call("POST", "/v1/donations", {
  body: { projectId, amountCents },
  headers: { "idempotency-key": crypto.randomUUID() },
});
if (created.status !== 201) {
  console.error(`No se pudo crear la donación: ${created.status} ${JSON.stringify(created.body)}`);
  process.exit(1);
}
const donationId = created.body.donationId;
console.log(`Donación creada: ${donationId} (${amountCents} céntimos, ${created.body.status})`);

const before = await confirmedAmount();
console.log(`Acumulado antes: ${before} céntimos`);

const startedAt = Date.now();
const results = await Promise.all(
  Array.from({ length: parallel }, () =>
    call("POST", `/v1/donations/${donationId}/simulate`, { body: { outcome: "CONFIRMADA_SIMULADA" } }),
  ),
);
const elapsedMs = Date.now() - startedAt;

const byStatus = {};
for (const result of results) {
  const label = result.status === 200 ? "200" : `${result.status} ${result.body?.code ?? ""}`.trim();
  byStatus[label] = (byStatus[label] ?? 0) + 1;
}
console.log(`${parallel} confirmaciones en paralelo (${elapsedMs} ms):`, byStatus);

const after = await confirmedAmount();
const delta = after - before;
console.log(`Acumulado después: ${after} céntimos (diferencia: ${delta})`);

const successes = results.filter((result) => result.status === 200).length;
const passed = successes === 1 && delta === amountCents;
console.log(
  passed
    ? "T08 SUPERADA: una sola confirmación aplicada y un solo incremento del acumulado."
    : `T08 FALLIDA: ${successes} confirmaciones con 200 y diferencia de ${delta} (esperado: 1 y ${amountCents}).`,
);
console.log("Si otro usuario confirmó donaciones del mismo proyecto durante la prueba, repetirla.");
process.exit(passed ? 0 : 1);

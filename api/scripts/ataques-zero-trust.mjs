// Demostración en vivo de los controles Zero Trust contra el stack desplegado (stage academic).
// Lanza ataques típicos contra el API con el token de un DONANTE y muestra, para cada uno, qué
// respuesta se esperaba y cuál dio el sistema. Crea dos donaciones de S/ 1,00 en el proyecto.
//
// Uso (PowerShell):
//   $env:API_URL = "https://<api-id>.execute-api.us-east-2.amazonaws.com/academic"
//   $env:ACCESS_TOKEN = "<access token del usuario DONANTE>"
//   $env:PROJECT_ID = "<id de un proyecto PUBLICADO>"
//   $env:ID_TOKEN = "<id token del mismo usuario>"   # opcional, para el ataque del ID token
//   node api/scripts/ataques-zero-trust.mjs
//
// El script nunca imprime tokens.

const apiUrl = process.env.API_URL?.replace(/\/$/, "");
const token = process.env.ACCESS_TOKEN;
const projectId = process.env.PROJECT_ID;
const idToken = process.env.ID_TOKEN;

if (!apiUrl || !token || !projectId) {
  console.error("Faltan variables: API_URL, ACCESS_TOKEN y PROJECT_ID son obligatorias.");
  process.exit(2);
}

async function call(method, path, { body, headers = {}, bearer = token } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: response.status, body: json, headers: response.headers };
}

const key = () => crypto.randomUUID();
const b64url = (value) => Buffer.from(value).toString("base64url");

/** Token con el payload modificado (rol GESTOR) y la firma original: no debería validar. */
function forgedAsGestor(jwt) {
  const [header, payload, signature] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  claims["cognito:groups"] = ["GESTOR"];
  claims.scope = `${claims.scope ?? ""} api/projects.write`.trim();
  return `${header}.${b64url(JSON.stringify(claims))}.${signature}`;
}

/** Token con un carácter de la firma cambiado. */
function tamperedSignature(jwt) {
  const last = jwt.at(-1) === "A" ? "B" : "A";
  return `${jwt.slice(0, -1)}${last}`;
}

const rows = [];
function record(ataque, esperado, result, extra = "") {
  const expected = Array.isArray(esperado) ? esperado : [esperado];
  const code = result.body && typeof result.body === "object" ? (result.body.code ?? "") : "";
  const ok = expected.includes(result.status);
  rows.push({ ataque, esperado: expected.join(" o "), obtenido: `${result.status} ${code}`.trim(), ok, extra });
  return ok;
}

// 1-4. Identidad: sin token, token alterado, token falsificado e ID token.
const sampleDonation = { projectId, amountCents: 100 };
record("Donar sin token", 401,
  await call("POST", "/v1/donations", { body: sampleDonation, headers: { "idempotency-key": key() }, bearer: null }));
record("Token con la firma alterada", 401,
  await call("POST", "/v1/donations", { body: sampleDonation, headers: { "idempotency-key": key() }, bearer: tamperedSignature(token) }));
record("Token editado para decir que soy GESTOR", 401,
  await call("POST", "/v1/projects", {
    body: { title: "Proyecto falso", description: "No debería crearse", goalAmountCents: 100000 },
    bearer: forgedAsGestor(token),
  }));
if (idToken) {
  record("ID token en lugar del access token", [401, 403],
    await call("GET", "/v1/donations/me", { bearer: idToken }));
}

// 5. Autorización: ocultar el botón no protege; el API decide.
record("Donante llama directo a crear proyecto", 403,
  await call("POST", "/v1/projects", {
    body: { title: "Proyecto falso", description: "No debería crearse", goalAmountCents: 100000 },
  }));
const audit = await call("GET", "/v1/audit");
record("Donante intenta leer la auditoría", 403, audit, audit.status === 404 ? "ruta aún no desplegada" : "");

// 6-8. Validación: el servidor no confía en el cuerpo.
record("Mandar donorSub y status en el cuerpo", 400,
  await call("POST", "/v1/donations", {
    body: { ...sampleDonation, donorSub: "otra-persona", status: "CONFIRMADA_SIMULADA" },
    headers: { "idempotency-key": key() },
  }));
record("Donar S/ 0,00", 400,
  await call("POST", "/v1/donations", { body: { projectId, amountCents: 0 }, headers: { "idempotency-key": key() } }));
record("Donar S/ 1000,01", 400,
  await call("POST", "/v1/donations", { body: { projectId, amountCents: 100_001 }, headers: { "idempotency-key": key() } }));
record("Enviar un número de tarjeta", 400,
  await call("POST", "/v1/donations", {
    body: { ...sampleDonation, cardNumber: "4111111111111111", cvv: "123" },
    headers: { "idempotency-key": key() },
  }));

// 9-10. Idempotencia: un reintento no duplica y una clave no se reutiliza con otro cuerpo.
const idemKey = key();
const first = await call("POST", "/v1/donations", { body: sampleDonation, headers: { "idempotency-key": idemKey } });
if (first.status !== 201) {
  console.error(`No se pudo crear la donación de prueba: ${first.status} ${JSON.stringify(first.body)}`);
  process.exit(1);
}
const donationId = first.body.donationId;
const replay = await call("POST", "/v1/donations", { body: sampleDonation, headers: { "idempotency-key": idemKey } });
const sameDonation = replay.body?.donationId === donationId;
record("Repetir la misma donación (doble clic o reintento)", 201, replay,
  sameDonation ? "misma donación, no se creó otra" : "OJO: devolvió otra donación");
if (!sameDonation) rows.at(-1).ok = false;
record("Misma clave de idempotencia con otro monto", 409,
  await call("POST", "/v1/donations", { body: { projectId, amountCents: 500 }, headers: { "idempotency-key": idemKey } }));

// 11-12. Recursos ajenos e inyección: mismo 404 que un id inexistente.
record("Simular una donación ajena o inventada", 404,
  await call("POST", `/v1/donations/${crypto.randomUUID()}/simulate`, { body: { outcome: "CONFIRMADA_SIMULADA" } }));
record("Inyección en el id de la ruta", 404,
  await call("POST", `/v1/donations/${encodeURIComponent("x' OR 1=1")}/simulate`, { body: { outcome: "CONFIRMADA_SIMULADA" } }));
const history = await call("GET", `/v1/donations/me?donorSub=${crypto.randomUUID()}`);
const onlyMine = Array.isArray(history.body?.items) && history.body.items.some((item) => item.donationId === donationId);
record("Pedir el historial de otro con ?donorSub=", 200, history,
  onlyMine ? "se ignoró el parámetro: solo el historial propio" : "OJO: no aparece la donación propia");
if (!onlyMine) rows.at(-1).ok = false;

// 13. Condición de carrera: 10 confirmaciones a la vez, un solo incremento.
const project = async () => (await call("GET", `/v1/projects/${projectId}`)).body?.confirmedAmountCents;
const before = await project();
const race = await Promise.all(
  Array.from({ length: 10 }, () =>
    call("POST", `/v1/donations/${donationId}/simulate`, { body: { outcome: "CONFIRMADA_SIMULADA" } })),
);
const after = await project();
const wins = race.filter((result) => result.status === 200).length;
const raceOk = wins === 1 && after - before === 100;
rows.push({
  ataque: "10 confirmaciones simultáneas de la misma donación",
  esperado: "un 200 y +S/ 1,00",
  obtenido: `${wins} con 200, acumulado +${((after - before) / 100).toFixed(2)}`,
  ok: raceOk,
  extra: raceOk ? "" : "si otro usuario confirmó en el mismo proyecto, repetir",
});

// Resultado
console.log("");
console.log("Ataques contra el API desplegado (los tokens no se imprimen)");
console.log("".padEnd(110, "-"));
rows.forEach((row, index) => {
  const mark = row.ok ? "CONTROLADO" : "REVISAR   ";
  console.log(
    `${String(index + 1).padStart(2)}. ${mark}  ${row.ataque.padEnd(52)} esperado ${row.esperado.padEnd(20)} obtenido ${row.obtenido}`,
  );
  if (row.extra) console.log(`${"".padEnd(15)}${row.extra}`);
});
console.log("".padEnd(110, "-"));
const passed = rows.filter((row) => row.ok).length;
console.log(`${passed} de ${rows.length} controles respondieron como se esperaba.`);
process.exit(passed === rows.length ? 0 : 1);

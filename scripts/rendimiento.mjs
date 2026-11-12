#!/usr/bin/env node
/**
 * Prueba de rendimiento del catálogo (RNF-HU-05).
 *
 * Carga proyectos de prueba en la tabla Projects de un stack, mide desde el cliente las rutas
 * públicas de lectura y lee de CloudWatch Logs cuánto tardó cada función. No usa tokens: las
 * rutas medidas son públicas.
 *
 *   node scripts/rendimiento.mjs --stack donaciones-<nombre> [--publicados 50] [--borradores 10]
 *        [--solicitudes 50] [--intervalo-ms 200] [--borrar-datos]
 *
 * Escribe en DynamoDB con las credenciales de la CLI de AWS. No se ejecuta contra el stack de la
 * demo (donaciones-academic): los datos de prueba aparecerían en el catálogo.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    stack: { type: "string" },
    region: { type: "string", default: "us-east-2" },
    publicados: { type: "string", default: "50" },
    borradores: { type: "string", default: "10" },
    solicitudes: { type: "string", default: "50" },
    "intervalo-ms": { type: "string", default: "200" },
    "borrar-datos": { type: "boolean", default: false },
  },
});

const PUBLICADOS = Number(opts.publicados);
const BORRADORES = Number(opts.borradores);
const SOLICITUDES = Number(opts.solicitudes);
const INTERVALO_MS = Number(opts["intervalo-ms"]);

if (!opts.stack) {
  console.error("Uso: node scripts/rendimiento.mjs --stack donaciones-<nombre>");
  process.exit(1);
}
if (opts.stack === "donaciones-academic") {
  console.error("No se cargan datos de prueba en donaciones-academic: aparecerían en el catálogo de la demo.");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "rendimiento-"));

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  const salidas = salidasDelStack(opts.stack);
  const api = salidas.ApiUrl;
  const tabla = salidas.ProjectsTableName;
  if (!api || !tabla) {
    salir(`El stack ${opts.stack} no tiene las salidas ApiUrl y ProjectsTableName.`);
  }

  // 1) Datos de prueba
  const proyectos = generarProyectos();
  escribirEnTabla(tabla, proyectos.map((p) => ({ PutRequest: { Item: aItemDynamo(p) } })));
  const publicados = proyectos.filter((p) => p.status === "PUBLICADO");
  const borrador = proyectos.find((p) => p.status === "BORRADOR");
  console.log(`Cargados ${publicados.length} proyectos publicados y ${proyectos.length - publicados.length} borradores.`);

  // 2) Corrección de las respuestas antes de medir
  const esperado = {
    goal: publicados.reduce((s, p) => s + p.goalAmountCents, 0),
    confirmado: publicados.reduce((s, p) => s + p.confirmedAmountCents, 0),
  };
  const desde = Date.now();
  const lista = await pedir(`${api}/v1/projects`);
  comprobar(lista.status === 200, `GET /v1/projects respondió ${lista.status}`);
  const items = lista.json.items ?? [];
  const idsCargados = new Set(publicados.map((p) => p.projectId));
  comprobar(items.filter((i) => idsCargados.has(i.projectId)).length === publicados.length,
    `el catálogo no trae los ${publicados.length} proyectos publicados`);
  comprobar(items.every((i) => i.status === "PUBLICADO"), "el catálogo incluye un proyecto que no está publicado");
  comprobar(!items.some((i) => i.projectId === borrador?.projectId), "el catálogo incluye un borrador");
  const stats = await pedir(`${api}/v1/stats`);
  comprobar(stats.status === 200 && stats.json.publishedProjects >= publicados.length, "/v1/stats no cuenta los publicados");
  const otrosPublicados = items.filter((i) => !idsCargados.has(i.projectId));
  comprobar(
    stats.json.goalAmountCents === esperado.goal + otrosPublicados.reduce((s, i) => s + i.goalAmountCents, 0),
    "/v1/stats no suma bien las metas",
  );
  const unoPublicado = await pedir(`${api}/v1/projects/${publicados[0].projectId}`);
  comprobar(unoPublicado.status === 200, "un proyecto publicado no responde 200");
  if (borrador) {
    const unBorrador = await pedir(`${api}/v1/projects/${borrador.projectId}`);
    comprobar(unBorrador.status === 404, "un borrador no responde 404");
  }
  console.log(`Respuestas correctas: el catálogo trae ${items.length} proyectos, todos publicados; /v1/stats suma bien; un borrador da 404.`);
  console.log(`Primera solicitud (puede incluir arranque en frío): catálogo ${ms(lista.ms)}.`);

  // 3) Medición desde el cliente
  const rutas = [
    ["GET /v1/projects", `${api}/v1/projects`, "listProjects"],
    ["GET /v1/stats", `${api}/v1/stats`, "getStats"],
    ["GET /v1/projects/{id}", `${api}/v1/projects/${publicados[0].projectId}`, "getProject"],
  ];
  const cliente = [];
  for (const [nombre, url] of rutas) {
    cliente.push({ nombre, ...(await medir(url)) });
  }

  // 4) Duración en las funciones, según sus propios logs
  await esperar(15000);
  const servidor = rutas.map(([nombre, , funcion]) => ({ nombre, ...duracionesEnLogs(funcion, desde) }));

  console.log(`\nCliente: ${SOLICITUDES} solicitudes por ruta, una cada ${INTERVALO_MS} ms como mínimo (incluye la red hasta ${opts.region}).`);
  console.table(cliente.map(filaDeTabla));
  console.log("Funciones: durationMs de las líneas de la aplicación en CloudWatch Logs (sin red ni API Gateway).");
  console.table(servidor.map(filaDeTabla));

  if (opts["borrar-datos"]) {
    escribirEnTabla(tabla, proyectos.map((p) => ({ DeleteRequest: { Key: { pk: { S: `PROJECT#${p.projectId}` } } } })));
    console.log("Datos de prueba borrados.");
  }
}

function generarProyectos() {
  const base = Date.parse("2026-11-01T12:00:00.000Z");
  const lista = [];
  for (let i = 0; i < PUBLICADOS + BORRADORES; i++) {
    const publicado = i < PUBLICADOS;
    const creado = new Date(base + i * 60_000).toISOString();
    const publicadoEn = new Date(base + i * 60_000 + 30_000).toISOString();
    const meta = 100_000 + ((i * 7919) % 900_000);
    lista.push({
      projectId: randomUUID(),
      title: `Proyecto de prueba ${String(i + 1).padStart(2, "0")}`,
      description: "Proyecto generado para la prueba de rendimiento del catálogo (RNF-HU-05).",
      goalAmountCents: meta,
      confirmedAmountCents: publicado ? (i * 1237) % meta : 0,
      status: publicado ? "PUBLICADO" : "BORRADOR",
      createdAt: creado,
      updatedAt: publicado ? publicadoEn : creado,
      ...(publicado ? { publishedAt: publicadoEn } : {}),
    });
  }
  return lista;
}

/** Mismo diseño de claves que api/src/projects/repository.ts. */
function aItemDynamo(p) {
  const orden = p.publishedAt ?? p.createdAt;
  const item = {
    pk: { S: `PROJECT#${p.projectId}` },
    gsi1pk: { S: `STATUS#${p.status}` },
    gsi1sk: { S: `${orden}#${p.projectId}` },
    projectId: { S: p.projectId },
    title: { S: p.title },
    description: { S: p.description },
    goalAmountCents: { N: String(p.goalAmountCents) },
    confirmedAmountCents: { N: String(p.confirmedAmountCents) },
    currency: { S: "PEN" },
    status: { S: p.status },
    createdAt: { S: p.createdAt },
    updatedAt: { S: p.updatedAt },
  };
  if (p.publishedAt) {
    item.publishedAt = { S: p.publishedAt };
  }
  return item;
}

/** BatchWriteItem de a 25, reintentando lo que DynamoDB devuelva sin procesar. */
function escribirEnTabla(tabla, solicitudes) {
  for (let i = 0; i < solicitudes.length; i += 25) {
    let pendientes = { [tabla]: solicitudes.slice(i, i + 25) };
    for (let intento = 0; Object.keys(pendientes).length > 0; intento++) {
      comprobar(intento < 5, "DynamoDB dejó solicitudes sin procesar después de 5 intentos");
      const archivo = join(tmp, "lote.json");
      writeFileSync(archivo, JSON.stringify(pendientes));
      const r = aws("dynamodb", "batch-write-item", "--request-items", `file://${archivo}`);
      pendientes = r.UnprocessedItems ?? {};
    }
  }
}

async function medir(url) {
  const tiempos = [];
  const estados = {};
  for (let i = 0; i < SOLICITUDES; i++) {
    const r = await pedir(url);
    estados[r.status] = (estados[r.status] ?? 0) + 1;
    if (r.status === 200) {
      tiempos.push(r.ms);
    }
    await esperar(Math.max(0, INTERVALO_MS - r.ms));
  }
  return { ...percentiles(tiempos), estados };
}

function duracionesEnLogs(funcion, desde) {
  const grupo = `/donaciones/${opts.stack}/${funcion}`;
  const eventos = [];
  let token;
  do {
    const r = aws("logs", "filter-log-events", "--log-group-name", grupo, "--start-time", String(desde),
      ...(token ? ["--next-token", token] : []));
    eventos.push(...(r.events ?? []));
    token = r.nextToken;
  } while (token);

  const duraciones = [];
  let arranquesEnFrio = 0;
  for (const e of eventos) {
    const linea = intentarJson(e.message);
    if (linea?.type === "platform.initStart") {
      arranquesEnFrio++;
    }
    const app = typeof linea?.message === "string" ? intentarJson(linea.message) : undefined;
    if (typeof app?.durationMs === "number") {
      duraciones.push(app.durationMs);
    }
  }
  return { ...percentiles(duraciones), arranquesEnFrio };
}

function percentiles(valores) {
  const v = [...valores].sort((a, b) => a - b);
  const p = (q) => (v.length ? v[Math.min(v.length - 1, Math.ceil((q / 100) * v.length) - 1)] : NaN);
  return { n: v.length, min: v[0], p50: p(50), p95: p(95), p99: p(99), max: v.at(-1) };
}

function filaDeTabla(f) {
  const fila = { ruta: f.nombre, n: f.n, "mín (ms)": ms(f.min), "p50 (ms)": ms(f.p50), "p95 (ms)": ms(f.p95), "p99 (ms)": ms(f.p99), "máx (ms)": ms(f.max) };
  if (f.estados) {
    fila.estados = Object.entries(f.estados).map(([k, n]) => `${k}×${n}`).join(" ");
  }
  if (f.arranquesEnFrio !== undefined) {
    fila["arranques en frío"] = f.arranquesEnFrio;
  }
  return fila;
}

async function pedir(url) {
  const t0 = performance.now();
  const r = await fetch(url);
  const texto = await r.text();
  return { status: r.status, ms: performance.now() - t0, json: intentarJson(texto) ?? {} };
}

function salidasDelStack(stack) {
  const r = aws("cloudformation", "describe-stacks", "--stack-name", stack);
  return Object.fromEntries((r.Stacks[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
}

function aws(...args) {
  const salida = execFileSync("aws", [...args, "--region", opts.region, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return salida.trim() ? JSON.parse(salida) : {};
}

function intentarJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

function comprobar(condicion, mensaje) {
  if (!condicion) {
    salir(`Falló una comprobación: ${mensaje}`);
  }
}

function salir(mensaje) {
  throw new Error(mensaje);
}

function esperar(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

function ms(valor) {
  return Number.isFinite(valor) ? Math.round(valor) : "-";
}

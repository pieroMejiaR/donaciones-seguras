/**
 * Red simulada para las pruebas: Cognito y el API de proyectos según docs/api.yaml.
 * No importa módulos de la app, así que `setup.ts` puede instalarla antes de cada prueba.
 */
import { vi } from "vitest";
import type { Env } from "../config/env";

export const ORIGIN = "http://localhost:5173";

export const testEnv: Env = {
  oidcAuthority: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_prueba",
  oidcClientId: "cliente-de-prueba",
  oidcDomain: "https://prueba.auth.us-east-2.amazoncognito.com",
  oidcScope: "openid email api/donations.write",
  apiBaseUrl: "https://api.prueba.example",
};

export const TOKENS = {
  access: "access-token-de-prueba",
  refresh: "refresh-token-de-prueba",
};

/** JWT sin firma válida: el cliente OIDC no verifica firmas, eso lo hace API Gateway. */
export function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode(claims)}.firma`;
}

export function idTokenFor(groups: string[] = []): string {
  const now = Math.floor(Date.now() / 1000);
  return fakeJwt({
    sub: "usuario-de-prueba",
    iss: testEnv.oidcAuthority,
    aud: testEnv.oidcClientId,
    iat: now,
    exp: now + 3600,
    "cognito:groups": groups,
  });
}

export interface FakeProject {
  projectId: string;
  title: string;
  description: string;
  goalAmountCents: number;
  confirmedAmountCents: number;
  currency: "PEN";
  status: "BORRADOR" | "PUBLICADO";
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  [extra: string]: unknown;
}

let projectCounter = 0;

/** Proyecto PUBLICADO válido según el contrato; `overrides` cambia lo necesario. */
export function makeProject(overrides: Partial<FakeProject> = {}): FakeProject {
  projectCounter += 1;
  const suffix = String(projectCounter).padStart(12, "0");
  return {
    projectId: `6f1c2b8e-3a4d-4e5f-9a0b-${suffix}`,
    title: `Proyecto de prueba ${projectCounter}`,
    description: "Descripción de un proyecto social ficticio para las pruebas.",
    goalAmountCents: 1_500_000,
    confirmedAmountCents: 12_500,
    currency: "PEN",
    status: "PUBLICADO",
    createdAt: "2026-11-08T09:00:00.000Z",
    updatedAt: "2026-11-08T10:00:00.000Z",
    publishedAt: "2026-11-08T10:00:00.000Z",
    ...overrides,
  };
}

export interface FakeDonation {
  donationId: string;
  projectId: string;
  projectTitle: string;
  amountCents: number;
  currency: "PEN";
  status: "PENDIENTE_SIMULACION" | "CONFIRMADA_SIMULADA" | "RECHAZADA_SIMULADA";
  createdAt: string;
  updatedAt: string;
  [extra: string]: unknown;
}

let donationCounter = 0;

function nextDonationId(): string {
  donationCounter += 1;
  return `9d2e4f60-1b3c-4d5e-8f70-${String(donationCounter).padStart(12, "0")}`;
}

/** Donación válida según el contrato; `overrides` cambia lo necesario. */
export function makeDonation(overrides: Partial<FakeDonation> = {}): FakeDonation {
  return {
    donationId: nextDonationId(),
    projectId: "6f1c2b8e-3a4d-4e5f-9a0b-000000000001",
    projectTitle: "Proyecto de prueba",
    amountCents: 2_500,
    currency: "PEN",
    status: "PENDIENTE_SIMULACION",
    createdAt: "2026-11-09T15:30:00.000Z",
    updatedAt: "2026-11-09T15:30:00.000Z",
    ...overrides,
  };
}

/** Falla simulada de una ruta: caída de red o una respuesta con estado y cuerpo propios. */
export type FakeFailure = "network" | { status: number; body?: unknown };

type ApiRoute = "projects" | "detail" | "stats" | "createDonation" | "myDonations";

export interface NetworkOptions {
  groups?: string[];
  revokeFails?: boolean;
  discoveryFails?: boolean;
  projects?: FakeProject[];
  /** Simula un API defectuoso que devuelve borradores en rutas públicas. */
  leakDrafts?: boolean;
  /** Historial que devuelve `GET /v1/donations/me` para el usuario del token. */
  donations?: FakeDonation[];
  failures?: Partial<Record<ApiRoute, FakeFailure>>;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  /** Cuerpo de formulario (Cognito). */
  body: URLSearchParams;
  /** Cuerpo sin interpretar (JSON del API). */
  rawBody: string | null;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const apiError = (status: number, code: string) =>
  Response.json({ code, message: `Error ${code}`, requestId: `req-prueba-${status}` }, { status });

const notFoundBody = {
  code: "PROJECT_NOT_FOUND",
  message: "Proyecto no encontrado",
  requestId: "req-prueba-404",
};

function respondWith(failure: FakeFailure): Response {
  if (failure === "network") {
    throw new TypeError("Failed to fetch");
  }
  return failure.body === undefined
    ? new Response(null, { status: failure.status })
    : Response.json(failure.body, { status: failure.status });
}

export function stubNetwork(options: NetworkOptions = {}) {
  const state = {
    projects: options.projects ?? [],
    donations: options.donations ?? [],
    failures: { ...options.failures },
    /** Registros de idempotencia: clave → carga y respuesta original, como el backend. */
    idempotency: new Map<string, { payload: string; response: FakeDonation }>(),
  };
  const requests: RecordedRequest[] = [];
  const api = testEnv.apiBaseUrl;

  const visible = () =>
    options.leakDrafts ? state.projects : state.projects.filter((p) => p.status === "PUBLICADO");

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : null;
    requests.push({
      url,
      method,
      headers,
      body: new URLSearchParams(init?.body?.toString() ?? ""),
      rawBody,
    });

    if (url.endsWith("/.well-known/openid-configuration")) {
      if (options.discoveryFails) {
        throw new TypeError("Failed to fetch");
      }
      return Response.json({
        issuer: testEnv.oidcAuthority,
        authorization_endpoint: `${testEnv.oidcDomain}/oauth2/authorize`,
        token_endpoint: `${testEnv.oidcDomain}/oauth2/token`,
        jwks_uri: `${testEnv.oidcAuthority}/.well-known/jwks.json`,
      });
    }
    if (url.endsWith("/oauth2/token")) {
      return Response.json({
        access_token: TOKENS.access,
        refresh_token: TOKENS.refresh,
        id_token: idTokenFor(options.groups),
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    if (url.endsWith("/oauth2/revoke")) {
      return options.revokeFails
        ? Response.json({ error: "invalid_request" }, { status: 400 })
        : new Response(null, { status: 200 });
    }

    if (url === `${api}/v1/projects`) {
      const failure = state.failures.projects;
      return failure ? respondWith(failure) : Response.json({ items: visible() });
    }
    if (url.startsWith(`${api}/v1/projects/`)) {
      const failure = state.failures.detail;
      if (failure) {
        return respondWith(failure);
      }
      const id = decodeURIComponent(url.slice(`${api}/v1/projects/`.length));
      const project = visible().find((p) => p.projectId === id);
      return project ? Response.json(project) : Response.json(notFoundBody, { status: 404 });
    }
    if (url === `${api}/v1/stats`) {
      const failure = state.failures.stats;
      if (failure) {
        return respondWith(failure);
      }
      const published = state.projects.filter((p) => p.status === "PUBLICADO");
      return Response.json({
        currency: "PEN",
        publishedProjects: published.length,
        goalAmountCents: published.reduce((sum, p) => sum + p.goalAmountCents, 0),
        confirmedAmountCents: published.reduce((sum, p) => sum + p.confirmedAmountCents, 0),
      });
    }
    if (url === `${api}/v1/donations` && method === "POST") {
      const failure = state.failures.createDonation;
      if (failure) {
        return respondWith(failure);
      }
      // Imita al API: el navegador no decide nada, todo se valida aquí (CA-NF02.2).
      if (headers.get("Authorization") !== `Bearer ${TOKENS.access}`) {
        return apiError(401, "UNAUTHORIZED");
      }
      const key = headers.get("Idempotency-Key") ?? "";
      if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
        return apiError(400, "INVALID_IDEMPOTENCY_KEY");
      }
      const input = JSON.parse(rawBody ?? "null") as { projectId?: unknown; amountCents?: unknown };
      const amount = input?.amountCents;
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 100 ||
        amount > 100_000 ||
        Object.keys(input).some((field) => field !== "projectId" && field !== "amountCents")
      ) {
        return apiError(400, "VALIDATION_ERROR");
      }
      const payload = JSON.stringify({ projectId: input.projectId, amountCents: amount });
      const previous = state.idempotency.get(key);
      if (previous) {
        return previous.payload === payload
          ? Response.json(previous.response, { status: 201 })
          : apiError(409, "IDEMPOTENCY_KEY_REUSED");
      }
      const project = state.projects.find(
        (p) => p.projectId === input.projectId && p.status === "PUBLICADO",
      );
      if (!project) {
        return apiError(409, "PROJECT_NOT_ELIGIBLE");
      }
      const donation = makeDonation({
        projectId: project.projectId,
        projectTitle: project.title,
        amountCents: amount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      state.donations.unshift(donation);
      state.idempotency.set(key, { payload, response: donation });
      return Response.json(donation, { status: 201 });
    }
    if (url === `${api}/v1/donations/me`) {
      const failure = state.failures.myDonations;
      if (failure) {
        return respondWith(failure);
      }
      if (headers.get("Authorization") !== `Bearer ${TOKENS.access}`) {
        return apiError(401, "UNAUTHORIZED");
      }
      return Response.json({ items: state.donations });
    }
    throw new Error(`Solicitud no simulada: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    requests,
    requestsTo: (path: string) => requests.filter(({ url }) => url.endsWith(path)),
    /** Donaciones que el API simulado tiene guardadas. */
    donations: () => state.donations,
    apiRequests: () => requests.filter(({ url }) => url.startsWith(api)),
    setFailure: (route: ApiRoute, failure: FakeFailure | undefined) => {
      state.failures[route] = failure;
    },
  };
}

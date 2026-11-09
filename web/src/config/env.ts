import { z } from "zod";

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const httpsUrl = z.url({ protocol: /^https$/ }).transform(withoutTrailingSlash);

// CA-NF01.1: fuera del desarrollo local no se admite HTTP.
const apiUrl = z
  .url({ protocol: /^https?$/ })
  .refine(
    (value) => value.startsWith("https://") || /^http:\/\/localhost(:\d+)?(\/|$)/.test(value),
  )
  .transform(withoutTrailingSlash);

const envSchema = z
  .object({
    VITE_OIDC_AUTHORITY: httpsUrl,
    VITE_OIDC_CLIENT_ID: z.string().trim().min(1),
    VITE_OIDC_DOMAIN: httpsUrl,
    VITE_OIDC_SCOPE: z
      .string()
      .trim()
      .refine((value) => value.split(/\s+/).includes("openid")),
    VITE_API_BASE_URL: apiUrl,
  })
  .transform((raw) => ({
    oidcAuthority: raw.VITE_OIDC_AUTHORITY,
    oidcClientId: raw.VITE_OIDC_CLIENT_ID,
    oidcDomain: raw.VITE_OIDC_DOMAIN,
    oidcScope: raw.VITE_OIDC_SCOPE,
    apiBaseUrl: raw.VITE_API_BASE_URL,
  }));

export type Env = z.output<typeof envSchema>;

export type EnvResult = { ok: true; env: Env } | { ok: false; invalid: string[] };

/** Valida la configuración e informa solo los nombres de las variables, nunca sus valores. */
export function readEnv(raw: Record<string, unknown>): EnvResult {
  const parsed = envSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, env: parsed.data };
  }
  const invalid = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  return { ok: false, invalid };
}

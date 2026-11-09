import type { User, UserManager } from "oidc-client-ts";
import type { Env } from "../config/env";
import { buildLogoutUrl } from "./oidcConfig";
import { sanitizeReturnTo } from "./returnTo";

const USER_ROLES = ["DONANTE", "GESTOR", "AUDITOR"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles leídos del claim `cognito:groups` del ID token, solo para adaptar la interfaz.
 * La autorización real la decide el API con los claims verificados del access token.
 */
export function getRoles(user: User | null): UserRole[] {
  const groups: unknown = user?.profile["cognito:groups"];
  if (!Array.isArray(groups)) {
    return [];
  }
  return USER_ROLES.filter((role) => groups.includes(role));
}

/** Devuelve el access token vigente. El ID token no se envía nunca al API (T11). */
export async function getValidAccessToken(userManager: UserManager): Promise<string | null> {
  const user = await userManager.getUser();
  return user && !user.expired ? user.access_token : null;
}

const signinCallbacks = new WeakMap<UserManager, { url: string; result: Promise<User> }>();

/**
 * Canjea el código de autorización una sola vez por URL. StrictMode ejecuta los efectos
 * dos veces en desarrollo, y un segundo canje fallaría porque el código es de un solo uso.
 */
function processSigninCallback(userManager: UserManager, url: string): Promise<User> {
  const current = signinCallbacks.get(userManager);
  if (current?.url === url) {
    return current.result;
  }
  const result = userManager.signinRedirectCallback(url);
  signinCallbacks.set(userManager, { url, result });
  return result;
}

/** Completa el login y devuelve la ruta interna a la que debe volver el usuario. */
export async function completeSignin(userManager: UserManager, url: string): Promise<string> {
  const user = await processSigninCallback(userManager, url);
  const state = user.state as { returnTo?: unknown } | undefined;
  return sanitizeReturnTo(state?.returnTo);
}

/**
 * CA-03.3: revoca el refresh token, borra los tokens de memoria y cierra la sesión de Cognito.
 * Si la revocación falla, el cierre continúa: el usuario pidió salir y la SPA ya no debe
 * conservar ningún token.
 */
export async function performLogout(userManager: UserManager, env: Env): Promise<void> {
  try {
    // Cognito solo acepta refresh tokens; revocarlo invalida también sus access tokens en
    // Cognito, aunque el JWT authorizer los acepta hasta que expiren (CA-03.4).
    await userManager.revokeTokens(["refresh_token"]);
  } catch {
    console.warn("No se pudo revocar el refresh token durante el cierre de sesión.");
  }
  await userManager.removeUser();
  window.location.assign(buildLogoutUrl(env, window.location.origin));
}

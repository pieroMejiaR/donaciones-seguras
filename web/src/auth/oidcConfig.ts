import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
  type UserManagerSettings,
} from "oidc-client-ts";
import type { Env } from "../config/env";

const REQUEST_TIMEOUT_SECONDS = 10;

export function buildOidcSettings(env: Env, origin: string): UserManagerSettings {
  return {
    authority: env.oidcAuthority,
    client_id: env.oidcClientId,
    redirect_uri: `${origin}/callback`,
    // CA-03.1: Authorization Code; la biblioteca añade PKCE (S256) a este flujo.
    response_type: "code",
    scope: env.oidcScope,
    // Si el discovery de Cognito no anuncia este endpoint, se usa este valor.
    metadataSeed: {
      revocation_endpoint: `${env.oidcDomain}/oauth2/revoke`,
    },
    // CA-NF11.1: los tokens viven solo en memoria.
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    // El `state` y el `code_verifier` deben sobrevivir a la redirección a Cognito, así que
    // no pueden estar en memoria. No son tokens y se borran al procesar el callback.
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    loadUserInfo: false,
    automaticSilentRenew: true,
    requestTimeoutInSeconds: REQUEST_TIMEOUT_SECONDS,
  };
}

export function createUserManager(env: Env, origin: string): UserManager {
  return new UserManager(buildOidcSettings(env, origin));
}

/**
 * Cognito no implementa `post_logout_redirect_uri`: su endpoint /logout espera
 * `client_id` y `logout_uri`, que debe coincidir con una URL de cierre registrada.
 */
export function buildLogoutUrl(env: Env, origin: string): string {
  const params = new URLSearchParams({ client_id: env.oidcClientId, logout_uri: origin });
  return `${env.oidcDomain}/logout?${params.toString()}`;
}

import { QueryClient } from "@tanstack/react-query";
import type { UserManager } from "oidc-client-ts";
import { createUserManager } from "../auth/oidcConfig";
import { getValidAccessToken } from "../auth/session";
import type { Env } from "../config/env";
import { ApiError, createApiClient, type ApiClient } from "../services/apiClient";

export interface AppServices {
  env: Env;
  userManager: UserManager;
  queryClient: QueryClient;
  apiClient: ApiClient;
}

const MAX_RETRIES = 2;

/** Reintentar un 4xx no cambia el resultado; solo se reintentan errores de red y 5xx. */
function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < MAX_RETRIES;
}

export function createAppServices(env: Env): AppServices {
  const userManager = createUserManager(env, window.location.origin);
  return {
    env,
    userManager,
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, retry: shouldRetry },
      },
    }),
    apiClient: createApiClient({
      baseUrl: env.apiBaseUrl,
      getAccessToken: () => getValidAccessToken(userManager),
    }),
  };
}

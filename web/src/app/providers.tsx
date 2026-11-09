import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { ApiClientContext } from "../services/apiClientContext";
import type { AppServices } from "./services";

export function AppProviders({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  const { env, userManager, queryClient, apiClient } = services;

  // Al terminar la sesión no deben quedar en memoria datos de la cuenta, como el historial.
  const clearCache = useCallback(() => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientContext.Provider value={apiClient}>
        <AuthProvider env={env} userManager={userManager} onSessionEnd={clearCache}>
          {children}
        </AuthProvider>
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}

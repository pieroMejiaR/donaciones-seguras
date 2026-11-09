import { createContext, useContext } from "react";
import type { UserRole } from "./session";

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "signingOut";

export interface AuthContextValue {
  status: AuthStatus;
  /** Mensaje de sesión para mostrar al usuario, por ejemplo cuando la sesión expira. */
  notice: string | null;
  hasRole: (role: UserRole) => boolean;
  roles: UserRole[];
  /** Redirige a Cognito y, al volver, lleva al usuario a `returnTo`. */
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Procesa la respuesta de Cognito y devuelve la ruta interna de destino. */
  completeLogin: (url: string) => Promise<string>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return value;
}

import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "./authContext";
import type { UserRole } from "./session";

/**
 * Guard de experiencia de uso, no de seguridad: evita mostrar pantallas que el API
 * rechazaría con 403. Se usa dentro de `RequireAuth`.
 */
export function RequireRole({ allowed, children }: { allowed: UserRole[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  return allowed.some(hasRole) ? children : <Navigate to="/403" replace />;
}

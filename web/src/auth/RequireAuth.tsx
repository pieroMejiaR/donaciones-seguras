import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { PageHeading } from "../components/PageHeading";
import { useAuth } from "./authContext";

/**
 * Guard de experiencia de uso, no de seguridad: quien manipule el navegador puede saltarlo.
 * La protección real está en el API, que valida token, rol y propietario en cada solicitud.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, notice, login } = useAuth();
  const { pathname, search, hash } = useLocation();
  const returnTo = `${pathname}${search}${hash}`;

  // Si hay un aviso (sesión expirada o fallo de login) se deja decidir al usuario, lo que
  // evita un bucle de redirecciones y que pierda de vista el mensaje.
  const shouldRedirect = status === "anonymous" && !notice;

  useEffect(() => {
    if (shouldRedirect) {
      void login(returnTo);
    }
  }, [shouldRedirect, login, returnTo]);

  if (status === "authenticated") {
    return children;
  }

  if (status === "anonymous" && notice) {
    return (
      <div className="space-y-4">
        <PageHeading title="Inicia sesión para continuar" />
        <button type="button" className="btn btn-primary" onClick={() => void login(returnTo)}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  const message = status === "anonymous" ? "Redirigiendo a inicio de sesión…" : "Cargando…";
  return (
    <div className="space-y-4">
      <PageHeading title="Verificando tu sesión" />
      <p role="status">{status === "signingOut" ? "Cerrando sesión…" : message}</p>
    </div>
  );
}

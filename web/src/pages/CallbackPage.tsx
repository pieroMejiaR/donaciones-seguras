import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/authContext";
import { PageHeading } from "../components/PageHeading";

/** Recibe la respuesta de Cognito en `/callback`. */
export function CallbackPage() {
  const { completeLogin } = useAuth();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  // La URL completa se fija al montar: tras un error se limpia de la barra de direcciones.
  const [callbackUrl] = useState(() => `${window.location.origin}${pathname}${search}`);

  useEffect(() => {
    let active = true;
    completeLogin(callbackUrl)
      .then((returnTo) => {
        if (active) {
          void navigate(returnTo, { replace: true });
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          // El código y el state no deben quedar visibles en la URL ni en el historial.
          void navigate("/callback", { replace: true });
        }
      });
    return () => {
      active = false;
    };
  }, [callbackUrl, completeLogin, navigate]);

  if (failed) {
    return (
      <div className="space-y-4">
        <PageHeading title="No se pudo iniciar sesión" />
        <p role="alert">La respuesta del servicio de identidad no es válida o ya expiró.</p>
        <Link to="/" className="text-link inline-flex min-h-11 items-center">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeading title="Iniciando sesión" />
      <p role="status">Completando el inicio de sesión…</p>
    </div>
  );
}

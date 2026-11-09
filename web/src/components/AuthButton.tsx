import { useLocation } from "react-router";
import { useAuth } from "../auth/authContext";

export function AuthButton() {
  const { status, login, logout } = useAuth();
  const { pathname, search, hash } = useLocation();

  if (status === "authenticated" || status === "signingOut") {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        disabled={status === "signingOut"}
        onClick={() => void logout()}
      >
        {status === "signingOut" ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => void login(`${pathname}${search}${hash}`)}
    >
      Iniciar sesión
    </button>
  );
}

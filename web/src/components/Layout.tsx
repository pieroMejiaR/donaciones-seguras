import type { MouseEvent } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../auth/authContext";
import { AuthButton } from "./AuthButton";
import { RouteFocus } from "./RouteFocus";

const MAIN_ID = "contenido";

const navLinkClass =
  "inline-flex min-h-11 items-center rounded px-2 font-medium text-ink hover:text-brand aria-[current=page]:font-bold aria-[current=page]:text-brand aria-[current=page]:underline aria-[current=page]:underline-offset-4";

function focusMain(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById(MAIN_ID)?.focus();
}

export function Layout() {
  const { hasRole, notice } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <RouteFocus />
      <a href={`#${MAIN_ID}`} className="skip-link" onClick={focusMain}>
        Saltar al contenido principal
      </a>

      {/* El header no es fijo para que nunca tape el elemento con foco (WCAG 2.4.11). */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded font-bold text-brand"
          >
            Donaciones Seguras
          </Link>
          <div className="ml-auto sm:order-last">
            <AuthButton />
          </div>
          {/* Mostrar u ocultar enlaces es solo experiencia de uso: quien autoriza es el API. */}
          <nav aria-label="Principal" className="w-full sm:w-auto">
            <ul className="-ml-2 flex flex-wrap gap-x-4">
              <li>
                <NavLink to="/" end className={navLinkClass}>
                  Inicio
                </NavLink>
              </li>
              {hasRole("DONANTE") && (
                <li>
                  <NavLink to="/mis-donaciones" className={navLinkClass}>
                    Mis donaciones
                  </NavLink>
                </li>
              )}
              {hasRole("GESTOR") && (
                <li>
                  <NavLink to="/gestor" className={navLinkClass}>
                    Panel del gestor
                  </NavLink>
                </li>
              )}
            </ul>
          </nav>
        </div>
      </header>

      {notice && (
        <div role="alert" className="border-b border-danger bg-danger-soft text-danger">
          <p className="mx-auto max-w-5xl px-4 py-3 font-medium">{notice}</p>
        </div>
      )}

      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <p className="mx-auto max-w-5xl px-4 py-4 text-sm text-muted">
          Prototipo académico: la Fundación AQP-SOLIDARIA es ficticia y no se procesan pagos
          reales. Un despliegue real exigiría una evaluación legal, incluida la Ley N.º 29733 de
          protección de datos personales.
        </p>
      </footer>
    </div>
  );
}

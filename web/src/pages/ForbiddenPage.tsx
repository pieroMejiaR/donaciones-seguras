import { Link } from "react-router";
import { PageHeading } from "../components/PageHeading";

export function ForbiddenPage() {
  return (
    <div className="space-y-4">
      <PageHeading title="No tienes acceso a esta sección" />
      <p className="text-muted">Tu cuenta no tiene el rol necesario para ver esta página.</p>
      <Link to="/" className="text-link">
        Volver al inicio
      </Link>
    </div>
  );
}

import { Link } from "react-router";
import { PageHeading } from "../components/PageHeading";

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <PageHeading title="Página no encontrada" />
      <p className="text-muted">La página que buscas no existe o ya no está disponible.</p>
      <Link to="/" className="text-link inline-flex min-h-11 items-center">
        Volver al inicio
      </Link>
    </div>
  );
}

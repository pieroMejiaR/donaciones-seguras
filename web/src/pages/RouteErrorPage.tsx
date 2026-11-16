import { PageHeading } from "../components/PageHeading";

/** Reemplaza la pantalla por defecto del router, que muestra detalles técnicos. */
export function RouteErrorPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <PageHeading title="Algo salió mal" />
      <p className="text-muted">Ocurrió un error inesperado al mostrar esta página.</p>
      <a href="/" className="text-link inline-flex min-h-11 items-center">
        Volver al inicio
      </a>
    </main>
  );
}

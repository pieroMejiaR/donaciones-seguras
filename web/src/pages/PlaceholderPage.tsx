import { PageHeading } from "../components/PageHeading";

/** Página provisional para rutas cuya pantalla todavía no se implementa. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <PageHeading title={title} />
      <p className="text-muted">Esta sección estará disponible próximamente.</p>
    </div>
  );
}

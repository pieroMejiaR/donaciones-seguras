import { PageHeading } from "../components/PageHeading";

export function HomePage() {
  return (
    <div className="space-y-4">
      <PageHeading title="Proyectos sociales de la Fundación AQP-SOLIDARIA" />
      <p className="max-w-prose text-muted">
        Conoce los proyectos de educación, alimentación y salud comunitaria, y registra una
        donación de prueba.
      </p>
      <section
        aria-labelledby="catalogo-titulo"
        className="rounded-lg border border-line bg-surface p-4"
      >
        <h2 id="catalogo-titulo" className="font-semibold">
          Catálogo de proyectos
        </h2>
        <p className="mt-1 text-muted">El catálogo estará disponible próximamente.</p>
      </section>
    </div>
  );
}

import { Link } from "react-router";
import { LoadError } from "../components/LoadError";
import { PageHeading } from "../components/PageHeading";
import { ProjectProgress } from "../projects/ProjectProgress";
import { useProjects } from "../projects/queries";
import type { Project } from "../projects/schemas";
import { StatsSummary } from "../projects/StatsSummary";

function ProjectCard({ project }: { project: Project }) {
  const titleId = `proyecto-${project.projectId}`;
  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h3 id={titleId} className="text-lg font-semibold">
        <Link to={`/proyectos/${project.projectId}`} className="text-link break-words">
          {project.title}
        </Link>
      </h3>
      <p className="line-clamp-3 break-words text-muted">{project.description}</p>
      <div className="mt-auto">
        <ProjectProgress
          confirmedAmountCents={project.confirmedAmountCents}
          goalAmountCents={project.goalAmountCents}
        />
      </div>
    </article>
  );
}

/** HU-01: catálogo público de proyectos publicados. */
export function CatalogPage() {
  const projects = useProjects();

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <PageHeading title="Proyectos sociales de la Fundación AQP-SOLIDARIA" />
        <p className="max-w-prose text-muted">
          Conoce los proyectos de educación, alimentación y salud comunitaria, y registra una
          donación de prueba.
        </p>
      </div>

      <StatsSummary />

      <section aria-labelledby="catalogo-titulo" className="space-y-3">
        <h2 id="catalogo-titulo" className="text-xl font-semibold">
          Proyectos publicados
        </h2>
        {projects.isPending && <p role="status">Cargando proyectos…</p>}
        {projects.isError && (
          <LoadError
            message="No se pudieron cargar los proyectos."
            onRetry={() => projects.refetch()}
          />
        )}
        {projects.isSuccess && projects.data.length === 0 && (
          <p className="rounded-lg border border-line bg-surface p-4 text-muted">
            Todavía no hay proyectos publicados. Vuelve pronto.
          </p>
        )}
        {projects.isSuccess && projects.data.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {projects.data.map((project) => (
              <li key={project.projectId}>
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

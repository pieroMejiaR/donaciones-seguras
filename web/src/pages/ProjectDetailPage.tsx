import { Link, useParams } from "react-router";
import { useAuth } from "../auth/authContext";
import { LoadError } from "../components/LoadError";
import { PageHeading } from "../components/PageHeading";
import { formatDate } from "../lib/dates";
import { ProjectProgress } from "../projects/ProjectProgress";
import { isNotFound, useProject } from "../projects/queries";
import { isProjectId, type Project } from "../projects/schemas";

const STATUS_LABELS: Record<Project["status"], string> = {
  PUBLICADO: "Publicado",
  BORRADOR: "Borrador",
};

/**
 * Invitación a donar. Se ofrece a visitantes (al entrar se les pide iniciar sesión) y a donantes;
 * ocultarla a otros roles es solo experiencia de uso: el API responde 403 si un gestor lo intenta.
 */
function DonateCallToAction({ projectId }: { projectId: string }) {
  const { status, hasRole } = useAuth();
  if (status === "authenticated" && !hasRole("DONANTE")) {
    return null;
  }
  return (
    <div className="space-y-2">
      <Link to={`/proyectos/${projectId}/donar`} className="btn btn-primary w-full sm:w-auto">
        Donar a este proyecto
      </Link>
      {status !== "authenticated" && (
        <p className="text-sm text-muted">Necesitas iniciar sesión como donante.</p>
      )}
    </div>
  );
}

function ProjectDetails({ project }: { project: Project }) {
  return (
    <div className="space-y-6">
      <p className="max-w-prose whitespace-pre-line break-words">{project.description}</p>

      <ProjectProgress
        confirmedAmountCents={project.confirmedAmountCents}
        goalAmountCents={project.goalAmountCents}
      />

      <DonateCallToAction projectId={project.projectId} />

      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Estado</dt>
          <dd className="font-semibold">{STATUS_LABELS[project.status]}</dd>
        </div>
        {project.publishedAt && (
          <div>
            <dt className="text-sm text-muted">Publicado el</dt>
            <dd className="font-semibold">{formatDate(project.publishedAt)}</dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-sm text-muted">Identificador</dt>
          <dd className="font-mono text-sm break-all">{project.projectId}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * HU-02: detalle público de un proyecto. Un id inexistente, mal formado o de un borrador se
 * presenta igual, sin revelar si el proyecto existe (CA-02.2).
 */
export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const validId = isProjectId(projectId);
  const project = useProject(projectId);

  const notFound = !validId || isNotFound(project.error);
  const failed = project.isError && !notFound;

  let title = "Cargando proyecto…";
  if (notFound) {
    title = "Proyecto no encontrado";
  } else if (failed) {
    title = "No se pudo cargar el proyecto";
  } else if (project.data) {
    title = project.data.title;
  }

  return (
    <div className="space-y-6">
      {/* El h1 se mantiene en la misma posición en todos los estados para no perder el foco. */}
      <PageHeading title={title} />

      {notFound && (
        <p className="text-muted">El proyecto que buscas no existe o no está disponible.</p>
      )}
      {failed && (
        <LoadError
          message="Ocurrió un problema al cargar el proyecto."
          onRetry={() => project.refetch()}
        />
      )}
      {!notFound && project.isPending && <p role="status">Cargando el detalle del proyecto…</p>}
      {project.data && !notFound && <ProjectDetails project={project.data} />}

      <Link to="/" className="text-link inline-flex min-h-11 items-center">
        Volver al catálogo
      </Link>
    </div>
  );
}

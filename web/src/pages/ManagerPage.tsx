import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { FormField } from "../components/FormField";
import { PageHeading } from "../components/PageHeading";
import { formatDateTime } from "../lib/dates";
import { formatPEN } from "../lib/money";
import {
  createProjectErrorMessage,
  DESCRIPTION_LIMITS,
  MAX_GOAL_CENTS,
  projectFormSchema,
  publishByIdSchema,
  publishErrorMessage,
  TITLE_LIMITS,
  useCreateProject,
  usePublishProject,
  useSessionProjects,
  type ProjectFormInput,
  type ProjectFormOutput,
} from "../projects/management";
import type { Project } from "../projects/schemas";

const STATUS_STYLES: Record<Project["status"], { label: string; className: string }> = {
  BORRADOR: { label: "Borrador", className: "border-warning bg-warning-soft text-warning" },
  PUBLICADO: { label: "Publicado", className: "border-brand bg-brand-soft text-brand" },
};

/** Mensaje de resultado que recibe el foco al aparecer, para que se anuncie (WCAG 4.1.3). */
function FocusedStatus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className="rounded-lg border border-brand bg-brand-soft p-3 font-semibold text-brand"
    >
      {children}
    </p>
  );
}

function CreateProjectSection() {
  const mutation = useCreateProject();
  const sessionProjects = useSessionProjects().data ?? [];
  // El aviso invita a publicar el borrador; deja de mostrarse cuando ya se publicó.
  const stillDraft = sessionProjects.some(
    (p) => p.projectId === mutation.data?.projectId && p.status === "BORRADOR",
  );
  // El API no tiene clave de idempotencia para proyectos: se evita un segundo envío mientras
  // el primero está en curso, incluso antes de que el botón llegue a deshabilitarse.
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormInput, unknown, ProjectFormOutput>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: { title: "", description: "", goal: "" },
  });

  const onSubmit = (values: ProjectFormOutput) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    mutation.mutate(values, {
      onSuccess: () => reset(),
      onSettled: () => {
        inFlight.current = false;
      },
    });
  };

  return (
    <section aria-labelledby="nuevo-proyecto" className="space-y-4">
      <h2 id="nuevo-proyecto" className="text-xl font-semibold">
        Nuevo proyecto
      </h2>
      <form
        noValidate
        aria-labelledby="nuevo-proyecto"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5 rounded-lg border border-line bg-surface p-4"
      >
        <FormField
          id="titulo"
          label="Título"
          hint={`Entre ${TITLE_LIMITS.min} y ${TITLE_LIMITS.max} caracteres.`}
          error={errors.title?.message}
        >
          {(control) => (
            <input type="text" autoComplete="off" className="field-input" {...control} {...register("title")} />
          )}
        </FormField>

        <FormField
          id="descripcion"
          label="Descripción"
          hint={`Entre ${DESCRIPTION_LIMITS.min} y ${DESCRIPTION_LIMITS.max} caracteres. Explica a quién beneficia y en qué se usará.`}
          error={errors.description?.message}
        >
          {(control) => (
            <textarea rows={5} className="field-input" {...control} {...register("description")} />
          )}
        </FormField>

        <FormField
          id="meta"
          label="Meta en soles (PEN)"
          hint={`Mayor que cero y hasta ${formatPEN(MAX_GOAL_CENTS)}, con hasta dos decimales. Ejemplo: 15000`}
          error={errors.goal?.message}
        >
          {(control) => (
            <div className="flex max-w-xs items-center gap-2">
              <span aria-hidden="true" className="font-semibold">
                S/
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="field-input"
                {...control}
                {...register("goal")}
              />
            </div>
          )}
        </FormField>

        <p className="text-sm text-muted">
          El proyecto se crea como borrador: no aparece en el catálogo ni acepta donaciones hasta
          que lo publiques.
        </p>

        {mutation.isError && (
          <p role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 font-medium text-danger">
            {createProjectErrorMessage(mutation.error)}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary w-full sm:w-auto"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Creando…" : "Crear borrador"}
        </button>
      </form>

      {mutation.isSuccess && stillDraft && (
        <FocusedStatus key={mutation.data.projectId}>
          Borrador «{mutation.data.title}» creado. Puedes publicarlo desde «Proyectos de esta
          sesión».
        </FocusedStatus>
      )}
    </section>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const mutation = usePublishProject();
  const [confirming, setConfirming] = useState(false);
  const publishButton = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const titleId = `proyecto-sesion-${project.projectId}`;
  const status = STATUS_STYLES[project.status];

  useEffect(() => {
    if (confirming) {
      questionRef.current?.focus();
    }
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    mutation.reset();
    setTimeout(() => publishButton.current?.focus(), 0);
  };

  return (
    <article aria-labelledby={titleId} className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="text-lg font-semibold break-words">
          {project.title}
        </h3>
        <p className={`rounded-full border px-3 py-0.5 text-sm font-semibold ${status.className}`}>
          <span className="sr-only">Estado: </span>
          {status.label}
        </p>
      </div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Meta</dt>
          <dd className="font-semibold">{formatPEN(project.goalAmountCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">{project.publishedAt ? "Publicado el" : "Creado el"}</dt>
          <dd className="font-semibold">
            {formatDateTime(project.publishedAt ?? project.createdAt)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted">Identificador</dt>
          <dd className="font-mono break-all">{project.projectId}</dd>
        </div>
      </dl>

      {project.status === "PUBLICADO" ? (
        <div className="space-y-3">
          {mutation.isSuccess && (
            <FocusedStatus>
              Proyecto publicado: ya aparece en el catálogo y acepta donaciones.
            </FocusedStatus>
          )}
          <Link to={`/proyectos/${project.projectId}`} className="text-link inline-flex min-h-11 items-center">
            Ver «{project.title}» en el catálogo
          </Link>
        </div>
      ) : confirming ? (
        <div className="space-y-3">
          <p ref={questionRef} tabIndex={-1}>
            ¿Publicar «{project.title}»? Aparecerá en el catálogo y aceptará donaciones. Un
            proyecto publicado no vuelve a borrador.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(project.projectId)}
            >
              {mutation.isPending ? "Publicando…" : "Sí, publicar"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={mutation.isPending}
              onClick={cancel}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={publishButton}
          type="button"
          className="btn btn-secondary"
          // El nombre accesible empieza por el texto visible (WCAG 2.5.3) y distingue cada tarjeta.
          aria-label={`Publicar «${project.title}»`}
          onClick={() => setConfirming(true)}
        >
          Publicar
        </button>
      )}

      {mutation.isError && (
        <p role="alert" className="font-medium text-danger">
          {publishErrorMessage(mutation.error)}
        </p>
      )}
    </article>
  );
}

function SessionProjectsSection() {
  const projects = useSessionProjects().data ?? [];

  return (
    <section aria-labelledby="proyectos-sesion" className="space-y-3">
      <h2 id="proyectos-sesion" className="text-xl font-semibold">
        Proyectos de esta sesión
      </h2>
      <p className="max-w-prose text-sm text-muted">
        La plataforma no permite listar borradores anteriores: aquí ves los que creaste o
        publicaste desde que iniciaste sesión. Para publicar uno anterior, usa su identificador.
      </p>
      {projects.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-muted">
          Todavía no has creado proyectos en esta sesión.
        </p>
      ) : (
        <ul aria-label="Proyectos de esta sesión" className="space-y-3">
          {projects.map((project) => (
            <li key={project.projectId}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PublishByIdSection() {
  const mutation = usePublishProject();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(publishByIdSchema),
    defaultValues: { projectId: "" },
  });

  const onSubmit = ({ projectId }: { projectId: string }) =>
    mutation.mutate(projectId, { onSuccess: () => reset() });

  return (
    <section aria-labelledby="publicar-anterior" className="space-y-3">
      <h2 id="publicar-anterior" className="text-xl font-semibold">
        Publicar un borrador anterior
      </h2>
      <form
        noValidate
        aria-labelledby="publicar-anterior"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-4 rounded-lg border border-line bg-surface p-4"
      >
        <FormField
          id="identificador"
          label="Identificador del proyecto"
          hint="Lo recibiste al crear el borrador. Ejemplo: 6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b"
          error={errors.projectId?.message}
        >
          {(control) => (
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              className="field-input font-mono"
              {...control}
              {...register("projectId")}
            />
          )}
        </FormField>

        {mutation.isError && (
          <p role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 font-medium text-danger">
            {publishErrorMessage(mutation.error)}
          </p>
        )}

        <button type="submit" className="btn btn-secondary" disabled={mutation.isPending}>
          {mutation.isPending ? "Publicando…" : "Publicar borrador"}
        </button>
      </form>

      {mutation.isSuccess && (
        <FocusedStatus key={mutation.data.projectId}>
          «{mutation.data.title}» quedó publicado y ya acepta donaciones.
        </FocusedStatus>
      )}
    </section>
  );
}

/**
 * HU-08: panel del gestor. La ruta solo se muestra a GESTOR, pero eso es experiencia de uso: el
 * API exige el scope `api/projects.write` y el grupo GESTOR en cada solicitud (CA-04.1, T03).
 */
export function ManagerPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <PageHeading title="Panel del gestor" />
        <p className="max-w-prose text-muted">
          Crea proyectos como borrador y publícalos cuando estén listos. Solo los proyectos
          publicados aparecen en el catálogo y aceptan donaciones simuladas.
        </p>
      </div>
      <CreateProjectSection />
      <SessionProjectsSection />
      <PublishByIdSection />
    </div>
  );
}

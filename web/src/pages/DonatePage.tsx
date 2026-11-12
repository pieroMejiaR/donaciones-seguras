import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useParams } from "react-router";
import { useAuth } from "../auth/authContext";
import { LoadError } from "../components/LoadError";
import { PageHeading } from "../components/PageHeading";
import { SimulationNotice } from "../donations/SimulationNotice";
import { createIdempotencyTracker } from "../donations/idempotency";
import { createDonationErrorMessage, useCreateDonation } from "../donations/queries";
import {
  AMOUNT_HINT,
  DONATION_STATUS_LABELS,
  donationFormSchema,
  type Donation,
  type DonationFormInput,
  type DonationFormOutput,
} from "../donations/schemas";
import { formatDateTime } from "../lib/dates";
import { formatPEN } from "../lib/money";
import { isNotFound, useProject } from "../projects/queries";
import { isProjectId, type Project } from "../projects/schemas";
import { ApiError } from "../services/apiClient";

const AMOUNT_ID = "monto";
const HINT_ID = "monto-ayuda";
const ERROR_ID = "monto-error";

function DonationReceipt({
  donation,
  onAnother,
}: {
  donation: Donation;
  onAnother: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // El formulario desaparece: el foco pasa al resultado para que se anuncie (WCAG 2.4.3).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="donacion-registrada"
      className="space-y-4 rounded-lg border border-brand bg-surface p-4"
    >
      <h2 id="donacion-registrada" ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
        Intención de donación registrada
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Proyecto</dt>
          <dd className="font-semibold break-words">{donation.projectTitle}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Monto</dt>
          <dd className="font-semibold">{formatPEN(donation.amountCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Estado</dt>
          <dd className="font-semibold">{DONATION_STATUS_LABELS[donation.status]}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Registrada el</dt>
          <dd className="font-semibold">{formatDateTime(donation.createdAt)}</dd>
        </div>
      </dl>
      <SimulationNotice />
      <div className="flex flex-wrap gap-3">
        <Link to="/mis-donaciones" className="btn btn-primary">
          Ver mis donaciones
        </Link>
        <button type="button" className="btn btn-secondary" onClick={onAnother}>
          Registrar otra donación
        </button>
      </div>
    </section>
  );
}

function DonationForm({ project }: { project: Project }) {
  const { login } = useAuth();
  const location = useLocation();
  // Un rastreador por pantalla: decide cuándo se reutiliza la Idempotency-Key (CA-05.4).
  const [tracker] = useState(() => createIdempotencyTracker());
  const mutation = useCreateDonation();
  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors },
  } = useForm<DonationFormInput, unknown, DonationFormOutput>({
    resolver: zodResolver(donationFormSchema),
    defaultValues: { amount: "" },
  });

  const onSubmit = ({ amount }: DonationFormOutput) => {
    const payload = { projectId: project.projectId, amountCents: amount };
    mutation.mutate(
      { ...payload, idempotencyKey: tracker.keyFor(payload) },
      {
        onSuccess: () => tracker.reset(),
        onError: (error) => {
          if (error instanceof ApiError && error.code === "IDEMPOTENCY_KEY_REUSED") {
            tracker.reset();
          }
        },
      },
    );
  };

  if (mutation.isSuccess) {
    return (
      <DonationReceipt
        donation={mutation.data}
        onAnother={() => {
          mutation.reset();
          reset();
          // Tras volver al formulario, el foco queda en el campo del monto.
          setTimeout(() => setFocus("amount"), 0);
        }}
      />
    );
  }

  const fieldError = errors.amount?.message;
  const sessionExpired = mutation.error instanceof ApiError && mutation.error.status === 401;
  const describedBy = fieldError ? `${HINT_ID} ${ERROR_ID}` : HINT_ID;

  return (
    <form
      noValidate
      aria-labelledby="formulario-donacion"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="space-y-5 rounded-lg border border-line bg-surface p-4"
    >
      <h2 id="formulario-donacion" className="text-xl font-semibold">
        Datos de la donación
      </h2>

      <div className="space-y-2">
        <label htmlFor={AMOUNT_ID} className="block font-semibold">
          Monto a donar en soles (PEN)
        </label>
        <p id={HINT_ID} className="text-sm text-muted">
          {AMOUNT_HINT}
        </p>
        <div className="flex max-w-xs items-center gap-2">
          <span aria-hidden="true" className="font-semibold">
            S/
          </span>
          <input
            id={AMOUNT_ID}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy}
            className="field-input"
            {...register("amount")}
          />
        </div>
        {fieldError && (
          <p id={ERROR_ID} className="font-medium text-danger">
            {fieldError}
          </p>
        )}
      </div>

      <p className="text-sm text-muted">
        No te pediremos datos de tarjeta, CVV, cuenta bancaria ni DNI: la donación es una
        simulación académica y no genera ningún cobro.
      </p>

      {mutation.isError && (
        <div role="alert" className="space-y-3 rounded-lg border border-danger bg-danger-soft p-4">
          <p className="font-medium text-danger">{createDonationErrorMessage(mutation.error)}</p>
          {sessionExpired && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void login(location.pathname)}
            >
              Iniciar sesión
            </button>
          )}
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={mutation.isPending}>
        {mutation.isPending ? "Registrando…" : "Registrar intención de donación"}
      </button>
      {mutation.isPending && (
        <p role="status" className="sr-only">
          Registrando la donación…
        </p>
      )}
    </form>
  );
}

/**
 * HU-05: formulario de intención de donación. La ruta solo se muestra a DONANTE, pero eso es
 * experiencia de uso: el API vuelve a exigir token, scope y rol en cada envío (CA-04.3).
 */
export function DonatePage() {
  const { projectId = "" } = useParams();
  const validId = isProjectId(projectId);
  const project = useProject(projectId);

  const notFound = !validId || isNotFound(project.error);
  const failed = project.isError && !notFound;

  let title = "Cargando proyecto…";
  if (notFound) {
    title = "Proyecto no disponible";
  } else if (failed) {
    title = "No se pudo cargar el proyecto";
  } else if (project.data) {
    title = `Donar a ${project.data.title}`;
  }

  return (
    <div className="space-y-6">
      <PageHeading title={title} />

      {notFound && (
        <p className="text-muted">
          El proyecto no existe o no está publicado, así que no acepta donaciones.
        </p>
      )}
      {failed && (
        <LoadError
          message="Ocurrió un problema al cargar el proyecto."
          onRetry={() => project.refetch()}
        />
      )}
      {!notFound && project.isPending && <p role="status">Cargando el proyecto…</p>}
      {project.data && !notFound && <DonationForm project={project.data} />}

      <Link
        to={validId && !notFound ? `/proyectos/${projectId}` : "/"}
        className="text-link inline-flex min-h-11 items-center"
      >
        {validId && !notFound ? "Volver al proyecto" : "Volver al catálogo"}
      </Link>
    </div>
  );
}

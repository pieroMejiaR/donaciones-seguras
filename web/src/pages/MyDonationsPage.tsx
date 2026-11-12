import { Link } from "react-router";
import { LoadError } from "../components/LoadError";
import { PageHeading } from "../components/PageHeading";
import { SimulationActions } from "../donations/SimulationActions";
import { SimulationNotice } from "../donations/SimulationNotice";
import { useMyDonations } from "../donations/queries";
import {
  DONATION_STATUS_LABELS,
  type Donation,
  type DonationStatus,
} from "../donations/schemas";
import { formatDateTime } from "../lib/dates";
import { formatPEN } from "../lib/money";
import { ApiError } from "../services/apiClient";

// El estado se comunica con texto; el color solo lo refuerza (WCAG 1.4.1).
const STATUS_STYLES: Record<DonationStatus, string> = {
  PENDIENTE_SIMULACION: "border-warning bg-warning-soft text-warning",
  CONFIRMADA_SIMULADA: "border-brand bg-brand-soft text-brand",
  RECHAZADA_SIMULADA: "border-danger bg-danger-soft text-danger",
};

function DonationCard({ donation }: { donation: Donation }) {
  const titleId = `donacion-${donation.donationId}`;
  return (
    <article
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold break-words">
          <Link to={`/proyectos/${donation.projectId}`} className="text-link">
            {donation.projectTitle}
          </Link>
        </h2>
        <p
          className={`rounded-full border px-3 py-0.5 text-sm font-semibold ${STATUS_STYLES[donation.status]}`}
        >
          <span className="sr-only">Estado: </span>
          {DONATION_STATUS_LABELS[donation.status]}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-muted">Fecha</dt>
          <dd className="font-semibold">
            <time dateTime={donation.createdAt}>{formatDateTime(donation.createdAt)}</time>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Importe</dt>
          <dd className="font-semibold">{formatPEN(donation.amountCents)}</dd>
        </div>
      </dl>
      <SimulationActions donation={donation} />
    </article>
  );
}

function Summary({ donations }: { donations: Donation[] }) {
  const confirmed = donations.filter((d) => d.status === "CONFIRMADA_SIMULADA");
  const confirmedCents = confirmed.reduce((sum, d) => sum + d.amountCents, 0);
  return (
    <dl className="grid grid-cols-2 divide-x divide-line rounded-lg border border-line bg-surface">
      <div className="p-3 sm:p-4">
        <dt className="text-sm text-muted">Donaciones registradas</dt>
        <dd className="text-lg font-bold sm:text-2xl">{donations.length}</dd>
      </div>
      <div className="p-3 sm:p-4">
        <dt className="text-sm text-muted">Total confirmado (simulado)</dt>
        <dd className="text-lg font-bold break-all sm:text-2xl">{formatPEN(confirmedCents)}</dd>
      </div>
    </dl>
  );
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Tu sesión expiró. Inicia sesión de nuevo para ver tu historial.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "Tu cuenta no tiene permiso para ver un historial de donaciones.";
  }
  return "No se pudo cargar tu historial de donaciones.";
}

/**
 * HU-07: historial propio. Solo muestra lo que el API devuelve para el `sub` del token; la SPA
 * no envía ningún identificador de usuario (CA-07.1) ni muestra datos de identidad.
 */
export function MyDonationsPage() {
  const donations = useMyDonations();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageHeading title="Mis donaciones" />
        <p className="max-w-prose text-muted">
          Aquí ves solo las intenciones de donación registradas con tu cuenta, de la más reciente
          a la más antigua. Las pendientes y rechazadas no suman al total confirmado.
        </p>
      </div>

      <SimulationNotice />

      {donations.isPending && <p role="status">Cargando tu historial…</p>}
      {donations.isError && (
        <LoadError
          message={loadErrorMessage(donations.error)}
          onRetry={() => donations.refetch()}
        />
      )}
      {donations.isSuccess && donations.data.length === 0 && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-muted">Todavía no has registrado donaciones.</p>
          <Link to="/" className="text-link inline-flex min-h-11 items-center">
            Explorar proyectos
          </Link>
        </div>
      )}
      {donations.isSuccess && donations.data.length > 0 && (
        <>
          <Summary donations={donations.data} />
          <ul aria-label="Historial de donaciones" className="space-y-3">
            {donations.data.map((donation) => (
              <li key={donation.donationId}>
                <DonationCard donation={donation} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

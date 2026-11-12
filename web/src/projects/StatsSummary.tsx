import { LoadError } from "../components/LoadError";
import { formatPEN } from "../lib/money";
import { useStats } from "./queries";

const statClass = "flex items-baseline justify-between gap-3 p-3 sm:block sm:p-4";
const valueClass = "text-right text-lg font-bold break-all sm:text-left sm:text-2xl";

/** HU-09: totales públicos. Solo agregados: ningún donante ni registro individual (CA-09.2). */
export function StatsSummary() {
  const stats = useStats();

  return (
    <section aria-labelledby="indicadores-titulo" className="space-y-3">
      <h2 id="indicadores-titulo" className="text-xl font-semibold">
        Indicadores
      </h2>
      {stats.isPending && <p role="status">Cargando indicadores…</p>}
      {stats.isError && (
        <LoadError
          message="No se pudieron cargar los indicadores."
          onRetry={() => stats.refetch()}
        />
      )}
      {stats.isSuccess && (
        // En móvil, una tarjeta con tres filas para no empujar el catálogo fuera de la pantalla.
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className={statClass}>
            <dt className="text-sm text-muted">Proyectos publicados</dt>
            <dd className={valueClass}>{stats.data.publishedProjects}</dd>
          </div>
          <div className={statClass}>
            <dt className="text-sm text-muted">Recaudado (simulado)</dt>
            <dd className={valueClass}>{formatPEN(stats.data.confirmedAmountCents)}</dd>
          </div>
          <div className={statClass}>
            <dt className="text-sm text-muted">Meta total</dt>
            <dd className={valueClass}>{formatPEN(stats.data.goalAmountCents)}</dd>
          </div>
        </dl>
      )}
      <p className="text-sm text-muted">
        Solo cuentan las donaciones simuladas confirmadas; las pendientes y rechazadas no suman.
      </p>
    </section>
  );
}

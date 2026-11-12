import { formatPEN, formatProgress, progressRatio } from "../lib/money";

/**
 * Avance de un proyecto. El monto es la suma confirmada simulada: no incluye donaciones
 * pendientes ni rechazadas (CA-01.1, CA-09.1). La barra es decorativa; el texto lo dice todo.
 */
export function ProjectProgress({
  confirmedAmountCents,
  goalAmountCents,
}: {
  confirmedAmountCents: number;
  goalAmountCents: number;
}) {
  const ratio = progressRatio(confirmedAmountCents, goalAmountCents);

  return (
    <div className="space-y-2">
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-brand" style={{ width: `${ratio * 100}%` }} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-muted">Recaudado (simulado)</dt>
          <dd className="font-semibold">{formatPEN(confirmedAmountCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">Meta</dt>
          <dd className="font-semibold">{formatPEN(goalAmountCents)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="sr-only">Avance</dt>
          <dd>{formatProgress(confirmedAmountCents, goalAmountCents)} de la meta</dd>
        </div>
      </dl>
    </div>
  );
}

/** Texto exigido por CA-06.4. Se reutiliza en todas las pantallas que muestran una donación. */
export const SIMULATION_NOTICE = "Simulación académica: no se ha realizado ningún cobro";

export function SimulationNotice() {
  return (
    <p className="rounded-lg border border-warning bg-warning-soft p-3 font-semibold text-warning">
      {SIMULATION_NOTICE}
    </p>
  );
}

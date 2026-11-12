import { useEffect, useId, useRef, useState } from "react";
import { formatPEN } from "../lib/money";
import { simulateErrorMessage, useSimulateDonation, type SimulationOutcome } from "./queries";
import type { Donation } from "./schemas";

const CHOICES: Record<SimulationOutcome, { button: string; question: string; confirm: string }> = {
  CONFIRMADA_SIMULADA: {
    button: "Simular confirmación",
    question: "¿Confirmar la donación simulada de {monto}? Sumará al avance del proyecto.",
    confirm: "Sí, confirmar",
  },
  RECHAZADA_SIMULADA: {
    button: "Simular rechazo",
    question: "¿Rechazar la donación simulada de {monto}? No sumará al avance del proyecto.",
    confirm: "Sí, rechazar",
  },
};

const RESULTS: Record<SimulationOutcome, string> = {
  CONFIRMADA_SIMULADA: "Donación confirmada (simulada). Ya suma al avance del proyecto.",
  RECHAZADA_SIMULADA: "Donación rechazada (simulada). No suma al avance del proyecto.",
};

/**
 * HU-06: simular el resultado de una donación propia pendiente. El resultado no se puede cambiar
 * después (CA-06.2), así que cada opción pide confirmación. Mostrar u ocultar estos botones es
 * solo experiencia de uso: el API comprueba propietario y estado en cada solicitud.
 */
export function SimulationActions({
  donation,
  onSimulated,
}: {
  donation: Donation;
  onSimulated?: (donation: Donation) => void;
}) {
  const mutation = useSimulateDonation();
  const [choice, setChoice] = useState<SimulationOutcome | null>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const choiceButtons = useRef<Partial<Record<SimulationOutcome, HTMLButtonElement | null>>>({});
  const groupId = useId();
  const result = mutation.data;

  // El foco sigue al contenido que reemplaza a los botones (WCAG 2.4.3).
  useEffect(() => {
    if (choice) {
      questionRef.current?.focus();
    }
  }, [choice]);
  useEffect(() => {
    if (result) {
      resultRef.current?.focus();
    }
  }, [result]);

  if (result && result.status !== "PENDIENTE_SIMULACION") {
    return (
      <p ref={resultRef} tabIndex={-1} role="status" className="font-semibold">
        {RESULTS[result.status]}
      </p>
    );
  }
  if (donation.status !== "PENDIENTE_SIMULACION") {
    // Si otra solicitud la resolvió primero, el historial ya muestra el estado real; se mantiene
    // el aviso para que el usuario sepa por qué desaparecieron los botones.
    return mutation.isError ? (
      <p role="alert" className="font-medium text-danger">
        {simulateErrorMessage(mutation.error)}
      </p>
    ) : null;
  }

  const cancel = () => {
    const previous = choice;
    setChoice(null);
    mutation.reset();
    setTimeout(() => previous && choiceButtons.current[previous]?.focus(), 0);
  };

  const confirm = (outcome: SimulationOutcome) =>
    mutation.mutate(
      { donationId: donation.donationId, outcome },
      { onSuccess: (updated) => onSimulated?.(updated) },
    );

  return (
    <div role="group" aria-labelledby={groupId} className="space-y-3 border-t border-line pt-3">
      <p id={groupId} className="font-semibold">
        Simular el resultado
      </p>

      {choice ? (
        <div className="space-y-3">
          <p ref={questionRef} tabIndex={-1}>
            {CHOICES[choice].question.replace("{monto}", formatPEN(donation.amountCents))} El
            resultado no se puede cambiar después.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={mutation.isPending}
              onClick={() => confirm(choice)}
            >
              {mutation.isPending ? "Simulando…" : CHOICES[choice].confirm}
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
        <div className="flex flex-wrap gap-3">
          {(Object.keys(CHOICES) as SimulationOutcome[]).map((outcome) => (
            <button
              key={outcome}
              ref={(element) => {
                choiceButtons.current[outcome] = element;
              }}
              type="button"
              className="btn btn-secondary"
              onClick={() => setChoice(outcome)}
            >
              {CHOICES[outcome].button}
            </button>
          ))}
        </div>
      )}

      {mutation.isError && (
        <p role="alert" className="font-medium text-danger">
          {simulateErrorMessage(mutation.error)}
        </p>
      )}
    </div>
  );
}

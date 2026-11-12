import type { ReactNode } from "react";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/**
 * Campo con etiqueta visible, ayuda y error asociados al control (WCAG 1.3.1, 3.3.1, 3.3.2).
 * El error no usa `role="alert"`: al enviar, el foco pasa al campo y el lector lee su descripción.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const hintId = `${id}-ayuda`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ");

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true } : {}),
      })}
      {error && (
        <p id={errorId} className="font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

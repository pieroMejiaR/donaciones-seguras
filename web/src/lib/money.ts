const penFormatter = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const decimalFormatter = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });

function assertCents(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Los montos deben ser céntimos enteros");
  }
}

/** Texto decimal exacto a partir de un entero, sin pasar por aritmética de punto flotante. */
function toDecimalString(units: number, scale: number): Intl.StringNumericLiteral {
  const sign = units < 0 ? "-" : "";
  const absolute = Math.abs(units);
  const integer = Math.trunc(absolute / scale);
  const fraction = String(absolute % scale).padStart(String(scale).length - 1, "0");
  return `${sign}${integer}.${fraction}` as Intl.StringNumericLiteral;
}

/** Formatea céntimos enteros de PEN, por ejemplo `100000` → `S/ 1,000.00` (CA-09.1). */
export function formatPEN(cents: number): string {
  assertCents(cents);
  return penFormatter.format(toDecimalString(cents, 100));
}

/**
 * Porcentaje de avance hacia la meta, truncado a un decimal y con tope en 100 %. Se calcula
 * en milésimas enteras para no redondear hacia arriba un avance que aún no se alcanzó.
 */
export function formatProgress(confirmedCents: number, goalCents: number): string {
  assertCents(confirmedCents);
  assertCents(goalCents);
  if (goalCents <= 0) {
    return "0 %";
  }
  const perMille = Math.min(1000, Math.floor((Math.max(0, confirmedCents) * 1000) / goalCents));
  return `${decimalFormatter.format(toDecimalString(perMille, 10))} %`;
}

/** Fracción de avance entre 0 y 1, solo para dibujar la barra. */
export function progressRatio(confirmedCents: number, goalCents: number): number {
  if (goalCents <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, confirmedCents / goalCents));
}

const SOLES_PATTERN = /^(?:S\/\s*)?(\d{1,7})(?:[.,](\d{1,2}))?$/;

/**
 * Convierte lo que escribe el usuario en soles a céntimos enteros, sin aritmética de punto
 * flotante: `"25.5"` → `2550`. Acepta punto o coma decimal y hasta dos decimales; devuelve
 * `null` si el texto no es un monto (negativos, separadores de miles, tres decimales…).
 */
export function parseSolesToCents(text: string): number | null {
  const match = SOLES_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, integer = "0", fraction = ""] = match;
  return Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
}

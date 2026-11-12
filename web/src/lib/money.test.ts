import { describe, expect, it } from "vitest";
import { formatPEN, formatProgress, parseSolesToCents, progressRatio } from "./money";

// Intl separa "S/" del número con un espacio duro (U+00A0).
const NBSP = String.fromCharCode(0xa0);
const normalize = (text: string) => text.replaceAll(NBSP, " ");

describe("formatPEN (CA-09.1)", () => {
  it.each([
    [100, "S/ 1.00"],
    [100_000, "S/ 1,000.00"],
    [5, "S/ 0.05"],
    [0, "S/ 0.00"],
    [12_345, "S/ 123.45"],
    [100_000_000, "S/ 1,000,000.00"],
  ])("formatea %i céntimos como %s", (cents, expected) => {
    expect(normalize(formatPEN(cents))).toBe(expected);
  });

  it("no acepta montos que no sean céntimos enteros", () => {
    expect(() => formatPEN(1.5)).toThrow(RangeError);
    expect(() => formatPEN(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatProgress", () => {
  it.each([
    [12_500, 1_500_000, "0.8 %"],
    [750_000, 1_500_000, "50 %"],
    [0, 1_500_000, "0 %"],
    [1_500_000, 1_500_000, "100 %"],
    [2_000_000, 1_500_000, "100 %"],
  ])("%i de %i es %s", (confirmed, goal, expected) => {
    expect(formatProgress(confirmed, goal)).toBe(expected);
  });

  it("trunca: no muestra 100 % hasta alcanzar la meta", () => {
    expect(formatProgress(1_499_999, 1_500_000)).toBe("99.9 %");
  });

  it("progressRatio queda entre 0 y 1", () => {
    expect(progressRatio(2_000_000, 1_500_000)).toBe(1);
    expect(progressRatio(0, 0)).toBe(0);
  });
});

describe("parseSolesToCents (CA-05.1)", () => {
  it.each([
    ["1", 100],
    ["25.5", 2550],
    ["25.50", 2550],
    ["25,50", 2550],
    ["0.07", 7],
    ["S/ 12.30", 1230],
    ["  1000  ", 100_000],
    // 0.1 + 0.2 en punto flotante no da 0.3: aquí no hay aritmética decimal.
    ["0.30", 30],
    ["1000.01", 100_001],
  ])("convierte «%s» en %i céntimos", (text, cents) => {
    expect(parseSolesToCents(text)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1.", ".5", "10.505", "1,000.00", "1e3", "12 345", "S/"])(
    "rechaza «%s»",
    (text) => {
      expect(parseSolesToCents(text)).toBeNull();
    },
  );
});

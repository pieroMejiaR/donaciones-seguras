import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * axe no calcula el contraste en jsdom, así que esta prueba lo comprueba sobre los colores
 * reales de `styles.css` con la fórmula de WCAG 2.2. Cada par es una combinación que la
 * interfaz usa: si se cambia un color del tema, la prueba dice qué combinación deja de cumplir.
 */

function themeColors(css: string): Record<string, string> {
  const theme = /@theme\s*\{([^}]*)\}/.exec(css)?.[1];
  if (!theme) {
    throw new Error("styles.css no tiene un bloque @theme");
  }
  const colors: Record<string, string> = { white: "#ffffff" };
  for (const match of theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name = "", value = ""] = match;
    colors[name] = value.toLowerCase();
  }
  return colors;
}

function luminance(hex: string): number {
  const linear = (start: number) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Se lee el archivo del disco: Vitest no entrega el CSS como texto al importarlo.
const colors = themeColors(readFileSync(join(import.meta.dirname, "styles.css"), "utf8"));

function ratio(foreground: string, background: string): number {
  const fg = colors[foreground];
  const bg = colors[background];
  if (!fg || !bg) {
    throw new Error(`Color inexistente en @theme: ${fg ? background : foreground}`);
  }
  return contrastRatio(fg, bg);
}

// [texto, fondo, dónde se usa]
const TEXT_PAIRS: [string, string, string][] = [
  ["ink", "canvas", "texto general"],
  ["ink", "surface", "texto en tarjetas y formularios"],
  ["muted", "canvas", "descripciones de página y pie"],
  ["muted", "surface", "ayudas de campo y etiquetas de datos"],
  ["brand", "canvas", "enlaces y botón secundario en hover"],
  ["brand", "surface", "enlaces, botón secundario y enlace de salto"],
  ["white", "brand", "botón primario"],
  ["white", "brand-strong", "botón primario en hover"],
  ["brand", "brand-soft", "estado confirmado/publicado y mensajes de resultado"],
  ["warning", "warning-soft", "rótulo de simulación y estado pendiente/borrador"],
  ["danger", "danger-soft", "errores de carga y estado rechazado"],
  ["danger", "surface", "error asociado a un campo"],
];

// [elemento, fondo, dónde se usa]: bordes de controles e indicador de foco (WCAG 1.4.11).
const NON_TEXT_PAIRS: [string, string, string][] = [
  ["muted", "surface", "borde de los campos"],
  ["danger", "surface", "borde de un campo con error"],
  ["brand", "surface", "borde del botón secundario"],
  ["brand", "canvas", "botón primario sobre el fondo de página"],
  ["focus", "canvas", "foco sobre el fondo de página"],
  ["focus", "surface", "foco dentro de tarjetas y formularios"],
  ["focus", "brand-soft", "foco dentro de un mensaje de resultado"],
  ["focus", "warning-soft", "foco junto al rótulo de simulación"],
  ["focus", "danger-soft", "foco en «Reintentar» dentro de un error"],
];

describe("RNF-HU-06: contraste de la paleta (WCAG 2.2 AA)", () => {
  it("la fórmula coincide con los valores de referencia de WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 sobre blanco es el gris más claro que alcanza 4.5:1.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("lee todos los colores del tema", () => {
    for (const name of ["canvas", "surface", "ink", "muted", "brand", "danger", "focus"]) {
      expect(colors[name], name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(TEXT_PAIRS)("CA-NF06.2 (1.4.3): texto %s sobre %s ≥ 4.5:1 (%s)", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("CA-NF06.2 (1.4.11): %s sobre %s ≥ 3:1 (%s)", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "./returnTo";

describe("sanitizeReturnTo", () => {
  it("conserva rutas internas con consulta y fragmento", () => {
    expect(sanitizeReturnTo("/mis-donaciones?pagina=2#fila")).toBe(
      "/mis-donaciones?pagina=2#fila",
    );
  });

  it.each([
    "https://malicioso.example",
    "//malicioso.example",
    "//malicioso.example/robar",
    "/\\malicioso.example/robar",
    "/\t/malicioso.example/robar",
    "/.//malicioso.example",
    "/x/..//malicioso.example",
    "javascript:alert(1)",
    "ruta-relativa",
    "",
    null,
    undefined,
    42,
  ])("descarta el destino externo o inválido %j", (value) => {
    expect(sanitizeReturnTo(value)).toBe("/");
  });

  it("no vuelve a /callback, cuyo código ya se usó", () => {
    expect(sanitizeReturnTo("/callback?code=abc")).toBe("/");
  });
});

const DEFAULT_PATH = "/";
const CALLBACK_PATH = "/callback";
const PLACEHOLDER_ORIGIN = "https://origen.invalid";

/**
 * Limita el destino posterior al login a rutas de esta aplicación para evitar una
 * redirección abierta. Se delega en `URL` porque resuelve casos como `//sitio`,
 * `/\sitio` o tabulaciones igual que el navegador. El resultado también se revisa:
 * `/.//sitio` conserva el origen, pero se normaliza a `//sitio`, que apunta a otro host.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return DEFAULT_PATH;
  }
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_PATH;
  }
  if (
    url.origin !== PLACEHOLDER_ORIGIN ||
    url.pathname.startsWith("//") ||
    url.pathname === CALLBACK_PATH
  ) {
    return DEFAULT_PATH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

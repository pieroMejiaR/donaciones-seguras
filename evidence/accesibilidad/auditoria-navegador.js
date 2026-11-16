/*
 * Auditoría de accesibilidad en el navegador (RNF-HU-06).
 *
 * Uso: con `npm run dev -w web` en marcha, abrir la SPA en Chrome, activar en DevTools el modo
 * dispositivo a 375 px (o 320 px), ir a la pantalla que se quiere revisar y pegar este archivo en
 * la consola. Muestra una tabla y deja el resultado completo en `window.auditoria`.
 *
 * Comprueba lo que jsdom no puede medir:
 * - axe con las reglas WCAG 2.0/2.1/2.2 A y AA, incluido `color-contrast` (1.4.3);
 * - desplazamiento horizontal: ancho del documento frente al viewport (1.4.10);
 * - controles de menos de 24 × 24 px (2.5.8);
 * - textos recortados con el espaciado de 1.4.12 aplicado;
 * - que el navegador no guarde nada en localStorage ni sessionStorage (CA-NF11.1).
 *
 * No envía datos a ningún sitio: axe se carga desde web/node_modules a través de Vite.
 */
(async () => {
  if (!window.axe) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/node_modules/axe-core/axe.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("No se pudo cargar axe-core desde Vite"));
      document.head.appendChild(script);
    });
  }

  const describe = (el) => {
    const box = el.getBoundingClientRect();
    const name = (el.textContent || el.id || el.getAttribute("aria-label") || "").trim();
    return `${el.tagName.toLowerCase()} «${name.slice(0, 30)}» ${Math.round(box.width)}×${Math.round(box.height)}`;
  };

  const results = await window.axe.run(document, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
    },
  });

  const smallTargets = [...document.querySelectorAll("a, button, input, textarea, select")]
    .filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.width < 24 || box.height < 24);
    })
    .map(describe);

  // 1.4.12: se aplica el espaciado mínimo exigido y se buscan textos recortados.
  const spacing = document.createElement("style");
  spacing.textContent =
    "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";
  document.head.appendChild(spacing);
  // setTimeout y no requestAnimationFrame: este no se dispara si la pestaña está en segundo plano.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const clippedWithSpacing = [...document.querySelectorAll("header *, main *, footer *")]
    .filter((el) => !el.classList.contains("sr-only") && !el.closest(".sr-only"))
    .filter((el) => {
      const style = getComputedStyle(el);
      const clipsX = ["hidden", "clip"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
      const clipsY =
        ["hidden", "clip"].includes(style.overflowY) &&
        el.scrollHeight > el.clientHeight + 1 &&
        style.webkitLineClamp === "none";
      return clipsX || clipsY;
    })
    .map(describe);
  const scrollWidthWithSpacing = document.documentElement.scrollWidth;
  spacing.remove();

  const contrast = results.passes.find((rule) => rule.id === "color-contrast");

  window.auditoria = {
    ruta: location.pathname,
    titulo: document.title,
    viewport: innerWidth,
    anchoDocumento: document.documentElement.scrollWidth,
    anchoDocumentoConEspaciado: scrollWidthWithSpacing,
    violaciones: results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
    incompletas: results.incomplete.map((v) => `${v.id} ×${v.nodes.length}`),
    nodosContrasteOk: contrast ? contrast.nodes.length : 0,
    controlesMenoresDe24px: smallTargets,
    recortadosConEspaciado: clippedWithSpacing,
    almacenamiento: localStorage.length + sessionStorage.length,
  };
  console.table({
    ruta: window.auditoria.ruta,
    viewport: window.auditoria.viewport,
    anchoDocumento: window.auditoria.anchoDocumento,
    violaciones: window.auditoria.violaciones.length,
    nodosContrasteOk: window.auditoria.nodosContrasteOk,
    controlesMenoresDe24px: smallTargets.length,
    recortadosConEspaciado: clippedWithSpacing.length,
    almacenamiento: window.auditoria.almacenamiento,
  });
  return window.auditoria;
})();

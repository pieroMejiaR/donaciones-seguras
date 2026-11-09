import { useEffect } from "react";

const APP_NAME = "Donaciones Seguras";

/**
 * Título principal de cada página. Actualiza el título del documento (WCAG 2.4.2)
 * y admite foco programático para anunciar los cambios de ruta.
 */
export function PageHeading({ title }: { title: string }) {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);

  return (
    <h1 tabIndex={-1} className="text-2xl font-bold sm:text-3xl">
      {title}
    </h1>
  );
}

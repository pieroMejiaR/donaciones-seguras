import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * En una SPA el navegador no mueve el foco al cambiar de ruta, así que quien usa
 * teclado o lector de pantalla no percibe la navegación. Se lleva el foco al `h1`.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) {
      return;
    }
    previousPathname.current = pathname;
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [pathname]);

  return null;
}

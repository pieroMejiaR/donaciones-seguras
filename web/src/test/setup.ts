import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { stubNetwork } from "./network";

// Por defecto, un API con el catálogo vacío: ninguna prueba sale a la red real.
beforeEach(() => {
  stubNetwork();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

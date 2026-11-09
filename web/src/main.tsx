import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { App } from "./App";
import { routes } from "./app/router";
import { createAppServices } from "./app/services";
import { readEnv } from "./config/env";
import { ConfigErrorPage } from "./pages/ConfigErrorPage";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("No se encontró el elemento #root");
}

const config = readEnv(import.meta.env);

createRoot(root).render(
  <StrictMode>
    {config.ok ? (
      <App services={createAppServices(config.env)} router={createBrowserRouter(routes)} />
    ) : (
      <ConfigErrorPage invalid={config.invalid} />
    )}
  </StrictMode>,
);
